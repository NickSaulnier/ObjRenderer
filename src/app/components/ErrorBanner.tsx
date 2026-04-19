import styles from './ErrorBanner.module.css';
import { useEngine } from '../AppContext';
import { useEngineState } from '../hooks/useEngineState';

export function ErrorBanner(): React.ReactNode {
  const engine = useEngine();
  const state = useEngineState(engine);
  if (state.errors.length === 0) return null;
  return (
    <div className={styles.banner}>
      {state.errors.map((err, i) => (
        <div key={i} className={styles.row}>
          <span className={styles.message}>{err}</span>
          <button className={styles.close} onClick={() => engine.dismissError(i)}>
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
