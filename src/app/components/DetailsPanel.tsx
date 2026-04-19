import styles from './DetailsPanel.module.css';
import { useEngine } from '../AppContext';
import { useSceneSnapshot } from '../hooks/useSceneStore';
import { useEngineState } from '../hooks/useEngineState';

export function DetailsPanel(): React.ReactNode {
  const engine = useEngine();
  const snap = useSceneSnapshot(engine.scene);
  const state = useEngineState(engine);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>Details</div>
      <div className={styles.body}>
        <Row label="Vertices" value={snap.stats.vertices.toLocaleString()} />
        <Row label="Triangles" value={snap.stats.triangles.toLocaleString()} />
        <Row label="Visible tris" value={snap.stats.visibleTriangles.toLocaleString()} />
        <div className={styles.separator} />
        <Row label="Size X" value={snap.boundsSize[0].toFixed(3)} />
        <Row label="Size Y" value={snap.boundsSize[1].toFixed(3)} />
        <Row label="Size Z" value={snap.boundsSize[2].toFixed(3)} />
        <div className={styles.separator} />
        <Row label="Resolution" value={`${state.stats.width} × ${state.stats.height}`} />
        <Row
          label="Samples"
          value={`${state.stats.accumulatedSamples} / ${state.settings.targetSpp}`}
        />
        <Row
          label="Status"
          value={
            state.stats.converged
              ? 'Converged'
              : state.stats.accumulatedSamples === 0
                ? 'Idle'
                : 'Tracing…'
          }
        />
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }): React.ReactNode {
  return (
    <div className={styles.row}>
      <div className={styles.label}>{label}</div>
      <div className={styles.value}>{value}</div>
    </div>
  );
}
