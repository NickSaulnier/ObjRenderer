import { useSyncExternalStore } from 'react';
import type { Engine, EngineState } from '../../engine/Engine';

export function useEngineState(engine: Engine | null): EngineState {
  return useSyncExternalStore(
    (listener) => {
      if (!engine) return () => {};
      return engine.onState(listener);
    },
    () => (engine ? engine.getState() : emptyState),
    () => (engine ? engine.getState() : emptyState),
  );
}

const emptyState: EngineState = {
  backend: null,
  settings: { targetSpp: 256, maxBounces: 6 },
  stats: { accumulatedSamples: 0, converged: false, width: 0, height: 0 },
  loading: { objs: 0, bvhs: 0 },
  errors: [],
  lens: {
    focalLengthMm: 24,
    fNumber: 2.8,
    focusDistanceM: 3,
    sensorWidthMm: 36,
    sensorHeightMm: 24,
    distortion: { k1: 0, k2: 0, k3: 0, p1: 0, p2: 0 },
    rollingShutter: { enabled: false, lineTimeUs: 15 },
  },
  sensor: {
    width: 1280,
    height: 720,
    pixelPitchUm: 3.45,
    cfa: 'RGGB',
    qe: [0.45, 0.5, 0.35],
    fullWellE: 12000,
    readNoiseE: 2,
    darkCurrentEPerSec: 0.08,
    prnuStd: 0.01,
    dsnuStdE: 0.35,
    gain: 1,
    bitDepth: 12,
    blackLevel: 64,
    exposureSec: 0.01,
    iso: 100,
  },
  isp: {
    wbGains: [1.9, 1, 1.7],
    ccm: [1.55, -0.35, -0.2, -0.1, 1.25, -0.15, 0.02, -0.42, 1.4],
    gamma: 2.2,
    demosaic: 'bilinear',
  },
  cameraMode: 'photoreal-preview',
  presetId: 'custom',
  flatFieldValidation: null,
};
