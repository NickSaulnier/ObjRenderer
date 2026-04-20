import { Camera } from '../scene/Camera';
import { OrbitControls } from '../scene/OrbitControls';
import { Scene } from '../scene/Scene';
import { Mesh, isEmptyBounds } from '../scene/Mesh';
import { type FlatBVH } from '../bvh/BVH';
import type {
  BackendKind,
  CameraMode,
  RenderSettings,
  RenderStats,
  Renderer,
} from '../renderer/Renderer';
import { WebGPURenderer } from '../renderer/webgpu/WebGPURenderer';
import { WebGLRenderer } from '../renderer/webgl/WebGLRenderer';
import type { ObjWorkerError, ObjWorkerRequest, ObjWorkerResponse } from '../workers/objWorker';
import type { BvhWorkerError, BvhWorkerRequest, BvhWorkerResponse } from '../workers/bvhWorker';
import {
  DEFAULT_LENS,
  lensAspect,
  lensFovY,
  normalizeLens,
  type LensModel,
} from '../camera/LensModel';
import { DEFAULT_SENSOR, normalizeSensor, type SensorModel } from '../camera/SensorModel';
import { DEFAULT_ISP, normalizeISP, type ISPConfig } from '../camera/ISP';
import { CAMERA_PRESETS, findPreset } from '../camera/presets';
import UPNG from 'upng-js';
import { validateFlatField, type ValidationResult } from '../camera/validation';

export interface EngineState {
  backend: BackendKind | null;
  settings: RenderSettings;
  stats: RenderStats;
  loading: { objs: number; bvhs: number };
  errors: string[];
  lens: LensModel;
  sensor: SensorModel;
  isp: ISPConfig;
  cameraMode: CameraMode;
  presetId: string;
  flatFieldValidation: ValidationResult | null;
}

type StateListener = (state: EngineState) => void;

const DEFAULT_SETTINGS: RenderSettings = { targetSpp: 256, maxBounces: 6 };

export interface CapturedFrame {
  rgbPng: Blob;
  rawPng: Blob;
  metadata: Record<string, unknown>;
}

export class Engine {
  readonly scene = new Scene();
  readonly camera = new Camera();
  readonly orbit = new OrbitControls(this.camera);

  private renderer: Renderer | null = null;
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private objWorker: Worker | null = null;
  private bvhWorker: Worker | null = null;
  private nextReqId = 1;
  private pendingObj = new Map<number, (res: ObjWorkerResponse | ObjWorkerError) => void>();
  private pendingBvh = new Map<number, (res: BvhWorkerResponse | BvhWorkerError) => void>();

  private rafHandle: number | null = null;
  private resizeObs: ResizeObserver | null = null;
  private rendererUnsub: (() => void) | null = null;
  private orbitUnsub: (() => void) | null = null;

  private state: EngineState = {
    backend: null,
    settings: { ...DEFAULT_SETTINGS },
    stats: { accumulatedSamples: 0, converged: false, width: 0, height: 0 },
    loading: { objs: 0, bvhs: 0 },
    errors: [],
    lens: normalizeLens(DEFAULT_LENS),
    sensor: normalizeSensor(DEFAULT_SENSOR),
    isp: normalizeISP(DEFAULT_ISP),
    cameraMode: 'photoreal-preview',
    presetId: CAMERA_PRESETS[0]?.id ?? 'custom',
    flatFieldValidation: null,
  };
  private listeners = new Set<StateListener>();

  getState(): EngineState {
    return this.state;
  }

  onState(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async init(container: HTMLElement, backend: BackendKind): Promise<void> {
    this.container = container;
    this.objWorker = new Worker(new URL('../workers/objWorker.ts', import.meta.url), {
      type: 'module',
    });
    this.bvhWorker = new Worker(new URL('../workers/bvhWorker.ts', import.meta.url), {
      type: 'module',
    });
    this.objWorker.addEventListener('message', (e) => this.handleObjMessage(e));
    this.bvhWorker.addEventListener('message', (e) => this.handleBvhMessage(e));
    this.objWorker.addEventListener('error', (e) =>
      this.pushError(`OBJ worker error: ${e.message || 'unknown'}`),
    );
    this.bvhWorker.addEventListener('error', (e) =>
      this.pushError(`BVH worker error: ${e.message || 'unknown'}`),
    );

    this.orbitUnsub = this.orbit.onChange(() => {
      if (this.renderer) {
        this.renderer.setCamera(this.camera.snapshot());
        this.renderer.resetAccumulation();
      }
      this.requestFrame();
    });

    await this.createRenderer(backend);

    this.orbit.frameBounds({ min: [-1, -1, -1], max: [1, 1, 1] });
    this.camera.update();
    if (this.renderer) {
      this.renderer.setScene(makeEmptyBVH());
      this.renderer.setCamera(this.camera.snapshot());
      this.renderer.setLens(this.state.lens);
      this.renderer.setSensor(this.state.sensor);
      this.renderer.setISP(this.state.isp);
      this.renderer.setCameraMode(this.state.cameraMode);
      this.renderer.setSettings(this.state.settings);
      this.renderer.resetAccumulation();
    }
    this.requestFrame();
  }

  async switchBackend(backend: BackendKind): Promise<void> {
    if (!this.container) return;
    if (this.state.backend === backend) return;
    await this.createRenderer(backend);
    if (this.renderer) {
      this.uploadSceneToRenderer();
      this.renderer.setCamera(this.camera.snapshot());
      this.renderer.setLens(this.state.lens);
      this.renderer.setSensor(this.state.sensor);
      this.renderer.setISP(this.state.isp);
      this.renderer.setCameraMode(this.state.cameraMode);
      this.renderer.setSettings(this.state.settings);
      this.renderer.resetAccumulation();
    }
    this.requestFrame();
  }

  setLens(partial: Partial<LensModel>): void {
    const next = normalizeLens({ ...this.state.lens, ...partial });
    this.state = {
      ...this.state,
      lens: next,
      flatFieldValidation: null,
      presetId: this.state.presetId === 'custom' ? 'custom' : this.state.presetId,
    };
    this.camera.fovY = lensFovY(next);
    this.camera.markDirty();
    this.renderer?.setLens(next);
    this.renderer?.setCamera(this.camera.snapshot());
    this.renderer?.resetAccumulation();
    this.emit();
    this.requestFrame();
  }

  setLensDistortion(patch: Partial<LensModel['distortion']>): void {
    this.setLens({
      distortion: {
        ...this.state.lens.distortion,
        ...patch,
      },
    });
  }

  setRollingShutter(patch: Partial<LensModel['rollingShutter']>): void {
    this.setLens({
      rollingShutter: {
        ...this.state.lens.rollingShutter,
        ...patch,
      },
    });
  }

  setSensor(partial: Partial<SensorModel>): void {
    const next = normalizeSensor({ ...this.state.sensor, ...partial });
    this.state = {
      ...this.state,
      sensor: next,
      flatFieldValidation: null,
      presetId: this.state.presetId === 'custom' ? 'custom' : this.state.presetId,
    };
    this.renderer?.setSensor(next);
    this.renderer?.resetAccumulation();
    this.emit();
    this.requestFrame();
  }

  setISP(partial: Partial<ISPConfig>): void {
    const next = normalizeISP({ ...this.state.isp, ...partial });
    this.state = {
      ...this.state,
      isp: next,
      flatFieldValidation: null,
      presetId: this.state.presetId === 'custom' ? 'custom' : this.state.presetId,
    };
    this.renderer?.setISP(next);
    this.renderer?.resetAccumulation();
    this.emit();
    this.requestFrame();
  }

  setCameraMode(mode: CameraMode): void {
    this.state = { ...this.state, cameraMode: mode, flatFieldValidation: null };
    this.renderer?.setCameraMode(mode);
    this.renderer?.resetAccumulation();
    this.emit();
    this.requestFrame();
  }

  applyCameraPreset(presetId: string): void {
    const preset = findPreset(presetId);
    if (!preset) return;
    const lens = normalizeLens(preset.lens);
    const sensor = normalizeSensor(preset.sensor);
    const isp = normalizeISP(preset.isp);
    this.state = {
      ...this.state,
      lens,
      sensor,
      isp,
      presetId: preset.id,
      flatFieldValidation: null,
    };
    this.camera.fovY = lensFovY(lens);
    this.camera.markDirty();
    this.renderer?.setLens(lens);
    this.renderer?.setSensor(sensor);
    this.renderer?.setISP(isp);
    this.renderer?.setCamera(this.camera.snapshot());
    this.renderer?.resetAccumulation();
    this.emit();
    this.requestFrame();
  }

  getCameraPresets(): ReadonlyArray<{ id: string; label: string }> {
    return CAMERA_PRESETS.map((p) => ({ id: p.id, label: p.label }));
  }

  async validateFlatFieldCapture(): Promise<ValidationResult | null> {
    if (!this.renderer) return null;
    const raw = await this.renderer.captureRaw();
    const result = validateFlatField(this.state.sensor, raw.data);
    this.state = {
      ...this.state,
      flatFieldValidation: result,
    };
    this.emit();
    return result;
  }

  private syncLensAspect(width: number, height: number): void {
    const fallback = width / Math.max(1, height);
    const lensAspectValue = lensAspect(this.state.lens);
    const aspect =
      Number.isFinite(lensAspectValue) && lensAspectValue > 0 ? lensAspectValue : fallback;
    this.camera.setAspect(aspect);
  }

  private async createRenderer(backend: BackendKind): Promise<void> {
    if (!this.container) throw new Error('Engine.init must be called first');
    if (this.renderer) {
      this.rendererUnsub?.();
      this.rendererUnsub = null;
      try {
        this.renderer.dispose();
      } catch (err) {
        console.warn('Renderer dispose error:', err);
      }
      this.renderer = null;
    }
    const fresh = this.rebuildCanvas();
    const renderer: Renderer = backend === 'webgpu' ? new WebGPURenderer() : new WebGLRenderer();
    await renderer.init(fresh);
    this.renderer = renderer;
    renderer.setScene(makeEmptyBVH());
    renderer.setCamera(this.camera.snapshot());
    renderer.setLens(this.state.lens);
    renderer.setSensor(this.state.sensor);
    renderer.setISP(this.state.isp);
    renderer.setCameraMode(this.state.cameraMode);
    renderer.setSettings(this.state.settings);
    this.rendererUnsub = renderer.onStats((stats) => {
      this.state = { ...this.state, stats };
      this.emit();
    });
    this.state = { ...this.state, backend };
    this.emit();

    const rect = this.container.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      this.resize(rect.width, rect.height);
    }
  }

  private rebuildCanvas(): HTMLCanvasElement {
    if (!this.container) throw new Error('No container');
    this.orbit.detach();
    this.resizeObs?.disconnect();
    if (this.canvas && this.canvas.parentElement === this.container) {
      this.container.removeChild(this.canvas);
    }
    const canvas = document.createElement('canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.touchAction = 'none';
    this.container.appendChild(canvas);
    this.canvas = canvas;
    this.orbit.attach(canvas);
    this.resizeObs = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const rect = entry.contentRect;
        this.resize(rect.width, rect.height);
      }
    });
    this.resizeObs.observe(this.container);
    return canvas;
  }

  resize(cssWidth: number, cssHeight: number): void {
    if (!this.renderer || !this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    this.renderer.resize(cssWidth, cssHeight, dpr);
    this.syncLensAspect(cssWidth, cssHeight);
    this.renderer.setCamera(this.camera.snapshot());
    this.requestFrame();
  }

  setSettings(settings: Partial<RenderSettings>): void {
    const merged: RenderSettings = {
      targetSpp: settings.targetSpp ?? this.state.settings.targetSpp,
      maxBounces: settings.maxBounces ?? this.state.settings.maxBounces,
    };
    this.state = { ...this.state, settings: merged };
    this.renderer?.setSettings(merged);
    this.emit();
    this.requestFrame();
  }

  resetAccumulation(): void {
    this.renderer?.resetAccumulation();
    this.requestFrame();
  }

  fitAll(): void {
    const b = this.scene.getBounds();
    this.orbit.frameBounds(b);
    this.renderer?.setCamera(this.camera.snapshot());
    this.renderer?.resetAccumulation();
    this.requestFrame();
  }

  fitMesh(id: string): void {
    const mesh = this.scene.getMesh(id);
    if (!mesh) return;
    this.orbit.frameBounds(mesh.bounds);
    this.renderer?.setCamera(this.camera.snapshot());
    this.renderer?.resetAccumulation();
    this.requestFrame();
  }

  setMeshVisibility(id: string, visible: boolean): void {
    this.scene.setMeshVisibility(id, visible);
    this.rebuildAndUpload();
  }

  removeMesh(id: string): void {
    this.scene.removeMesh(id);
    this.rebuildAndUpload();
  }

  clearScene(): void {
    this.scene.clear();
    if (this.renderer) {
      this.renderer.setScene(makeEmptyBVH());
      this.renderer.resetAccumulation();
    }
    this.requestFrame();
  }

  async loadObjFile(file: File): Promise<void> {
    try {
      const buffer = await file.arrayBuffer();
      await this.loadObjBuffer(buffer, file.name.replace(/\.obj$/i, '') || 'mesh');
    } catch (err) {
      this.pushError(err instanceof Error ? err.message : String(err));
    }
  }

  async loadObjBuffer(buffer: ArrayBuffer, fallbackName: string): Promise<void> {
    if (!this.objWorker) return;
    this.state = {
      ...this.state,
      loading: { ...this.state.loading, objs: this.state.loading.objs + 1 },
    };
    this.emit();
    try {
      const res = await this.sendObj(buffer, fallbackName);
      if (!res.ok) throw new Error(res.error);
      let added = 0;
      for (const g of res.groups) {
        if (g.indices.length === 0) continue;
        const name = g.name && g.name.trim().length > 0 ? g.name : fallbackName;
        const mesh = new Mesh(added === 0 ? name : `${fallbackName} � ${name}`, {
          positions: g.positions,
          normals: g.normals,
          indices: g.indices,
        });
        this.scene.addMesh(mesh);
        added++;
      }
      await this.rebuildAndUpload();
      const sceneBounds = this.scene.getBounds();
      if (!isEmptyBounds(sceneBounds)) {
        this.orbit.frameBounds(sceneBounds);
        this.renderer?.setCamera(this.camera.snapshot());
      }
    } catch (err) {
      this.pushError(err instanceof Error ? err.message : String(err));
    } finally {
      this.state = {
        ...this.state,
        loading: { ...this.state.loading, objs: this.state.loading.objs - 1 },
      };
      this.emit();
    }
  }

  async saveImage(): Promise<Blob | null> {
    if (!this.renderer) return null;
    const { width, height, data } = await this.renderer.readPixels();
    if (width === 0 || height === 0) return null;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const buf = new Uint8ClampedArray(new ArrayBuffer(data.byteLength));
    buf.set(data);
    const img = new ImageData(buf, width, height);
    ctx.putImageData(img, 0, 0);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png'),
    );
  }

  async capture(): Promise<CapturedFrame | null> {
    if (!this.renderer) return null;
    const rgbPng = await this.saveImage();
    if (!rgbPng) return null;

    const raw = await this.renderer.captureRaw();
    const rawPng = encodeRawPng16(raw.width, raw.height, raw.data, this.state.sensor.bitDepth);
    const metadata: Record<string, unknown> = {
      width: raw.width,
      height: raw.height,
      cfa: this.state.sensor.cfa,
      bitDepth: this.state.sensor.bitDepth,
      blackLevel: this.state.sensor.blackLevel,
      whiteLevel: (1 << this.state.sensor.bitDepth) - 1,
      exposureSec: this.state.sensor.exposureSec,
      gain: this.state.sensor.gain,
      iso: this.state.sensor.iso,
      focalLengthMm: this.state.lens.focalLengthMm,
      fNumber: this.state.lens.fNumber,
      focusDistanceM: this.state.lens.focusDistanceM,
      distortion: this.state.lens.distortion,
      sensorPitchUm: this.state.sensor.pixelPitchUm,
      wbGains: this.state.isp.wbGains,
      ccm: [
        this.state.isp.ccm.slice(0, 3),
        this.state.isp.ccm.slice(3, 6),
        this.state.isp.ccm.slice(6, 9),
      ],
      rollingShutter: this.state.lens.rollingShutter,
      ...raw.metadata,
    };
    return { rgbPng, rawPng, metadata };
  }

  dispose(): void {
    if (this.rafHandle !== null) cancelAnimationFrame(this.rafHandle);
    this.rafHandle = null;
    this.orbit.detach();
    this.orbitUnsub?.();
    this.resizeObs?.disconnect();
    this.rendererUnsub?.();
    try {
      this.renderer?.dispose();
    } catch (err) {
      console.warn(err);
    }
    this.renderer = null;
    this.objWorker?.terminate();
    this.bvhWorker?.terminate();
    this.objWorker = null;
    this.bvhWorker = null;
    this.listeners.clear();
  }

  private requestFrame(): void {
    if (this.rafHandle !== null) return;
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.tick();
    });
  }

  private tick(): void {
    if (!this.renderer) return;
    this.renderer.renderFrame();
    const stats = this.renderer.getStats();
    if (!stats.converged) {
      this.requestFrame();
    }
  }

  private async rebuildAndUpload(): Promise<void> {
    if (!this.bvhWorker) return;
    const meshes = this.scene.visibleMeshes;
    this.state = {
      ...this.state,
      loading: { ...this.state.loading, bvhs: this.state.loading.bvhs + 1 },
    };
    this.emit();
    try {
      let bvh: FlatBVH;
      if (meshes.length === 0) {
        bvh = makeEmptyBVH();
      } else {
        const reqId = this.nextReqId++;
        const payload: BvhWorkerRequest = {
          id: reqId,
          meshes: meshes.map((m) => ({
            positions: m.positions,
            normals: m.normals,
            indices: m.indices,
          })),
        };
        const res = await new Promise<BvhWorkerResponse | BvhWorkerError>((resolve) => {
          this.pendingBvh.set(reqId, resolve);
          this.bvhWorker!.postMessage(payload);
        });
        if (!res.ok) throw new Error(res.error);
        bvh = {
          nodeCount: res.nodeCount,
          triCount: res.triCount,
          nodes: res.nodes,
          triangles: res.triangles,
          boundsMin: res.boundsMin,
          boundsMax: res.boundsMax,
        };
      }
      this.renderer?.setScene(bvh);
      this.renderer?.resetAccumulation();
      this.requestFrame();
    } catch (err) {
      this.pushError(err instanceof Error ? err.message : String(err));
    } finally {
      this.state = {
        ...this.state,
        loading: { ...this.state.loading, bvhs: this.state.loading.bvhs - 1 },
      };
      this.emit();
    }
  }

  private uploadSceneToRenderer(): void {
    void this.rebuildAndUpload();
  }

  private sendObj(
    buffer: ArrayBuffer,
    fallbackName: string,
  ): Promise<ObjWorkerResponse | ObjWorkerError> {
    if (!this.objWorker) return Promise.reject(new Error('No obj worker'));
    const id = this.nextReqId++;
    const msg: ObjWorkerRequest = { id, buffer, fallbackName };
    return new Promise((resolve) => {
      this.pendingObj.set(id, resolve);
      this.objWorker!.postMessage(msg, [buffer]);
    });
  }

  private handleObjMessage(e: MessageEvent<ObjWorkerResponse | ObjWorkerError>): void {
    const pending = this.pendingObj.get(e.data.id);
    if (!pending) return;
    this.pendingObj.delete(e.data.id);
    pending(e.data);
  }

  private handleBvhMessage(e: MessageEvent<BvhWorkerResponse | BvhWorkerError>): void {
    const pending = this.pendingBvh.get(e.data.id);
    if (!pending) return;
    this.pendingBvh.delete(e.data.id);
    pending(e.data);
  }

  private pushError(message: string): void {
    const errors = [...this.state.errors, message].slice(-5);
    this.state = { ...this.state, errors };
    this.emit();
  }

  dismissError(index: number): void {
    const errors = this.state.errors.slice();
    errors.splice(index, 1);
    this.state = { ...this.state, errors };
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l(this.state);
  }
}

function makeEmptyBVH(): FlatBVH {
  const nodes = new Float32Array(8);
  return {
    nodeCount: 1,
    triCount: 0,
    nodes,
    triangles: new Float32Array(0),
    boundsMin: [0, 0, 0],
    boundsMax: [0, 0, 0],
  };
}

function encodeRawPng16(width: number, height: number, data: Float32Array, bitDepth: number): Blob {
  const maxDn = (1 << bitDepth) - 1;
  const bytes = new ArrayBuffer(width * height * 2);
  const view = new DataView(bytes);
  for (let i = 0; i < width * height; i++) {
    const v = Math.max(0, Math.min(maxDn, Math.round(data[i] || 0)));
    view.setUint16(i * 2, v, false);
  }
  const png = UPNG.encodeLL([bytes], width, height, 1, 0, 16);
  return new Blob([png], { type: 'image/png' });
}
