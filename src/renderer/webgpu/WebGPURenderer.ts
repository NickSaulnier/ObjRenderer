import type { CameraSnapshot } from '../../scene/Camera';
import type { FlatBVH } from '../../bvh/BVH';
import {
  StatsEmitter,
  type BackendKind,
  type RenderSettings,
  type RenderStats,
  type Renderer,
  type RendererListener,
} from '../Renderer';

import pathtraceWgsl from './pathtrace.wgsl?raw';
import presentWgsl from './present.wgsl?raw';

const CAMERA_UBO_SIZE = 256;
const FRAME_UBO_SIZE = 64;
const PRESENT_UBO_SIZE = 32;

export class WebGPURenderer implements Renderer {
  readonly backend: BackendKind = 'webgpu';

  private canvas: HTMLCanvasElement | null = null;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;

  private cameraBuffer!: GPUBuffer;
  private frameBuffer!: GPUBuffer;
  private presentBuffer!: GPUBuffer;

  private bvhBuffer: GPUBuffer | null = null;
  private trisBuffer: GPUBuffer | null = null;
  private accumBuffer: GPUBuffer | null = null;

  private ptPipeline!: GPUComputePipeline;
  private ptLayout!: GPUBindGroupLayout;
  private ptBindGroup: GPUBindGroup | null = null;

  private presentPipeline!: GPURenderPipeline;
  private presentLayout!: GPUBindGroupLayout;
  private presentBindGroup: GPUBindGroup | null = null;

  private width = 1;
  private height = 1;
  private accumulatedSamples = 0;
  private frameSeed = 0;
  private triCount = 0;
  private nodeCount = 0;
  private settings: RenderSettings = { targetSpp: 256, maxBounces: 6 };
  private cameraDirty = true;
  private stats = new StatsEmitter();

  async init(canvas: HTMLCanvasElement): Promise<void> {
    if (!navigator.gpu) throw new Error('WebGPU not supported');
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error('No WebGPU adapter');
    this.device = await adapter.requestDevice();
    this.device.lost.then((info) => {
      console.warn('WebGPU device lost:', info.message);
    });
    this.canvas = canvas;
    const ctx = canvas.getContext('webgpu');
    if (!ctx) throw new Error('Failed to get webgpu context');
    this.context = ctx;
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'opaque',
    });

    this.cameraBuffer = this.device.createBuffer({
      size: CAMERA_UBO_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.frameBuffer = this.device.createBuffer({
      size: FRAME_UBO_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.presentBuffer = this.device.createBuffer({
      size: PRESENT_UBO_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.ptLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'storage' },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });
    this.ptPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.ptLayout] }),
      compute: {
        module: this.device.createShaderModule({ code: pathtraceWgsl }),
        entryPoint: 'main',
      },
    });

    this.presentLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });
    const presentModule = this.device.createShaderModule({ code: presentWgsl });
    this.presentPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.presentLayout],
      }),
      vertex: { module: presentModule, entryPoint: 'vs' },
      fragment: {
        module: presentModule,
        entryPoint: 'fs',
        targets: [{ format: this.format }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.resize(canvas.width, canvas.height, 1);
  }

  setScene(bvh: FlatBVH): void {
    this.bvhBuffer?.destroy();
    this.trisBuffer?.destroy();

    const nodeBytes = Math.max(bvh.nodes.byteLength, 32);
    const triBytes = Math.max(bvh.triangles.byteLength, 32);

    this.bvhBuffer = this.device.createBuffer({
      size: alignUp(nodeBytes, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.trisBuffer = this.device.createBuffer({
      size: alignUp(triBytes, 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.device.queue.writeBuffer(this.bvhBuffer, 0, bvh.nodes);
    if (bvh.triangles.byteLength > 0) {
      this.device.queue.writeBuffer(this.trisBuffer, 0, bvh.triangles);
    }
    this.triCount = bvh.triCount;
    this.nodeCount = bvh.nodeCount;
    this.rebuildBindGroup();
    this.resetAccumulation();
  }

  setCamera(camera: CameraSnapshot): void {
    const buf = new Float32Array(CAMERA_UBO_SIZE / 4);
    buf.set(camera.invView, 0);
    buf.set(camera.invProj, 16);
    buf[32] = camera.position[0];
    buf[33] = camera.position[1];
    buf[34] = camera.position[2];
    buf[35] = 0;
    this.device.queue.writeBuffer(this.cameraBuffer, 0, buf);
    this.cameraDirty = true;
  }

  setSettings(settings: RenderSettings): void {
    const prev = this.settings;
    this.settings = settings;
    if (prev.maxBounces !== settings.maxBounces || prev.targetSpp !== settings.targetSpp) {
      this.resetAccumulation();
    }
  }

  resize(width: number, height: number, dpr: number): void {
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (this.canvas) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.width = w;
    this.height = h;
    this.accumBuffer?.destroy();
    const size = w * h * 16;
    this.accumBuffer = this.device.createBuffer({
      size: alignUp(Math.max(size, 16), 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.rebuildBindGroup();
    this.resetAccumulation();
  }

  resetAccumulation(): void {
    if (!this.accumBuffer) return;
    const encoder = this.device.createCommandEncoder();
    encoder.clearBuffer(this.accumBuffer);
    this.device.queue.submit([encoder.finish()]);
    this.accumulatedSamples = 0;
    this.emitStats();
  }

  renderFrame(): void {
    if (!this.accumBuffer || !this.bvhBuffer || !this.trisBuffer) return;
    if (!this.ptBindGroup || !this.presentBindGroup) return;
    if (this.accumulatedSamples >= this.settings.targetSpp && !this.cameraDirty) {
      this.blitPresent();
      return;
    }
    this.cameraDirty = false;

    const frameData = new Uint32Array(FRAME_UBO_SIZE / 4);
    this.frameSeed = (this.frameSeed + 1) >>> 0;
    frameData[0] = this.frameSeed;
    frameData[1] = this.accumulatedSamples;
    frameData[2] = Math.max(1, this.settings.maxBounces);
    frameData[3] = this.width;
    frameData[4] = this.height;
    frameData[5] = this.triCount;
    frameData[6] = this.nodeCount;
    frameData[7] = 0;
    this.device.queue.writeBuffer(this.frameBuffer, 0, frameData);

    const encoder = this.device.createCommandEncoder();
    const cp = encoder.beginComputePass();
    cp.setPipeline(this.ptPipeline);
    cp.setBindGroup(0, this.ptBindGroup);
    cp.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8), 1);
    cp.end();

    this.writePresentUbo();
    const view = this.context.getCurrentTexture().createView();
    const rp = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    rp.setPipeline(this.presentPipeline);
    rp.setBindGroup(0, this.presentBindGroup);
    rp.draw(3);
    rp.end();

    this.device.queue.submit([encoder.finish()]);
    this.accumulatedSamples += 1;
    this.emitStats();
  }

  private blitPresent(): void {
    if (!this.presentBindGroup) return;
    this.writePresentUbo();
    const encoder = this.device.createCommandEncoder();
    const view = this.context.getCurrentTexture().createView();
    const rp = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    rp.setPipeline(this.presentPipeline);
    rp.setBindGroup(0, this.presentBindGroup);
    rp.draw(3);
    rp.end();
    this.device.queue.submit([encoder.finish()]);
  }

  private writePresentUbo(): void {
    const data = new Uint32Array(PRESENT_UBO_SIZE / 4);
    data[0] = this.width;
    data[1] = this.height;
    this.device.queue.writeBuffer(this.presentBuffer, 0, data);
  }

  private rebuildBindGroup(): void {
    if (!this.accumBuffer || !this.bvhBuffer || !this.trisBuffer) {
      this.ptBindGroup = null;
    } else {
      this.ptBindGroup = this.device.createBindGroup({
        layout: this.ptLayout,
        entries: [
          { binding: 0, resource: { buffer: this.cameraBuffer } },
          { binding: 1, resource: { buffer: this.frameBuffer } },
          { binding: 2, resource: { buffer: this.accumBuffer } },
          { binding: 3, resource: { buffer: this.bvhBuffer } },
          { binding: 4, resource: { buffer: this.trisBuffer } },
        ],
      });
    }
    if (!this.accumBuffer) {
      this.presentBindGroup = null;
    } else {
      this.presentBindGroup = this.device.createBindGroup({
        layout: this.presentLayout,
        entries: [
          { binding: 0, resource: { buffer: this.presentBuffer } },
          { binding: 1, resource: { buffer: this.accumBuffer } },
        ],
      });
    }
  }

  getStats(): RenderStats {
    return {
      accumulatedSamples: this.accumulatedSamples,
      converged: this.accumulatedSamples >= this.settings.targetSpp,
      width: this.width,
      height: this.height,
    };
  }

  onStats(listener: RendererListener): () => void {
    return this.stats.on(listener);
  }

  async readPixels(): Promise<{
    width: number;
    height: number;
    data: Uint8ClampedArray;
  }> {
    if (!this.accumBuffer || !this.presentBindGroup) {
      return {
        width: this.width,
        height: this.height,
        data: new Uint8ClampedArray(this.width * this.height * 4),
      };
    }
    const offscreen = this.device.createTexture({
      size: { width: this.width, height: this.height },
      format: 'rgba8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    const bytesPerRow = alignUp(this.width * 4, 256);
    const readback = this.device.createBuffer({
      size: bytesPerRow * this.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const rgbaPipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.presentLayout],
      }),
      vertex: {
        module: this.device.createShaderModule({ code: presentWgsl }),
        entryPoint: 'vs',
      },
      fragment: {
        module: this.device.createShaderModule({ code: presentWgsl }),
        entryPoint: 'fs',
        targets: [{ format: 'rgba8unorm' }],
      },
      primitive: { topology: 'triangle-list' },
    });

    this.writePresentUbo();
    const encoder = this.device.createCommandEncoder();
    const rp = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: offscreen.createView(),
          loadOp: 'clear',
          storeOp: 'store',
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
        },
      ],
    });
    rp.setPipeline(rgbaPipeline);
    rp.setBindGroup(0, this.presentBindGroup);
    rp.draw(3);
    rp.end();
    encoder.copyTextureToBuffer(
      { texture: offscreen },
      { buffer: readback, bytesPerRow, rowsPerImage: this.height },
      { width: this.width, height: this.height },
    );
    this.device.queue.submit([encoder.finish()]);

    await readback.mapAsync(GPUMapMode.READ);
    const src = new Uint8Array(readback.getMappedRange());
    const data = new Uint8ClampedArray(this.width * this.height * 4);
    for (let y = 0; y < this.height; y++) {
      const srcStart = y * bytesPerRow;
      const dstStart = y * this.width * 4;
      data.set(src.subarray(srcStart, srcStart + this.width * 4), dstStart);
    }
    readback.unmap();
    readback.destroy();
    offscreen.destroy();

    return { width: this.width, height: this.height, data };
  }

  dispose(): void {
    this.bvhBuffer?.destroy();
    this.trisBuffer?.destroy();
    this.accumBuffer?.destroy();
    this.cameraBuffer?.destroy();
    this.frameBuffer?.destroy();
    this.presentBuffer?.destroy();
    try {
      this.context?.unconfigure();
    } catch {}
    this.device?.destroy();
  }

  private emitStats(): void {
    this.stats.set(this.getStats());
  }
}

function alignUp(value: number, align: number): number {
  return Math.ceil(value / align) * align;
}
