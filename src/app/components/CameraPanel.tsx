import { useEffect, useRef, useState } from 'react';
import styles from './CameraPanel.module.css';
import { useEngine } from '../AppContext';
import { useEngineState } from '../hooks/useEngineState';
import { useDebouncedCallback } from '../hooks/useDebouncedCallback';

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
            title="Load a predefined lens, sensor, and ISP configuration as a starting point."
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
              title="Show the current rendered image as a processed preview."
            >
              Preview
            </button>
            <button
              className={styles.button}
              data-active={state.cameraMode === 'sensor-capture'}
              onClick={() => engine.setCameraMode('sensor-capture')}
              title="Show the image after simulating the sensor and ISP pipeline."
            >
              Sensor
            </button>
          </div>
          <button
            className={styles.capture}
            onClick={onCapture}
            title="Capture the current frame and export processed RGB, simulated RAW, and metadata JSON."
          >
            Capture RGB + RAW + JSON
          </button>
        </div>

        <LensGroup />
        <SensorGroup />
        <ShutterGroup />
        <ISPGroup />

        <div className={styles.group}>
          <div className={styles.groupTitle}>Validation</div>
          <button
            className={styles.capture}
            onClick={() => void engine.validateFlatFieldCapture()}
            title="Run a flat-field check to compare expected and measured sensor mean and variance."
          >
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
      <SliderRow
        label="Focal (mm)"
        value={lens.focalLengthMm}
        onChange={(v) => engine.setLens({ focalLengthMm: v })}
        tooltip="Lens focal length in millimeters. Larger values narrow the field of view and magnify the model."
        min={1}
        max={500}
        step={0.1}
      />
      <SliderRow
        label="f-number"
        value={lens.fNumber}
        onChange={(v) => engine.setLens({ fNumber: v })}
        tooltip="Aperture ratio. Lower values mean a wider aperture, shallower depth of field, and more light."
        min={0.7}
        max={64}
        step={0.1}
      />
      <NumberRow
        label="Focus (m)"
        value={lens.focusDistanceM}
        onChange={(v) => engine.setLens({ focusDistanceM: v })}
        tooltip="Distance from the lens plane where the image is sharpest."
        min={0.05}
        max={1000}
        step={0.01}
      />
      <SliderRow
        label="Sensor W (mm)"
        value={lens.sensorWidthMm}
        onChange={(v) => engine.setLens({ sensorWidthMm: v })}
        tooltip="Physical sensor width. Together with focal length this determines horizontal field of view."
        min={1}
        max={100}
        step={0.1}
      />
      <SliderRow
        label="Sensor H (mm)"
        value={lens.sensorHeightMm}
        onChange={(v) => engine.setLens({ sensorHeightMm: v })}
        tooltip="Physical sensor height. Together with focal length this determines vertical field of view."
        min={1}
        max={100}
        step={0.1}
      />
      <SliderRow
        label="k1"
        value={lens.distortion.k1}
        onChange={(v) => engine.setLensDistortion({ k1: v })}
        tooltip="Primary radial distortion term. Negative values usually produce barrel distortion; positive values produce pincushion distortion."
        min={-2}
        max={2}
        step={0.0001}
      />
      <SliderRow
        label="k2"
        value={lens.distortion.k2}
        onChange={(v) => engine.setLensDistortion({ k2: v })}
        tooltip="Secondary radial distortion term for shaping distortion farther from the image center."
        min={-2}
        max={2}
        step={0.0001}
      />
      <SliderRow
        label="k3"
        value={lens.distortion.k3}
        onChange={(v) => engine.setLensDistortion({ k3: v })}
        tooltip="Higher-order radial distortion term for fine control near the frame edges."
        min={-2}
        max={2}
        step={0.0001}
      />
      <SliderRow
        label="p1"
        value={lens.distortion.p1}
        onChange={(v) => engine.setLensDistortion({ p1: v })}
        tooltip="Tangential distortion term from lens/sensor misalignment, skewing the image diagonally."
        min={-1}
        max={1}
        step={0.0001}
      />
      <SliderRow
        label="p2"
        value={lens.distortion.p2}
        onChange={(v) => engine.setLensDistortion({ p2: v })}
        tooltip="Second tangential distortion term from lens/sensor misalignment."
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
          title="Choose the sensor color filter array pattern or mono sensor layout."
        >
          <option value="mono">mono</option>
          <option value="RGGB">RGGB</option>
          <option value="BGGR">BGGR</option>
          <option value="GRBG">GRBG</option>
          <option value="GBRG">GBRG</option>
        </select>
      </div>
      <SliderRow
        label="Pitch (um)"
        value={sensor.pixelPitchUm}
        onChange={(v) => engine.setSensor({ pixelPitchUm: v })}
        tooltip="Pixel pitch in micrometers. Larger pixels collect more light and usually have better low-light performance."
        min={0.5}
        max={20}
        step={0.01}
      />
      <NumberRow
        label="Full well (e-)"
        value={sensor.fullWellE}
        onChange={(v) => engine.setSensor({ fullWellE: v })}
        tooltip="Maximum electrons a pixel can hold before saturating and clipping highlights."
        min={100}
        max={200000}
        step={10}
      />
      <SliderRow
        label="Read noise"
        value={sensor.readNoiseE}
        onChange={(v) => engine.setSensor({ readNoiseE: v })}
        tooltip="Electronic noise added during readout, measured in electrons."
        min={0}
        max={100}
        step={0.01}
      />
      <NumberRow
        label="Dark current"
        value={sensor.darkCurrentEPerSec}
        onChange={(v) => engine.setSensor({ darkCurrentEPerSec: v })}
        tooltip="Thermally generated electrons per second, added even with no light."
        min={0}
        max={1000}
        step={0.001}
      />
      <SliderRow
        label="PRNU std"
        value={sensor.prnuStd}
        onChange={(v) => engine.setSensor({ prnuStd: v })}
        tooltip="Photo-response non-uniformity standard deviation. Higher values create pixel-to-pixel gain variation."
        min={0}
        max={0.25}
        step={0.001}
      />
      <SliderRow
        label="DSNU (e-)"
        value={sensor.dsnuStdE}
        onChange={(v) => engine.setSensor({ dsnuStdE: v })}
        tooltip="Dark signal non-uniformity in electrons. Higher values create per-pixel dark offsets."
        min={0}
        max={100}
        step={0.01}
      />
      <SliderRow
        label="Gain"
        value={sensor.gain}
        onChange={(v) => engine.setSensor({ gain: v })}
        tooltip="Analog amplification applied before quantization. Higher gain brightens the signal and noise together."
        min={0.1}
        max={32}
        step={0.01}
      />
      <SliderRow
        label="Bit depth"
        value={sensor.bitDepth}
        onChange={(v) => engine.setSensor({ bitDepth: Math.round(v) })}
        tooltip="Number of ADC bits used to quantize the sensor signal."
        min={8}
        max={16}
        step={1}
      />
      <NumberRow
        label="Black level"
        value={sensor.blackLevel}
        onChange={(v) => engine.setSensor({ blackLevel: Math.round(v) })}
        tooltip="Offset added to the digital output so zero-light pixels are not stored as pure zero."
        min={0}
        max={4096}
        step={1}
      />
      <NumberRow
        label="Exposure (s)"
        value={sensor.exposureSec}
        onChange={(v) => engine.setSensor({ exposureSec: v })}
        tooltip="Exposure time in seconds. Longer exposures collect more photons and more motion-sensitive signal."
        min={0.000001}
        max={5}
        step={0.0001}
      />
      <NumberRow
        label="ISO"
        value={sensor.iso}
        onChange={(v) => engine.setSensor({ iso: Math.round(v) })}
        tooltip="Convenience sensitivity value stored in metadata for the simulated capture."
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
          title="Expose all rows at the same time."
        >
          Global
        </button>
        <button
          className={styles.button}
          data-active={rs.enabled}
          onClick={() => engine.setRollingShutter({ enabled: true })}
          title="Expose rows sequentially over time, which can skew motion."
        >
          Rolling
        </button>
      </div>
      <NumberRow
        label="Line time (us)"
        value={rs.lineTimeUs}
        onChange={(v) => engine.setRollingShutter({ lineTimeUs: v })}
        tooltip="Time delay in microseconds between one sensor row and the next during rolling-shutter readout."
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
      <SliderRow
        label="WB R"
        value={isp.wbGains[0]}
        onChange={(v) => engine.setISP({ wbGains: [v, isp.wbGains[1], isp.wbGains[2]] })}
        tooltip="Red white-balance multiplier applied after demosaicing."
        min={0.1}
        max={8}
        step={0.01}
      />
      <SliderRow
        label="WB G"
        value={isp.wbGains[1]}
        onChange={(v) => engine.setISP({ wbGains: [isp.wbGains[0], v, isp.wbGains[2]] })}
        tooltip="Green white-balance multiplier applied after demosaicing."
        min={0.1}
        max={8}
        step={0.01}
      />
      <SliderRow
        label="WB B"
        value={isp.wbGains[2]}
        onChange={(v) => engine.setISP({ wbGains: [isp.wbGains[0], isp.wbGains[1], v] })}
        tooltip="Blue white-balance multiplier applied after demosaicing."
        min={0.1}
        max={8}
        step={0.01}
      />
      <SliderRow
        label="Gamma"
        value={isp.gamma}
        onChange={(v) => engine.setISP({ gamma: v })}
        tooltip="Display gamma used for the processed preview image."
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
  tooltip: string;
}): React.ReactNode {
  return (
    <div className={styles.row}>
      <div className={styles.label} title={props.tooltip}>
        {props.label}
      </div>
      <input
        className={styles.input}
        type="number"
        value={Number.isFinite(props.value) ? props.value : 0}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(e) => props.onChange(parseFloat(e.target.value) || 0)}
        title={props.tooltip}
      />
    </div>
  );
}

const SLIDER_DEBOUNCE_MS = 120;

function SliderRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  tooltip: string;
}): React.ReactNode {
  const safeProp = Number.isFinite(props.value) ? props.value : 0;
  const [local, setLocal] = useState<number>(safeProp);
  const lastCommitted = useRef<number>(safeProp);

  useEffect(() => {
    if (safeProp !== lastCommitted.current) {
      lastCommitted.current = safeProp;
      setLocal(safeProp);
    }
  }, [safeProp]);

  const commit = useDebouncedCallback((v: number) => {
    lastCommitted.current = v;
    props.onChange(v);
  }, SLIDER_DEBOUNCE_MS);

  const handle = (raw: string) => {
    const v = parseFloat(raw);
    const next = Number.isFinite(v) ? v : 0;
    setLocal(next);
    commit(next);
  };

  return (
    <div className={styles.sliderRow}>
      <div className={styles.label} title={props.tooltip}>
        {props.label}
      </div>
      <input
        className={styles.slider}
        type="range"
        value={local}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(e) => handle(e.target.value)}
        title={props.tooltip}
      />
      <input
        className={styles.sliderNumber}
        type="number"
        value={local}
        min={props.min}
        max={props.max}
        step={props.step}
        onChange={(e) => handle(e.target.value)}
        title={props.tooltip}
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
