import type { CameraSnapshot } from '../scene/Camera';
import type { FlatBVH } from '../bvh/BVH';
import type { LensModel } from '../camera/LensModel';
import type { SensorModel } from '../camera/SensorModel';
import type { ISPConfig } from '../camera/ISP';

export type BackendKind = 'webgpu' | 'webgl';
export type CameraMode = 'photoreal-preview' | 'sensor-capture';

export interface RenderSettings {
  targetSpp: number;
  maxBounces: number;
}

export interface RenderStats {
  accumulatedSamples: number;
  converged: boolean;
  width: number;
  height: number;
}

export interface RendererEventMap {
  'stats-changed': RenderStats;
}

export type RendererListener = (stats: RenderStats) => void;

export interface RawCapture {
  width: number;
  height: number;
  data: Float32Array;
  metadata: Record<string, unknown>;
}

export interface Renderer {
  readonly backend: BackendKind;

  init(canvas: HTMLCanvasElement): Promise<void>;
  setScene(bvh: FlatBVH): void;
  setCamera(camera: CameraSnapshot): void;
  setLens(lens: LensModel): void;
  setSensor(sensor: SensorModel): void;
  setISP(isp: ISPConfig): void;
  setCameraMode(mode: CameraMode): void;
  setSettings(settings: RenderSettings): void;
  resize(width: number, height: number, dpr: number): void;
  resetAccumulation(): void;
  renderFrame(): void;
  getStats(): RenderStats;
  onStats(listener: RendererListener): () => void;
  readPixels(): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
  captureRaw(): Promise<RawCapture>;
  dispose(): void;
}

export class StatsEmitter {
  private listeners = new Set<RendererListener>();
  private stats: RenderStats = {
    accumulatedSamples: 0,
    converged: false,
    width: 0,
    height: 0,
  };

  get current(): RenderStats {
    return this.stats;
  }

  set(stats: RenderStats): void {
    this.stats = stats;
    for (const l of this.listeners) l(stats);
  }

  on(listener: RendererListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
