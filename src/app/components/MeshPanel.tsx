import styles from './MeshPanel.module.css';
import { useEngine } from '../AppContext';
import { useSceneSnapshot } from '../hooks/useSceneStore';

export function MeshPanel(): React.ReactNode {
  const engine = useEngine();
  const snap = useSceneSnapshot(engine.scene);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>Meshes</div>
      <div className={styles.list}>
        {snap.meshes.length === 0 && <div className={styles.empty}>No meshes loaded</div>}
        {snap.meshes.map((m) => (
          <div key={m.id} className={styles.row}>
            <button
              className={styles.iconButton}
              title={m.visible ? 'Hide mesh' : 'Show mesh'}
              onClick={() => engine.setMeshVisibility(m.id, !m.visible)}
              data-active={m.visible}
            >
              <EyeIcon hidden={!m.visible} />
            </button>
            <div className={styles.name} title={m.name}>
              {m.name}
            </div>
            <button
              className={styles.iconButton}
              title="Frame this mesh"
              onClick={() => engine.fitMesh(m.id)}
            >
              <FrameIcon />
            </button>
            <button
              className={styles.iconButton}
              title="Remove mesh"
              onClick={() => engine.removeMesh(m.id)}
            >
              <TrashIcon />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function EyeIcon({ hidden }: { hidden: boolean }): React.ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <path
        d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2" strokeWidth="1.2" />
      {hidden && <path d="M2 2 l12 12" strokeWidth="1.2" strokeLinecap="round" />}
    </svg>
  );
}

function FrameIcon(): React.ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <path d="M2 5V2h3M14 5V2h-3M2 11v3h3M14 11v3h-3" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function TrashIcon(): React.ReactNode {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor">
      <path
        d="M3 4h10M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1M5 4v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}
