import type { LensModel } from './LensModel';
import type { SensorModel } from './SensorModel';
import type { ISPConfig } from './ISP';
import { DEFAULT_ISP } from './ISP';

export interface CameraPreset {
  id: string;
  label: string;
  lens: LensModel;
  sensor: SensorModel;
  isp: ISPConfig;
}

export const CAMERA_PRESETS: CameraPreset[] = [
  {
    id: 'machinevision-mono',
    label: 'Machine Vision Mono 1/1.8"',
    lens: {
      focalLengthMm: 16,
      fNumber: 2,
      focusDistanceM: 2,
      sensorWidthMm: 7.2,
      sensorHeightMm: 5.4,
      distortion: { k1: -0.08, k2: 0.02, k3: 0, p1: 0.0005, p2: -0.0005 },
      rollingShutter: { enabled: false, lineTimeUs: 15 },
    },
    sensor: {
      width: 1280,
      height: 1024,
      pixelPitchUm: 4.8,
      cfa: 'mono',
      qe: [0.62, 0.62, 0.62],
      fullWellE: 18000,
      readNoiseE: 2.1,
      darkCurrentEPerSec: 0.06,
      prnuStd: 0.012,
      dsnuStdE: 0.5,
      gain: 1,
      bitDepth: 12,
      blackLevel: 64,
      exposureSec: 0.005,
      iso: 100,
    },
    isp: { ...DEFAULT_ISP, wbGains: [1, 1, 1] },
  },
  {
    id: 'machinevision-color',
    label: 'Machine Vision Color 1/2.3"',
    lens: {
      focalLengthMm: 8,
      fNumber: 2.2,
      focusDistanceM: 1.8,
      sensorWidthMm: 6.17,
      sensorHeightMm: 4.55,
      distortion: { k1: -0.11, k2: 0.03, k3: 0, p1: 0.0008, p2: -0.0006 },
      rollingShutter: { enabled: true, lineTimeUs: 20 },
    },
    sensor: {
      width: 1920,
      height: 1200,
      pixelPitchUm: 2.8,
      cfa: 'RGGB',
      qe: [0.48, 0.52, 0.39],
      fullWellE: 10500,
      readNoiseE: 2.6,
      darkCurrentEPerSec: 0.11,
      prnuStd: 0.015,
      dsnuStdE: 0.6,
      gain: 1,
      bitDepth: 12,
      blackLevel: 64,
      exposureSec: 0.008,
      iso: 100,
    },
    isp: DEFAULT_ISP,
  },
  {
    id: 'apsc-50mm',
    label: 'APS-C 50mm f/1.8 (consumer)',
    lens: {
      focalLengthMm: 50,
      fNumber: 1.8,
      focusDistanceM: 3,
      sensorWidthMm: 23.5,
      sensorHeightMm: 15.6,
      distortion: { k1: -0.03, k2: 0.004, k3: 0, p1: 0, p2: 0 },
      rollingShutter: { enabled: true, lineTimeUs: 12 },
    },
    sensor: {
      width: 6000,
      height: 4000,
      pixelPitchUm: 3.9,
      cfa: 'RGGB',
      qe: [0.51, 0.56, 0.43],
      fullWellE: 28000,
      readNoiseE: 1.6,
      darkCurrentEPerSec: 0.04,
      prnuStd: 0.01,
      dsnuStdE: 0.25,
      gain: 1,
      bitDepth: 14,
      blackLevel: 256,
      exposureSec: 0.01,
      iso: 100,
    },
    isp: DEFAULT_ISP,
  },
];

export function findPreset(id: string): CameraPreset | undefined {
  return CAMERA_PRESETS.find((p) => p.id === id);
}
