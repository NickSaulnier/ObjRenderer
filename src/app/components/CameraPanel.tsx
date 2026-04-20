import styles from './CameraPanel.module.css';
import { useEngine } from '../AppContext';
import { useEngineState } from '../hooks/useEngineState';

export function CameraPanel(): React.ReactNode {
  const engine = useEngine();
  const state = useEngineState(engine);

  const onCapture = async () => {
    const captured = await engine.capture();
    if (!captured) return;

    const rgbUrl = URL.createObjectURL(captured.rgbPng);
    const rawUrl = URL.createObjectURL(captured.rawPng);
    const metaBlob = new Blob([JSON.stringify(captured.metadata, null, 2)], {
      type: 'application/json',
    });
    const metaUrl = URL.createObjectURL(metaBlob);

    download(rgbUrl, 'capture-rgb.png');
    download(rawUrl, 'capture-raw.png');
    download(metaUrl, 'capture-raw.json');

    URL.revokeObjectURL(rgbUrl);
    URL.revokeObjectURL(rawUrl);
    URL.revokeObjectURL(metaUrl);
  };

  return (
    <div className={styles.panel}>
      <div className={styles.header}>Camera</div>
      <div className={styles.body}>
        <div className={styles.group}>
          <div className={styles.groupTitle}>Preset</div>
          <select
            className={styles.select}
            value={state.presetId}
            onChange={(e) => engine.applyCameraPreset(e.target.value)}
          >
            {engine.getCameraPresets().map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.group}>
          <div className={styles.groupTitle}>Mode</div>
          <div className={styles.toggleRow}>
            <button
              className={styles.button}
              data-active={state.cameraMode === 'photoreal-preview'}
              onClick={() => engine.setCameraMode('photoreal-preview')}
            >
              Preview
            </button>
            <button
              className={styles.button}
              data-active={state.cameraMode === 'sensor-capture'}
              onClick={() => engine.setCameraMode('sensor-capture')}
            >
              Sensor
            </button>
          </div>
          <button className={styles.capture} onClick={onCapture}>
            Capture RGB + RAW + JSON
          </button>
        </div>

        <LensGroup />
        <SensorGroup />
        <ShutterGroup />
        <ISPGroup />

        <div className={styles.group}>
          <div className={styles.groupTitle}>Validation</div>
          <button className={styles.capture} onClick={() => void engine.validateFlatFieldCapture()}>
            Flat-field validation
          </button>
          {state.flatFieldValidation ? (
            <>
              <Field
                label="Expected mean"
                value={state.flatFieldValidation.expectedMean.toFixed(2)}
              />
              <Field
                label="Measured mean"
                value={state.flatFieldValidation.measuredMean.toFixed(2)}
              />
              <Field
                label="Expected var"
                value={state.flatFieldValidation.expectedVariance.toFixed(2)}
              />
              <Field
                label="Measured var"
                value={state.flatFieldValidation.measuredVariance.toFixed(2)}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function LensGroup(): React.ReactNode {
  const engine = useEngine();
  const state = useEngineState(engine);
  const lens = state.lens;
  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>Lens</div>
      <NumberRow
        label="Focal (mm)"
        value={lens.focalLengthMm}
        onChange={(v) => engine.setLens({ focalLengthMm: v })}
        min={1}
        max={500}
        step={0.1}
      />
      <NumberRow
        label="f-number"
        value={lens.fNumber}
        onChange={(v) => engine.setLens({ fNumber: v })}
        min={0.7}
        max={64}
        step={0.1}
      />
      <NumberRow
        label="Focus (m)"
        value={lens.focusDistanceM}
        onChange={(v) => engine.setLens({ focusDistanceM: v })}
        min={0.05}
        max={1000}
        step={0.01}
      />
      <NumberRow
        label="Sensor W (mm)"
        value={lens.sensorWidthMm}
        onChange={(v) => engine.setLens({ sensorWidthMm: v })}
        min={1}
        max={100}
        step={0.1}
      />
      <NumberRow
        label="Sensor H (mm)"
        value={lens.sensorHeightMm}
        onChange={(v) => engine.setLens({ sensorHeightMm: v })}
        min={1}
        max={100}
        step={0.1}
      />
      <NumberRow
        label="k1"
        value={lens.distortion.k1}
        onChange={(v) => engine.setLensDistortion({ k1: v })}
        min={-2}
        max={2}
        step={0.0001}
      />
      <NumberRow
        label="k2"
        value={lens.distortion.k2}
        onChange={(v) => engine.setLensDistortion({ k2: v })}
        min={-2}
        max={2}
        step={0.0001}
      />
      <NumberRow
        label="k3"
        value={lens.distortion.k3}
        onChange={(v) => engine.setLensDistortion({ k3: v })}
        min={-2}
        max={2}
        step={0.0001}
      />
      <NumberRow
        label="p1"
        value={lens.distortion.p1}
        onChange={(v) => engine.setLensDistortion({ p1: v })}
        min={-1}
        max={1}
        step={0.0001}
      />
      <NumberRow
        label="p2"
        value={lens.distortion.p2}
        onChange={(v) => engine.setLensDistortion({ p2: v })}
        min={-1}
        max={1}
        step={0.0001}
      />
    </div>
  );
}

function SensorGroup(): React.ReactNode {
  const engine = useEngine();
  const state = useEngineState(engine);
  const sensor = state.sensor;
  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>Sensor</div>
      <div className={styles.row}>
        <div className={styles.label}>CFA</div>
        <select
          className={styles.select}
          value={sensor.cfa}
          onChange={(e) => engine.setSensor({ cfa: e.target.value as typeof sensor.cfa })}
        >
          <option value="mono">mono</option>
          <option value="RGGB">RGGB</option>
          <option value="BGGR">BGGR</option>
          <option value="GRBG">GRBG</option>
          <option value="GBRG">GBRG</option>
        </select>
      </div>
      <NumberRow
        label="Pitch (um)"
        value={sensor.pixelPitchUm}
        onChange={(v) => engine.setSensor({ pixelPitchUm: v })}
        min={0.5}
        max={20}
        step={0.01}
      />
      <NumberRow
        label="Full well (e-)"
        value={sensor.fullWellE}
        onChange={(v) => engine.setSensor({ fullWellE: v })}
        min={100}
        max={200000}
        step={10}
      />
      <NumberRow
        label="Read noise"
        value={sensor.readNoiseE}
        onChange={(v) => engine.setSensor({ readNoiseE: v })}
        min={0}
        max={100}
        step={0.01}
      />
      <NumberRow
        label="Dark current"
        value={sensor.darkCurrentEPerSec}
        onChange={(v) => engine.setSensor({ darkCurrentEPerSec: v })}
        min={0}
        max={1000}
        step={0.001}
      />
      <NumberRow
        label="PRNU std"
        value={sensor.prnuStd}
        onChange={(v) => engine.setSensor({ prnuStd: v })}
        min={0}
        max={0.25}
        step={0.001}
      />
      <NumberRow
        label="DSNU (e-)"
        value={sensor.dsnuStdE}
        onChange={(v) => engine.setSensor({ dsnuStdE: v })}
        min={0}
        max={100}
        step={0.01}
      />
      <NumberRow
        label="Gain"
        value={sensor.gain}
        onChange={(v) => engine.setSensor({ gain: v })}
        min={0.1}
        max={32}
        step={0.01}
      />
      <NumberRow
        label="Bit depth"
        value={sensor.bitDepth}
        onChange={(v) => engine.setSensor({ bitDepth: Math.round(v) })}
        min={8}
        max={16}
        step={1}
      />
      <NumberRow
        label="Black level"
        value={sensor.blackLevel}
        onChange={(v) => engine.setSensor({ blackLevel: Math.round(v) })}
        min={0}
        max={4096}
        step={1}
      />
      <NumberRow
        label="Exposure (s)"
        value={sensor.exposureSec}
        onChange={(v) => engine.setSensor({ exposureSec: v })}
        min={0.000001}
        max={5}
        step={0.0001}
      />
      <NumberRow
        label="ISO"
        value={sensor.iso}
        onChange={(v) => engine.setSensor({ iso: Math.round(v) })}
        min={25}
        max={102400}
        step={1}
      />
    </div>
  );
}

function ShutterGroup(): React.ReactNode {
  const engine = useEngine();
  const state = useEngineState(engine);
  const rs = state.lens.rollingShutter;
  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>Shutter</div>
      <div className={styles.toggleRow}>
        <button
          className={styles.button}
          data-active={!rs.enabled}
          onClick={() => engine.setRollingShutter({ enabled: false })}
        >
          Global
        </button>
        <button
          className={styles.button}
          data-active={rs.enabled}
          onClick={() => engine.setRollingShutter({ enabled: true })}
        >
          Rolling
        </button>
      </div>
      <NumberRow
        label="Line time (us)"
        value={rs.lineTimeUs}
        onChange={(v) => engine.setRollingShutter({ lineTimeUs: v })}
        min={1}
        max={10000}
        step={1}
      />
    </div>
  );
}

function ISPGroup(): React.ReactNode {
  const engine = useEngine();
  const state = useEngineState(engine);
  const isp = state.isp;
  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>ISP</div>
      <NumberRow
        label="WB R"
        value={isp.wbGains[0]}
        onChange={(v) => engine.setISP({ wbGains: [v, isp.wbGains[1], isp.wbGains[2]] })}
        min={0.1}
        max={8}
        step={0.01}
      />
      <NumberRow
        label="WB G"
        value={isp.wbGains[1]}
        onChange={(v) => engine.setISP({ wbGains: [isp.wbGains[0], v, isp.wbGains[2]] })}
        min={0.1}
        max={8}
        step={0.01}
      />
      <NumberRow
        label="WB B"
        value={isp.wbGains[2]}
        onChange={(v) => engine.setISP({ wbGains: [isp.wbGains[0], isp.wbGains[1], v] })}
        min={0.1}
        max={8}
        step={0.01}
      />
      <NumberRow
        label="Gamma"
        value={isp.gamma}
        onChange={(v) => engine.setISP({ gamma: v })}
        min={1}
        max={3}
        step={0.01}
      />
    </div>
  );
}

function NumberRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}): React.ReactNode {
  return (
    <div className={styles.row}>
      <div className={styles.label}>{props.label}</div>
      <input
        className={styles.input}
        type="number"
        value={Number.isFinite(props.value) ? props.value : 0}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(e) => props.onChange(parseFloat(e.target.value) || 0)}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }): React.ReactNode {
  return (
    <div className={styles.row}>
      <div className={styles.label}>{label}</div>
      <div className={styles.label}>{value}</div>
    </div>
  );
}

function download(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
}
