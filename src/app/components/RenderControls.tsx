import styles from './RenderControls.module.css';
import { useEngine } from '../AppContext';
import { useEngineState } from '../hooks/useEngineState';

export function RenderControls(): React.ReactNode {
  const engine = useEngine();
  const state = useEngineState(engine);
  const { settings, stats } = state;

  const onSppChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Math.max(1, Math.min(4096, parseInt(e.target.value, 10) || 1));
    engine.setSettings({ targetSpp: v });
  };
  const onBouncesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Math.max(1, Math.min(16, parseInt(e.target.value, 10) || 1));
    engine.setSettings({ maxBounces: v });
  };

  const progress = Math.min(1, stats.accumulatedSamples / Math.max(1, settings.targetSpp));

  return (
    <div className={styles.strip}>
      <Field label="SPP target">
        <input
          type="number"
          min={1}
          max={4096}
          step={1}
          value={settings.targetSpp}
          onChange={onSppChange}
          className={styles.input}
          title="Target samples per pixel before the renderer pauses accumulation."
        />
      </Field>
      <Field label="Max bounces">
        <input
          type="number"
          min={1}
          max={16}
          step={1}
          value={settings.maxBounces}
          onChange={onBouncesChange}
          className={styles.input}
          title="Maximum number of diffuse path-tracing bounces per ray."
        />
      </Field>
      <button
        className={styles.button}
        onClick={() => engine.resetAccumulation()}
        title="Clear the accumulated samples and restart rendering from zero."
      >
        Reset
      </button>
      <div className={styles.progress}>
        <div className={styles.progressFill} style={{ width: `${progress * 100}%` }} />
      </div>
      <div className={styles.status}>
        {stats.accumulatedSamples} / {settings.targetSpp} spp
      </div>
    </div>
  );
}

function Field(props: { label: string; children: React.ReactNode }): React.ReactNode {
  return (
    <div className={styles.field}>
      <div className={styles.fieldLabel}>{props.label}</div>
      {props.children}
    </div>
  );
}
