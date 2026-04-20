import type { SensorModel } from './SensorModel';

export interface ValidationResult {
  expectedMean: number;
  measuredMean: number;
  expectedVariance: number;
  measuredVariance: number;
}

export function validateFlatField(sensor: SensorModel, rawDn: Float32Array): ValidationResult {
  const n = Math.max(1, rawDn.length);
  let sum = 0;
  for (let i = 0; i < rawDn.length; i++) sum += rawDn[i];
  const measuredMean = sum / n;

  let varSum = 0;
  for (let i = 0; i < rawDn.length; i++) {
    const d = rawDn[i] - measuredMean;
    varSum += d * d;
  }
  const measuredVariance = varSum / n;

  // Approximation in DN-domain: var ~ shot + dark + read^2, scaled by gain.
  const shotE = sensor.fullWellE * 0.5;
  const darkE = sensor.darkCurrentEPerSec * sensor.exposureSec;
  const expectedMean = (shotE + darkE) * sensor.gain + sensor.blackLevel;
  const expectedVariance =
    (shotE + darkE + sensor.readNoiseE * sensor.readNoiseE) * sensor.gain * sensor.gain;

  return {
    expectedMean,
    measuredMean,
    expectedVariance,
    measuredVariance,
  };
}
