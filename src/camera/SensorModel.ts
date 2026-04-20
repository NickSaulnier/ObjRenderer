export type CfaPattern = 'mono' | 'RGGB' | 'BGGR' | 'GRBG' | 'GBRG';

export interface SensorModel {
  width: number;
  height: number;
  pixelPitchUm: number;
  cfa: CfaPattern;
  qe: [number, number, number];
  fullWellE: number;
  readNoiseE: number;
  darkCurrentEPerSec: number;
  prnuStd: number;
  dsnuStdE: number;
  gain: number;
  bitDepth: number;
  blackLevel: number;
  exposureSec: number;
  iso: number;
}

export interface SensorFPN {
  prnu: Float32Array;
  dsnu: Float32Array;
}

export const DEFAULT_SENSOR: SensorModel = {
  width: 1280,
  height: 720,
  pixelPitchUm: 3.45,
  cfa: 'RGGB',
  qe: [0.45, 0.5, 0.35],
  fullWellE: 12000,
  readNoiseE: 2,
  darkCurrentEPerSec: 0.08,
  prnuStd: 0.01,
  dsnuStdE: 0.35,
  gain: 1,
  bitDepth: 12,
  blackLevel: 64,
  exposureSec: 0.01,
  iso: 100,
};

export function normalizeSensor(sensor: Partial<SensorModel> | undefined): SensorModel {
  const merged: SensorModel = {
    ...DEFAULT_SENSOR,
    ...sensor,
  };
  merged.width = Math.max(1, Math.floor(merged.width));
  merged.height = Math.max(1, Math.floor(merged.height));
  merged.pixelPitchUm = clamp(merged.pixelPitchUm, 0.5, 20);
  merged.qe = [
    clamp(merged.qe[0], 0.01, 1),
    clamp(merged.qe[1], 0.01, 1),
    clamp(merged.qe[2], 0.01, 1),
  ];
  merged.fullWellE = clamp(merged.fullWellE, 100, 200000);
  merged.readNoiseE = clamp(merged.readNoiseE, 0, 100);
  merged.darkCurrentEPerSec = clamp(merged.darkCurrentEPerSec, 0, 1000);
  merged.prnuStd = clamp(merged.prnuStd, 0, 0.25);
  merged.dsnuStdE = clamp(merged.dsnuStdE, 0, 100);
  merged.gain = clamp(merged.gain, 0.1, 32);
  merged.bitDepth = Math.max(8, Math.min(16, Math.floor(merged.bitDepth)));
  merged.blackLevel = Math.max(0, Math.floor(merged.blackLevel));
  merged.exposureSec = clamp(merged.exposureSec, 1e-6, 5);
  merged.iso = clamp(Math.floor(merged.iso), 25, 102400);
  return merged;
}

export function generateFPN(width: number, height: number, seed: number): SensorFPN {
  const len = width * height;
  const prnu = new Float32Array(len);
  const dsnu = new Float32Array(len);
  let state = seed >>> 0;
  for (let i = 0; i < len; i++) {
    const a = randn(state);
    state = a.state;
    const b = randn(state);
    state = b.state;
    prnu[i] = a.value;
    dsnu[i] = b.value;
  }
  return { prnu, dsnu };
}

function randu(stateIn: number): { value: number; state: number } {
  const state = (stateIn * 1664525 + 1013904223) >>> 0;
  return { value: state / 4294967296, state };
}

function randn(stateIn: number): { value: number; state: number } {
  const u1r = randu(stateIn);
  const u2r = randu(u1r.state);
  const u1 = Math.max(1e-8, u1r.value);
  const mag = Math.sqrt(-2 * Math.log(u1));
  const z0 = mag * Math.cos(2 * Math.PI * u2r.value);
  return { value: z0, state: u2r.state };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
