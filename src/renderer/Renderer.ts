import type { CameraSnapshot } from '../scene/Camera';
import type { FlatBVH } from '../bvh/BVH';

export type BackendKind = 'webgpu' | 'webgl';

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

export interface Renderer {
  readonly backend: BackendKind;

  init(canvas: HTMLCanvasElement): Promise<void>;
  setScene(bvh: FlatBVH): void;
  setCamera(camera: CameraSnapshot): void;
  setSettings(settings: RenderSettings): void;
  resize(width: number, height: number, dpr: number): void;
  resetAccumulation(): void;
  renderFrame(): void;
  getStats(): RenderStats;
  onStats(listener: RendererListener): () => void;
  readPixels(): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
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
