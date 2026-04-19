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
};
