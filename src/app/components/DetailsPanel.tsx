import styles from './DetailsPanel.module.css';
import { useEngine } from '../AppContext';
import { useSceneSnapshot } from '../hooks/useSceneStore';
import { useEngineState } from '../hooks/useEngineState';
import { apertureRadiusMm, lensFovY } from '../../camera/LensModel';

export function DetailsPanel(): React.ReactNode {
  const engine = useEngine();
  const snap = useSceneSnapshot(engine.scene);
  const state = useEngineState(engine);

  const lens = state.lens;
  const sensor = state.sensor;

  const fovDeg = (lensFovY(lens) * 180) / Math.PI;
  const focalM = lens.focalLengthMm / 1000;
  const cocM = (sensor.pixelPitchUm * 2) / 1_000_000;
  const hyperfocalM =
    (focalM * focalM) / Math.max(1e-8, (lens.fNumber || 1) * Math.max(1e-8, cocM)) + focalM;
  const airyDiskUm = 2.44 * 0.55 * lens.fNumber;
  const nominalSignal = sensor.fullWellE * 0.5;
  const snr = nominalSignal / Math.sqrt(Math.max(1e-6, nominalSignal + sensor.readNoiseE ** 2));

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
        <Row label="Resolution" value={`${state.stats.width} � ${state.stats.height}`} />
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
                : 'Tracing�'
          }
        />
        <div className={styles.separator} />
        <Row label="Lens FOV Y" value={`${fovDeg.toFixed(2)}�`} />
        <Row label="Aperture radius" value={`${apertureRadiusMm(lens).toFixed(3)} mm`} />
        <Row label="Hyperfocal" value={`${hyperfocalM.toFixed(3)} m`} />
        <Row label="Airy disk" value={`${airyDiskUm.toFixed(3)} �m`} />
        <Row label="Shot-limited SNR" value={`${snr.toFixed(2)} : 1`} />
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
