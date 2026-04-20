import type { CameraSnapshot } from '../../scene/Camera';
import type { FlatBVH } from '../../bvh/BVH';
import {
  StatsEmitter,
  type BackendKind,
  type CameraMode,
  type RawCapture,
  type RenderSettings,
  type RenderStats,
  type Renderer,
  type RendererListener,
} from '../Renderer';

import type { LensModel } from '../../camera/LensModel';
import { DEFAULT_LENS, normalizeLens } from '../../camera/LensModel';
import type { SensorModel } from '../../camera/SensorModel';
import { DEFAULT_SENSOR, generateFPN, normalizeSensor } from '../../camera/SensorModel';
import type { ISPConfig } from '../../camera/ISP';
import { DEFAULT_ISP, normalizeISP } from '../../camera/ISP';

import pathtraceWgsl from './pathtrace.wgsl?raw';
import presentWgsl from './present.wgsl?raw';
import sensorWgsl from './sensor.wgsl?raw';
import ispWgsl from './isp.wgsl?raw';

const CAMERA_UBO_SIZE = 256;
const FRAME_UBO_SIZE = 64;
const PRESENT_UBO_SIZE = 32;
const LENS_UBO_SIZE = 64;
const SENSOR_UBO_SIZE = 96;
const ISP_UBO_SIZE = 96;

export class WebGPURenderer implements Renderer {
  readonly backend: BackendKind = 'webgpu';

  private canvas: HTMLCanvasElement | null = null;
  private device!: GPUDevice;
  private context!: GPUCanvasContext;
  private format!: GPUTextureFormat;

  private cameraBuffer!: GPUBuffer;
  private frameBuffer!: GPUBuffer;
  private presentBuffer!: GPUBuffer;
  private lensBuffer!: GPUBuffer;
  private sensorBuffer!: GPUBuffer;
  private ispBuffer!: GPUBuffer;

  private bvhBuffer: GPUBuffer | null = null;
  private trisBuffer: GPUBuffer | null = null;
  private accumBuffer: GPUBuffer | null = null;
  private rawBuffer: GPUBuffer | null = null;
  private ispOutBuffer: GPUBuffer | null = null;
  private prnuNoiseBuffer: GPUBuffer | null = null;
  private dsnuNoiseBuffer: GPUBuffer | null = null;

  private ptPipeline!: GPUComputePipeline;
  private ptLayout!: GPUBindGroupLayout;
  private ptBindGroup: GPUBindGroup | null = null;

  private sensorPipeline!: GPUComputePipeline;
  private sensorLayout!: GPUBindGroupLayout;
  private sensorBindGroup: GPUBindGroup | null = null;

  private ispPipeline!: GPUComputePipeline;
  private ispLayout!: GPUBindGroupLayout;
  private ispBindGroup: GPUBindGroup | null = null;

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
  private lens: LensModel = normalizeLens(DEFAULT_LENS);
  private sensor: SensorModel = normalizeSensor(DEFAULT_SENSOR);
  private isp: ISPConfig = normalizeISP(DEFAULT_ISP);
  private mode: CameraMode = 'photoreal-preview';
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
    this.lensBuffer = this.device.createBuffer({
      size: LENS_UBO_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.sensorBuffer = this.device.createBuffer({
      size: SENSOR_UBO_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.ispBuffer = this.device.createBuffer({
      size: ISP_UBO_SIZE,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.ptLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
      ],
    });
    this.ptPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.ptLayout] }),
      compute: {
        module: this.device.createShaderModule({ code: pathtraceWgsl }),
        entryPoint: 'main',
      },
    });

    this.sensorLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      ],
    });
    this.sensorPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.sensorLayout] }),
      compute: {
        module: this.device.createShaderModule({ code: sensorWgsl }),
        entryPoint: 'main',
      },
    });

    this.ispLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });
    this.ispPipeline = this.device.createComputePipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.ispLayout] }),
      compute: {
        module: this.device.createShaderModule({ code: ispWgsl }),
        entryPoint: 'main',
      },
    });

    this.presentLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'read-only-storage' } },
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

    this.setLens(this.lens);
    this.setSensor(this.sensor);
    this.setISP(this.isp);
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

  setLens(lens: LensModel): void {
    this.lens = normalizeLens(lens);
    const data = new Float32Array(LENS_UBO_SIZE / 4);
    data[0] = this.lens.focalLengthMm;
    data[1] = this.lens.fNumber;
    data[2] = this.lens.focusDistanceM;
    data[3] = this.lens.sensorWidthMm;
    data[4] = this.lens.sensorHeightMm;
    data[5] = this.lens.distortion.k1;
    data[6] = this.lens.distortion.k2;
    data[7] = this.lens.distortion.k3;
    data[8] = this.lens.distortion.p1;
    data[9] = this.lens.distortion.p2;
    data[10] = this.lens.rollingShutter.enabled ? 1 : 0;
    data[11] = this.lens.rollingShutter.lineTimeUs;
    this.device.queue.writeBuffer(this.lensBuffer, 0, data);
    this.cameraDirty = true;
  }

  setSensor(sensor: SensorModel): void {
    this.sensor = normalizeSensor(sensor);
    const u = new Float32Array(SENSOR_UBO_SIZE / 4);
    u[0] = this.width;
    u[1] = this.height;
    u[2] = sensorCfaCode(this.sensor.cfa);
    u[3] = this.sensor.bitDepth;
    u[4] = this.sensor.qe[0];
    u[5] = this.sensor.qe[1];
    u[6] = this.sensor.qe[2];
    u[7] = this.sensor.fullWellE;
    u[8] = this.sensor.readNoiseE;
    u[9] = this.sensor.darkCurrentEPerSec;
    u[10] = this.sensor.prnuStd;
    u[11] = this.sensor.dsnuStdE;
    u[12] = this.sensor.gain;
    u[13] = this.sensor.blackLevel;
    u[14] = this.sensor.exposureSec;
    this.device.queue.writeBuffer(this.sensorBuffer, 0, u);

    const fpn = generateFPN(this.width, this.height, 0x1234abcd);
    this.prnuNoiseBuffer?.destroy();
    this.dsnuNoiseBuffer?.destroy();
    this.prnuNoiseBuffer = this.device.createBuffer({
      size: alignUp(Math.max(fpn.prnu.byteLength, 16), 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.dsnuNoiseBuffer = this.device.createBuffer({
      size: alignUp(Math.max(fpn.dsnu.byteLength, 16), 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.device.queue.writeBuffer(this.prnuNoiseBuffer, 0, fpn.prnu);
    this.device.queue.writeBuffer(this.dsnuNoiseBuffer, 0, fpn.dsnu);
    this.rebuildBindGroup();
  }

  setISP(isp: ISPConfig): void {
    this.isp = normalizeISP(isp);
    const u = new Float32Array(ISP_UBO_SIZE / 4);
    u[0] = this.isp.wbGains[0];
    u[1] = this.isp.wbGains[1];
    u[2] = this.isp.wbGains[2];
    u[3] = this.isp.gamma;
    for (let i = 0; i < 9; i++) {
      u[4 + i] = this.isp.ccm[i];
    }
    this.device.queue.writeBuffer(this.ispBuffer, 0, u);
  }

  setCameraMode(mode: CameraMode): void {
    this.mode = mode;
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
    this.rawBuffer?.destroy();
    this.ispOutBuffer?.destroy();

    const accumSize = w * h * 16;
    const rawSize = w * h * 4;
    this.accumBuffer = this.device.createBuffer({
      size: alignUp(Math.max(accumSize, 16), 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.rawBuffer = this.device.createBuffer({
      size: alignUp(Math.max(rawSize, 16), 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });
    this.ispOutBuffer = this.device.createBuffer({
      size: alignUp(Math.max(accumSize, 16), 16),
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.setSensor(this.sensor);
    this.rebuildBindGroup();
    this.resetAccumulation();
  }

  resetAccumulation(): void {
    if (!this.accumBuffer || !this.rawBuffer || !this.ispOutBuffer) return;
    const encoder = this.device.createCommandEncoder();
    encoder.clearBuffer(this.accumBuffer);
    encoder.clearBuffer(this.rawBuffer);
    encoder.clearBuffer(this.ispOutBuffer);
    this.device.queue.submit([encoder.finish()]);
    this.accumulatedSamples = 0;
    this.emitStats();
  }

  renderFrame(): void {
    if (!this.accumBuffer || !this.bvhBuffer || !this.trisBuffer) return;
    if (!this.ptBindGroup || !this.presentBindGroup || !this.sensorBindGroup || !this.ispBindGroup)
      return;
    if (this.accumulatedSamples >= this.settings.targetSpp && !this.cameraDirty) {
      this.runSensorIspAndPresent(false);
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

    this.runSensorIspPasses(encoder);
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

  private runSensorIspAndPresent(emitStats: boolean): void {
    if (!this.presentBindGroup || !this.sensorBindGroup || !this.ispBindGroup) return;
    const encoder = this.device.createCommandEncoder();
    this.runSensorIspPasses(encoder);
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
    if (emitStats) this.emitStats();
  }

  private runSensorIspPasses(encoder: GPUCommandEncoder): void {
    const cp1 = encoder.beginComputePass();
    cp1.setPipeline(this.sensorPipeline);
    cp1.setBindGroup(0, this.sensorBindGroup!);
    cp1.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8), 1);
    cp1.end();

    const cp2 = encoder.beginComputePass();
    cp2.setPipeline(this.ispPipeline);
    cp2.setBindGroup(0, this.ispBindGroup!);
    cp2.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8), 1);
    cp2.end();
  }

  private writePresentUbo(): void {
    const data = new Uint32Array(PRESENT_UBO_SIZE / 4);
    data[0] = this.width;
    data[1] = this.height;
    data[2] = this.mode === 'sensor-capture' ? 1 : 0;
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
          { binding: 5, resource: { buffer: this.lensBuffer } },
        ],
      });
    }

    if (!this.accumBuffer || !this.rawBuffer || !this.prnuNoiseBuffer || !this.dsnuNoiseBuffer) {
      this.sensorBindGroup = null;
    } else {
      this.sensorBindGroup = this.device.createBindGroup({
        layout: this.sensorLayout,
        entries: [
          { binding: 0, resource: { buffer: this.frameBuffer } },
          { binding: 1, resource: { buffer: this.sensorBuffer } },
          { binding: 2, resource: { buffer: this.accumBuffer } },
          { binding: 3, resource: { buffer: this.rawBuffer } },
          { binding: 4, resource: { buffer: this.prnuNoiseBuffer } },
          { binding: 5, resource: { buffer: this.dsnuNoiseBuffer } },
        ],
      });
    }

    if (!this.rawBuffer || !this.ispOutBuffer) {
      this.ispBindGroup = null;
    } else {
      this.ispBindGroup = this.device.createBindGroup({
        layout: this.ispLayout,
        entries: [
          { binding: 0, resource: { buffer: this.sensorBuffer } },
          { binding: 1, resource: { buffer: this.ispBuffer } },
          { binding: 2, resource: { buffer: this.rawBuffer } },
          { binding: 3, resource: { buffer: this.ispOutBuffer } },
        ],
      });
    }

    if (!this.accumBuffer || !this.ispOutBuffer) {
      this.presentBindGroup = null;
    } else {
      this.presentBindGroup = this.device.createBindGroup({
        layout: this.presentLayout,
        entries: [
          { binding: 0, resource: { buffer: this.presentBuffer } },
          { binding: 1, resource: { buffer: this.accumBuffer } },
          { binding: 2, resource: { buffer: this.ispOutBuffer } },
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

  async readPixels(): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
    if (
      !this.accumBuffer ||
      !this.presentBindGroup ||
      !this.sensorBindGroup ||
      !this.ispBindGroup
    ) {
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

    const encoder = this.device.createCommandEncoder();
    this.runSensorIspPasses(encoder);
    this.writePresentUbo();
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

  async captureRaw(): Promise<RawCapture> {
    if (!this.rawBuffer || !this.sensorBindGroup) {
      return {
        width: this.width,
        height: this.height,
        data: new Float32Array(this.width * this.height),
        metadata: {},
      };
    }

    const encoder = this.device.createCommandEncoder();
    const cp = encoder.beginComputePass();
    cp.setPipeline(this.sensorPipeline);
    cp.setBindGroup(0, this.sensorBindGroup);
    cp.dispatchWorkgroups(Math.ceil(this.width / 8), Math.ceil(this.height / 8), 1);
    cp.end();

    const readback = this.device.createBuffer({
      size: alignUp(this.width * this.height * 4, 256),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    encoder.copyBufferToBuffer(this.rawBuffer, 0, readback, 0, this.width * this.height * 4);
    this.device.queue.submit([encoder.finish()]);

    await readback.mapAsync(GPUMapMode.READ);
    const src = new Float32Array(readback.getMappedRange().slice(0));
    const out = new Float32Array(this.width * this.height);
    out.set(src.subarray(0, out.length));
    readback.unmap();
    readback.destroy();

    return {
      width: this.width,
      height: this.height,
      data: out,
      metadata: {
        backend: 'webgpu',
        mode: this.mode,
      },
    };
  }

  dispose(): void {
    this.bvhBuffer?.destroy();
    this.trisBuffer?.destroy();
    this.accumBuffer?.destroy();
    this.rawBuffer?.destroy();
    this.ispOutBuffer?.destroy();
    this.prnuNoiseBuffer?.destroy();
    this.dsnuNoiseBuffer?.destroy();
    this.cameraBuffer?.destroy();
    this.frameBuffer?.destroy();
    this.presentBuffer?.destroy();
    this.lensBuffer?.destroy();
    this.sensorBuffer?.destroy();
    this.ispBuffer?.destroy();
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

function sensorCfaCode(cfa: SensorModel['cfa']): number {
  switch (cfa) {
    case 'mono':
      return 0;
    case 'RGGB':
      return 1;
    case 'BGGR':
      return 2;
    case 'GRBG':
      return 3;
    case 'GBRG':
      return 4;
    default:
      return 1;
  }
}
