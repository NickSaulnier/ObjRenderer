import { useEffect, useRef, useState } from 'react';
import styles from './App.module.css';
import { Engine } from '../engine/Engine';
import { probeCapabilities, type BackendCapabilities } from '../renderer/capabilities';
import { AppContextProvider } from './AppContext';
import { Toolbar } from './components/Toolbar';
import { MeshPanel } from './components/MeshPanel';
import { DetailsPanel } from './components/DetailsPanel';
import { Viewport } from './components/Viewport';
import { RenderControls } from './components/RenderControls';
import { BackendToggle } from './components/BackendToggle';
import { ErrorBanner } from './components/ErrorBanner';
import { CameraPanel } from './components/CameraPanel';

type BootState =
  | { kind: 'probing' }
  | { kind: 'ready'; caps: BackendCapabilities }
  | { kind: 'error'; message: string };

export function App(): React.ReactNode {
  const [boot, setBoot] = useState<BootState>({ kind: 'probing' });

  useEffect(() => {
    let cancelled = false;
    probeCapabilities()
      .then((caps) => {
        if (cancelled) return;
        setBoot({ kind: 'ready', caps });
      })
      .catch((err) => {
        if (cancelled) return;
        setBoot({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (boot.kind === 'probing') {
    return <div className={styles.boot}>Probing GPU capabilities�</div>;
  }
  if (boot.kind === 'error') {
    return <div className={styles.bootError}>{boot.message}</div>;
  }
  return <AppMain caps={boot.caps} />;
}

function AppMain({ caps }: { caps: BackendCapabilities }): React.ReactNode {
  const engineRef = useRef<Engine | null>(null);
  const [, forceUpdate] = useState(0);

  if (engineRef.current == null) {
    engineRef.current = new Engine();
  }

  useEffect(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const container = document.querySelector<HTMLDivElement>('[data-engine-container]');
    if (!container) return;
    let disposed = false;
    engine.init(container, caps.defaultBackend).then(() => {
      if (disposed) return;
      forceUpdate((v) => v + 1);
    });
    return () => {
      disposed = true;
      engine.dispose();
      engineRef.current = null;
    };
  }, [caps.defaultBackend]);

  return (
    <AppContextProvider value={{ engineRef, capabilities: caps }}>
      <div className={styles.app}>
        <div className={styles.topRow}>
          <Toolbar />
          <div className={styles.topRight}>
            <BackendToggle />
          </div>
        </div>
        <div className={styles.middleRow}>
          <MeshPanel />
          <div className={styles.viewportWrap}>
            <Viewport />
            <ErrorBanner />
          </div>
          <div className={styles.rightColumn}>
            <DetailsPanel />
            <CameraPanel />
          </div>
        </div>
        <RenderControls />
      </div>
    </AppContextProvider>
  );
}
