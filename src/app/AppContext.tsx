import { createContext, useContext, type ReactNode, type MutableRefObject } from 'react';
import type { Engine } from '../engine/Engine';
import type { BackendCapabilities } from '../renderer/capabilities';

export interface AppContextValue {
  engineRef: MutableRefObject<Engine | null>;
  capabilities: BackendCapabilities;
}

const ctx = createContext<AppContextValue | null>(null);

export function AppContextProvider(props: {
  value: AppContextValue;
  children: ReactNode;
}): ReactNode {
  return <ctx.Provider value={props.value}>{props.children}</ctx.Provider>;
}

export function useAppContext(): AppContextValue {
  const value = useContext(ctx);
  if (!value) throw new Error('AppContext missing - did you forget <AppContextProvider>?');
  return value;
}

export function useEngine(): Engine {
  const { engineRef } = useAppContext();
  const engine = engineRef.current;
  if (!engine) throw new Error('Engine not yet initialized');
  return engine;
}

export function useEngineOrNull(): Engine | null {
  const { engineRef } = useAppContext();
  return engineRef.current;
}
