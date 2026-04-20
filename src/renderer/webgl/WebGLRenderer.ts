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

import pathtraceFrag from './pathtrace.frag?raw';
import presentFrag from './present.frag?raw';
import sensorFrag from './sensor.frag?raw';
import ispFrag from './isp.frag?raw';
import fullscreenVert from './fullscreen.vert?raw';

const DATA_TEX_WIDTH = 2048;

export class WebGLRenderer implements Renderer {
  readonly backend: BackendKind = 'webgl';

  private canvas: HTMLCanvasElement | null = null;
  private gl!: WebGL2RenderingContext;

  private ptProgram!: WebGLProgram;
  private presentProgram!: WebGLProgram;
  private sensorProgram!: WebGLProgram;
  private ispProgram!: WebGLProgram;
  private vao!: WebGLVertexArrayObject;

  private accumTexA: WebGLTexture | null = null;
  private accumTexB: WebGLTexture | null = null;
  private accumFboA: WebGLFramebuffer | null = null;
  private accumFboB: WebGLFramebuffer | null = null;
  private readTex: 'A' | 'B' = 'A';

  private rawTex: WebGLTexture | null = null;
  private rawFbo: WebGLFramebuffer | null = null;
  private ispTex: WebGLTexture | null = null;
  private ispFbo: WebGLFramebuffer | null = null;
  private prnuTex: WebGLTexture | null = null;
  private dsnuTex: WebGLTexture | null = null;

  private bvhTex: WebGLTexture | null = null;
  private trisTex: WebGLTexture | null = null;
  private bvhDim: [number, number] = [1, 1];
  private trisDim: [number, number] = [1, 1];

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
  private cameraSnap: CameraSnapshot | null = null;
  private cameraDirty = true;
  private stats = new StatsEmitter();

  private ptUniforms!: Record<string, WebGLUniformLocation | null>;
  private presentUniforms!: Record<string, WebGLUniformLocation | null>;
  private sensorUniforms!: Record<string, WebGLUniformLocation | null>;
  private ispUniforms!: Record<string, WebGLUniformLocation | null>;

  async init(canvas: HTMLCanvasElement): Promise<void> {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', {
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('WebGL2 not supported');
    this.gl = gl;
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('WebGL2 EXT_color_buffer_float is required');
    }
    gl.getExtension('OES_texture_float_linear');

    this.ptProgram = linkProgram(gl, fullscreenVert, pathtraceFrag);
    this.presentProgram = linkProgram(gl, fullscreenVert, presentFrag);
    this.sensorProgram = linkProgram(gl, fullscreenVert, sensorFrag);
    this.ispProgram = linkProgram(gl, fullscreenVert, ispFrag);

    this.ptUniforms = {
      uInvView: gl.getUniformLocation(this.ptProgram, 'uInvView'),
      uInvProj: gl.getUniformLocation(this.ptProgram, 'uInvProj'),
      uCamPos: gl.getUniformLocation(this.ptProgram, 'uCamPos'),
      uResolution: gl.getUniformLocation(this.ptProgram, 'uResolution'),
      uFrameSeed: gl.getUniformLocation(this.ptProgram, 'uFrameSeed'),
      uSampleIndex: gl.getUniformLocation(this.ptProgram, 'uSampleIndex'),
      uMaxBounces: gl.getUniformLocation(this.ptProgram, 'uMaxBounces'),
      uTriCount: gl.getUniformLocation(this.ptProgram, 'uTriCount'),
      uNodeCount: gl.getUniformLocation(this.ptProgram, 'uNodeCount'),
      uLensFocalLengthMm: gl.getUniformLocation(this.ptProgram, 'uLensFocalLengthMm'),
      uLensFNumber: gl.getUniformLocation(this.ptProgram, 'uLensFNumber'),
      uLensFocusDistanceM: gl.getUniformLocation(this.ptProgram, 'uLensFocusDistanceM'),
      uSensorWidthMm: gl.getUniformLocation(this.ptProgram, 'uSensorWidthMm'),
      uSensorHeightMm: gl.getUniformLocation(this.ptProgram, 'uSensorHeightMm'),
      uLensDistortionA: gl.getUniformLocation(this.ptProgram, 'uLensDistortionA'),
      uLensDistortionB: gl.getUniformLocation(this.ptProgram, 'uLensDistortionB'),
      uPrevAccum: gl.getUniformLocation(this.ptProgram, 'uPrevAccum'),
      uBvh: gl.getUniformLocation(this.ptProgram, 'uBvh'),
      uTris: gl.getUniformLocation(this.ptProgram, 'uTris'),
      uBvhDim: gl.getUniformLocation(this.ptProgram, 'uBvhDim'),
      uTrisDim: gl.getUniformLocation(this.ptProgram, 'uTrisDim'),
    };

    this.presentUniforms = {
      uAccum: gl.getUniformLocation(this.presentProgram, 'uAccum'),
      uIsp: gl.getUniformLocation(this.presentProgram, 'uIsp'),
      uCameraMode: gl.getUniformLocation(this.presentProgram, 'uCameraMode'),
    };

    this.sensorUniforms = {
      uAccum: gl.getUniformLocation(this.sensorProgram, 'uAccum'),
      uPrnuNoise: gl.getUniformLocation(this.sensorProgram, 'uPrnuNoise'),
      uDsnuNoise: gl.getUniformLocation(this.sensorProgram, 'uDsnuNoise'),
      uWidth: gl.getUniformLocation(this.sensorProgram, 'uWidth'),
      uHeight: gl.getUniformLocation(this.sensorProgram, 'uHeight'),
      uCfa: gl.getUniformLocation(this.sensorProgram, 'uCfa'),
      uBitDepth: gl.getUniformLocation(this.sensorProgram, 'uBitDepth'),
      uQe: gl.getUniformLocation(this.sensorProgram, 'uQe'),
      uFullWellE: gl.getUniformLocation(this.sensorProgram, 'uFullWellE'),
      uReadNoiseE: gl.getUniformLocation(this.sensorProgram, 'uReadNoiseE'),
      uDarkCurrentEPerSec: gl.getUniformLocation(this.sensorProgram, 'uDarkCurrentEPerSec'),
      uPrnuStd: gl.getUniformLocation(this.sensorProgram, 'uPrnuStd'),
      uDsnuStdE: gl.getUniformLocation(this.sensorProgram, 'uDsnuStdE'),
      uGain: gl.getUniformLocation(this.sensorProgram, 'uGain'),
      uBlackLevel: gl.getUniformLocation(this.sensorProgram, 'uBlackLevel'),
      uExposureSec: gl.getUniformLocation(this.sensorProgram, 'uExposureSec'),
      uFrameSeed: gl.getUniformLocation(this.sensorProgram, 'uFrameSeed'),
    };

    this.ispUniforms = {
      uRaw: gl.getUniformLocation(this.ispProgram, 'uRaw'),
      uWidth: gl.getUniformLocation(this.ispProgram, 'uWidth'),
      uHeight: gl.getUniformLocation(this.ispProgram, 'uHeight'),
      uCfa: gl.getUniformLocation(this.ispProgram, 'uCfa'),
      uBitDepth: gl.getUniformLocation(this.ispProgram, 'uBitDepth'),
      uBlackLevel: gl.getUniformLocation(this.ispProgram, 'uBlackLevel'),
      uWb: gl.getUniformLocation(this.ispProgram, 'uWb'),
      uCcm: gl.getUniformLocation(this.ispProgram, 'uCcm'),
      uGamma: gl.getUniformLocation(this.ispProgram, 'uGamma'),
    };

    const vao = gl.createVertexArray();
    if (!vao) throw new Error('Failed to create VAO');
    this.vao = vao;

    this.resize(canvas.width, canvas.height, 1);
  }

  setScene(bvh: FlatBVH): void {
    const gl = this.gl;
    this.nodeCount = bvh.nodeCount;
    this.triCount = bvh.triCount;

    const bvhTexels = Math.max(1, bvh.nodeCount * 2);
    const triTexels = Math.max(1, bvh.triCount * 6);
    const bvhW = Math.min(DATA_TEX_WIDTH, bvhTexels);
    const bvhH = Math.max(1, Math.ceil(bvhTexels / bvhW));
    const trisW = Math.min(DATA_TEX_WIDTH, triTexels);
    const trisH = Math.max(1, Math.ceil(triTexels / trisW));

    this.bvhDim = [bvhW, bvhH];
    this.trisDim = [trisW, trisH];

    const bvhPadded = new Float32Array(bvhW * bvhH * 4);
    bvhPadded.set(bvh.nodes.subarray(0, Math.min(bvh.nodes.length, bvhPadded.length)));
    const trisPadded = new Float32Array(trisW * trisH * 4);
    if (bvh.triangles.length > 0) {
      trisPadded.set(bvh.triangles.subarray(0, Math.min(bvh.triangles.length, trisPadded.length)));
    }

    if (this.bvhTex) gl.deleteTexture(this.bvhTex);
    if (this.trisTex) gl.deleteTexture(this.trisTex);
    this.bvhTex = createDataTexture(gl, bvhW, bvhH, bvhPadded);
    this.trisTex = createDataTexture(gl, trisW, trisH, trisPadded);
    this.resetAccumulation();
  }

  setCamera(camera: CameraSnapshot): void {
    this.cameraSnap = camera;
    this.cameraDirty = true;
  }

  setLens(lens: LensModel): void {
    this.lens = normalizeLens(lens);
    this.cameraDirty = true;
  }

  setSensor(sensor: SensorModel): void {
    this.sensor = normalizeSensor(sensor);
    const gl = this.gl;
    const fpn = generateFPN(this.width, this.height, 0x1234abcd);

    if (this.prnuTex) gl.deleteTexture(this.prnuTex);
    if (this.dsnuTex) gl.deleteTexture(this.dsnuTex);

    this.prnuTex = createSingleFloatTexture(gl, this.width, this.height, fpn.prnu);
    this.dsnuTex = createSingleFloatTexture(gl, this.width, this.height, fpn.dsnu);
  }

  setISP(isp: ISPConfig): void {
    this.isp = normalizeISP(isp);
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
    const gl = this.gl;
    const w = Math.max(1, Math.floor(width * dpr));
    const h = Math.max(1, Math.floor(height * dpr));
    if (this.canvas) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.width = w;
    this.height = h;

    this.disposeAccum();
    const made = this.createAccum(w, h);
    this.accumTexA = made.texA;
    this.accumTexB = made.texB;
    this.accumFboA = made.fboA;
    this.accumFboB = made.fboB;

    if (this.rawTex) gl.deleteTexture(this.rawTex);
    if (this.rawFbo) gl.deleteFramebuffer(this.rawFbo);
    if (this.ispTex) gl.deleteTexture(this.ispTex);
    if (this.ispFbo) gl.deleteFramebuffer(this.ispFbo);

    this.rawTex = createSingleFloatTexture(gl, w, h, null);
    this.rawFbo = createFramebuffer(gl, this.rawTex);
    this.ispTex = createRgba8Texture(gl, w, h);
    this.ispFbo = createFramebuffer(gl, this.ispTex);

    this.setSensor(this.sensor);

    this.readTex = 'A';
    gl.viewport(0, 0, w, h);
    this.resetAccumulation();
  }

  resetAccumulation(): void {
    const gl = this.gl;
    for (const fbo of [this.accumFboA, this.accumFboB, this.rawFbo, this.ispFbo]) {
      if (!fbo) continue;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.clearBufferfv(gl.COLOR, 0, [0, 0, 0, 0]);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.accumulatedSamples = 0;
    this.readTex = 'A';
    this.emitStats();
  }

  renderFrame(): void {
    const gl = this.gl;
    if (
      !this.bvhTex ||
      !this.trisTex ||
      !this.accumTexA ||
      !this.accumTexB ||
      !this.accumFboA ||
      !this.accumFboB ||
      !this.rawFbo ||
      !this.rawTex ||
      !this.ispFbo ||
      !this.ispTex ||
      !this.prnuTex ||
      !this.dsnuTex ||
      !this.cameraSnap
    ) {
      return;
    }

    if (this.accumulatedSamples < this.settings.targetSpp || this.cameraDirty) {
      this.cameraDirty = false;
      this.frameSeed = (this.frameSeed + 1) >>> 0;

      const readTex = this.readTex === 'A' ? this.accumTexA : this.accumTexB;
      const writeFbo = this.readTex === 'A' ? this.accumFboB : this.accumFboA;

      gl.bindFramebuffer(gl.FRAMEBUFFER, writeFbo);
      gl.viewport(0, 0, this.width, this.height);
      gl.useProgram(this.ptProgram);
      gl.bindVertexArray(this.vao);

      gl.uniformMatrix4fv(this.ptUniforms.uInvView, false, this.cameraSnap.invView);
      gl.uniformMatrix4fv(this.ptUniforms.uInvProj, false, this.cameraSnap.invProj);
      gl.uniform3fv(this.ptUniforms.uCamPos, this.cameraSnap.position);
      gl.uniform2ui(this.ptUniforms.uResolution, this.width, this.height);
      gl.uniform1ui(this.ptUniforms.uFrameSeed, this.frameSeed);
      gl.uniform1ui(this.ptUniforms.uSampleIndex, this.accumulatedSamples);
      gl.uniform1ui(this.ptUniforms.uMaxBounces, Math.max(1, this.settings.maxBounces));
      gl.uniform1ui(this.ptUniforms.uTriCount, this.triCount);
      gl.uniform1ui(this.ptUniforms.uNodeCount, this.nodeCount);
      gl.uniform1f(this.ptUniforms.uLensFocalLengthMm, this.lens.focalLengthMm);
      gl.uniform1f(this.ptUniforms.uLensFNumber, this.lens.fNumber);
      gl.uniform1f(this.ptUniforms.uLensFocusDistanceM, this.lens.focusDistanceM);
      gl.uniform1f(this.ptUniforms.uSensorWidthMm, this.lens.sensorWidthMm);
      gl.uniform1f(this.ptUniforms.uSensorHeightMm, this.lens.sensorHeightMm);
      gl.uniform4f(
        this.ptUniforms.uLensDistortionA,
        this.lens.distortion.k1,
        this.lens.distortion.k2,
        this.lens.distortion.k3,
        this.lens.distortion.p1,
      );
      gl.uniform4f(
        this.ptUniforms.uLensDistortionB,
        this.lens.distortion.p2,
        this.lens.rollingShutter.enabled ? 1 : 0,
        this.lens.rollingShutter.lineTimeUs,
        0,
      );
      gl.uniform2ui(this.ptUniforms.uBvhDim, this.bvhDim[0], this.bvhDim[1]);
      gl.uniform2ui(this.ptUniforms.uTrisDim, this.trisDim[0], this.trisDim[1]);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, readTex);
      gl.uniform1i(this.ptUniforms.uPrevAccum, 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.bvhTex);
      gl.uniform1i(this.ptUniforms.uBvh, 1);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.trisTex);
      gl.uniform1i(this.ptUniforms.uTris, 2);

      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      this.readTex = this.readTex === 'A' ? 'B' : 'A';
      this.accumulatedSamples += 1;
    }

    this.runSensorPass();
    this.runIspPass();
    this.presentToCanvas();
    this.emitStats();
  }

  private runSensorPass(): void {
    const gl = this.gl;
    if (!this.rawFbo || !this.rawTex || !this.prnuTex || !this.dsnuTex) return;
    const srcAccum = this.readTex === 'A' ? this.accumTexA : this.accumTexB;
    if (!srcAccum) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rawFbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.sensorProgram);
    gl.bindVertexArray(this.vao);

    gl.uniform1ui(this.sensorUniforms.uWidth, this.width);
    gl.uniform1ui(this.sensorUniforms.uHeight, this.height);
    gl.uniform1ui(this.sensorUniforms.uCfa, sensorCfaCode(this.sensor.cfa));
    gl.uniform1ui(this.sensorUniforms.uBitDepth, this.sensor.bitDepth);
    gl.uniform3f(this.sensorUniforms.uQe, this.sensor.qe[0], this.sensor.qe[1], this.sensor.qe[2]);
    gl.uniform1f(this.sensorUniforms.uFullWellE, this.sensor.fullWellE);
    gl.uniform1f(this.sensorUniforms.uReadNoiseE, this.sensor.readNoiseE);
    gl.uniform1f(this.sensorUniforms.uDarkCurrentEPerSec, this.sensor.darkCurrentEPerSec);
    gl.uniform1f(this.sensorUniforms.uPrnuStd, this.sensor.prnuStd);
    gl.uniform1f(this.sensorUniforms.uDsnuStdE, this.sensor.dsnuStdE);
    gl.uniform1f(this.sensorUniforms.uGain, this.sensor.gain);
    gl.uniform1f(this.sensorUniforms.uBlackLevel, this.sensor.blackLevel);
    gl.uniform1f(this.sensorUniforms.uExposureSec, this.sensor.exposureSec);
    gl.uniform1ui(this.sensorUniforms.uFrameSeed, this.frameSeed);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcAccum);
    gl.uniform1i(this.sensorUniforms.uAccum, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.prnuTex);
    gl.uniform1i(this.sensorUniforms.uPrnuNoise, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.dsnuTex);
    gl.uniform1i(this.sensorUniforms.uDsnuNoise, 2);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private runIspPass(): void {
    const gl = this.gl;
    if (!this.ispFbo || !this.rawTex) return;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.ispFbo);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.ispProgram);
    gl.bindVertexArray(this.vao);

    gl.uniform1ui(this.ispUniforms.uWidth, this.width);
    gl.uniform1ui(this.ispUniforms.uHeight, this.height);
    gl.uniform1ui(this.ispUniforms.uCfa, sensorCfaCode(this.sensor.cfa));
    gl.uniform1ui(this.ispUniforms.uBitDepth, this.sensor.bitDepth);
    gl.uniform1f(this.ispUniforms.uBlackLevel, this.sensor.blackLevel);
    gl.uniform3f(
      this.ispUniforms.uWb,
      this.isp.wbGains[0],
      this.isp.wbGains[1],
      this.isp.wbGains[2],
    );
    gl.uniformMatrix3fv(this.ispUniforms.uCcm, false, new Float32Array(this.isp.ccm));
    gl.uniform1f(this.ispUniforms.uGamma, this.isp.gamma);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.rawTex);
    gl.uniform1i(this.ispUniforms.uRaw, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private presentToCanvas(): void {
    const gl = this.gl;
    const accumTex = this.readTex === 'A' ? this.accumTexA : this.accumTexB;
    if (!accumTex || !this.ispTex) return;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.presentProgram);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, accumTex);
    gl.uniform1i(this.presentUniforms.uAccum, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.ispTex);
    gl.uniform1i(this.presentUniforms.uIsp, 1);
    gl.uniform1ui(this.presentUniforms.uCameraMode, this.mode === 'sensor-capture' ? 1 : 0);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
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
    this.presentToCanvas();
    const gl = this.gl;
    const pixels = new Uint8Array(this.width * this.height * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const out = new Uint8ClampedArray(this.width * this.height * 4);
    const rowBytes = this.width * 4;
    for (let y = 0; y < this.height; y++) {
      const srcStart = (this.height - 1 - y) * rowBytes;
      out.set(pixels.subarray(srcStart, srcStart + rowBytes), y * rowBytes);
    }
    return { width: this.width, height: this.height, data: out };
  }

  async captureRaw(): Promise<RawCapture> {
    if (!this.rawFbo) {
      return {
        width: this.width,
        height: this.height,
        data: new Float32Array(this.width * this.height),
        metadata: {},
      };
    }
    this.runSensorPass();
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rawFbo);
    const rgba = new Float32Array(this.width * this.height * 4);
    gl.readPixels(0, 0, this.width, this.height, gl.RGBA, gl.FLOAT, rgba);
    const raw = new Float32Array(this.width * this.height);
    for (let i = 0; i < raw.length; i++) {
      raw[i] = rgba[i * 4];
    }

    const flipped = new Float32Array(this.width * this.height);
    for (let y = 0; y < this.height; y++) {
      const src = (this.height - 1 - y) * this.width;
      const dst = y * this.width;
      flipped.set(raw.subarray(src, src + this.width), dst);
    }

    return {
      width: this.width,
      height: this.height,
      data: flipped,
      metadata: {
        backend: 'webgl',
        mode: this.mode,
      },
    };
  }

  dispose(): void {
    const gl = this.gl;
    this.disposeAccum();
    if (this.rawTex) gl.deleteTexture(this.rawTex);
    if (this.rawFbo) gl.deleteFramebuffer(this.rawFbo);
    if (this.ispTex) gl.deleteTexture(this.ispTex);
    if (this.ispFbo) gl.deleteFramebuffer(this.ispFbo);
    if (this.prnuTex) gl.deleteTexture(this.prnuTex);
    if (this.dsnuTex) gl.deleteTexture(this.dsnuTex);
    if (this.bvhTex) gl.deleteTexture(this.bvhTex);
    if (this.trisTex) gl.deleteTexture(this.trisTex);
    if (this.vao) gl.deleteVertexArray(this.vao);
    if (this.ptProgram) gl.deleteProgram(this.ptProgram);
    if (this.presentProgram) gl.deleteProgram(this.presentProgram);
    if (this.sensorProgram) gl.deleteProgram(this.sensorProgram);
    if (this.ispProgram) gl.deleteProgram(this.ispProgram);
    const lose = gl.getExtension('WEBGL_lose_context');
    lose?.loseContext();
  }

  private disposeAccum(): void {
    const gl = this.gl;
    if (this.accumTexA) gl.deleteTexture(this.accumTexA);
    if (this.accumTexB) gl.deleteTexture(this.accumTexB);
    if (this.accumFboA) gl.deleteFramebuffer(this.accumFboA);
    if (this.accumFboB) gl.deleteFramebuffer(this.accumFboB);
    this.accumTexA = null;
    this.accumTexB = null;
    this.accumFboA = null;
    this.accumFboB = null;
  }

  private createAccum(
    w: number,
    h: number,
  ): {
    texA: WebGLTexture;
    texB: WebGLTexture;
    fboA: WebGLFramebuffer;
    fboB: WebGLFramebuffer;
  } {
    const gl = this.gl;
    const make = (): { tex: WebGLTexture; fbo: WebGLFramebuffer } => {
      const tex = gl.createTexture();
      if (!tex) throw new Error('Failed to create accum texture');
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      const fbo = gl.createFramebuffer();
      if (!fbo) throw new Error('Failed to create accum fbo');
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('Framebuffer incomplete: 0x' + status.toString(16));
      }
      return { tex, fbo };
    };
    const a = make();
    const b = make();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { texA: a.tex, texB: b.tex, fboA: a.fbo, fboB: b.fbo };
  }

  private emitStats(): void {
    this.stats.set(this.getStats());
  }
}

function linkProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error('Program link failed: ' + log);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    const kind = type === gl.VERTEX_SHADER ? 'vertex' : 'fragment';
    gl.deleteShader(shader);
    throw new Error(`${kind} shader compile failed: ${log}`);
  }
  return shader;
}

function createDataTexture(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  data: Float32Array,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Failed to create data texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function createSingleFloatTexture(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  data: Float32Array | null,
): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Failed to create single-channel texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, w, h, 0, gl.RED, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function createRgba8Texture(gl: WebGL2RenderingContext, w: number, h: number): WebGLTexture {
  const tex = gl.createTexture();
  if (!tex) throw new Error('Failed to create rgba8 texture');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function createFramebuffer(gl: WebGL2RenderingContext, tex: WebGLTexture): WebGLFramebuffer {
  const fbo = gl.createFramebuffer();
  if (!fbo) throw new Error('Failed to create framebuffer');
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('Framebuffer incomplete: 0x' + status.toString(16));
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return fbo;
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
