export interface LensDistortion {
  k1: number;
  k2: number;
  k3: number;
  p1: number;
  p2: number;
}

export interface RollingShutterConfig {
  enabled: boolean;
  lineTimeUs: number;
}

export interface LensModel {
  focalLengthMm: number;
  fNumber: number;
  focusDistanceM: number;
  sensorWidthMm: number;
  sensorHeightMm: number;
  distortion: LensDistortion;
  rollingShutter: RollingShutterConfig;
}

export const DEFAULT_LENS: LensModel = {
  focalLengthMm: 24,
  fNumber: 2.8,
  focusDistanceM: 3,
  sensorWidthMm: 36,
  sensorHeightMm: 24,
  distortion: {
    k1: 0,
    k2: 0,
    k3: 0,
    p1: 0,
    p2: 0,
  },
  rollingShutter: {
    enabled: false,
    lineTimeUs: 15,
  },
};

export function lensFovY(lens: LensModel): number {
  const focal = Math.max(1e-4, lens.focalLengthMm);
  return 2 * Math.atan((lens.sensorHeightMm * 0.5) / focal);
}

export function lensAspect(lens: LensModel): number {
  return Math.max(1e-4, lens.sensorWidthMm) / Math.max(1e-4, lens.sensorHeightMm);
}

export function apertureRadiusMm(lens: LensModel): number {
  const fnum = Math.max(0.7, lens.fNumber);
  return lens.focalLengthMm / (2 * fnum);
}

export function normalizeLens(lens: Partial<LensModel> | undefined): LensModel {
  const merged: LensModel = {
    ...DEFAULT_LENS,
    ...lens,
    distortion: {
      ...DEFAULT_LENS.distortion,
      ...(lens?.distortion ?? {}),
    },
    rollingShutter: {
      ...DEFAULT_LENS.rollingShutter,
      ...(lens?.rollingShutter ?? {}),
    },
  };

  merged.focalLengthMm = clamp(merged.focalLengthMm, 1, 500);
  merged.fNumber = clamp(merged.fNumber, 0.7, 64);
  merged.focusDistanceM = clamp(merged.focusDistanceM, 0.05, 1000);
  merged.sensorWidthMm = clamp(merged.sensorWidthMm, 1, 100);
  merged.sensorHeightMm = clamp(merged.sensorHeightMm, 1, 100);
  merged.rollingShutter.lineTimeUs = clamp(merged.rollingShutter.lineTimeUs, 1, 10000);
  return merged;
}

export function distortBrownConrady(x: number, y: number, d: LensDistortion): [number, number] {
  const r2 = x * x + y * y;
  const r4 = r2 * r2;
  const r6 = r4 * r2;
  const radial = 1 + d.k1 * r2 + d.k2 * r4 + d.k3 * r6;
  const tx = 2 * d.p1 * x * y + d.p2 * (r2 + 2 * x * x);
  const ty = d.p1 * (r2 + 2 * y * y) + 2 * d.p2 * x * y;
  return [x * radial + tx, y * radial + ty];
}

export function undistortBrownConradyNewton(
  xd: number,
  yd: number,
  d: LensDistortion,
  iters = 5,
): [number, number] {
  let x = xd;
  let y = yd;
  for (let i = 0; i < iters; i++) {
    const [fx, fy] = distortBrownConrady(x, y, d);
    const ex = xd - fx;
    const ey = yd - fy;
    x += ex;
    y += ey;
  }
  return [x, y];
}

export function bakeDistortionLUT(
  width: number,
  height: number,
  distortion: LensDistortion,
): Float32Array {
  const out = new Float32Array(width * height * 2);
  let idx = 0;
  for (let y = 0; y < height; y++) {
    const v = 1 - ((y + 0.5) / Math.max(1, height)) * 2;
    for (let x = 0; x < width; x++) {
      const u = ((x + 0.5) / Math.max(1, width)) * 2 - 1;
      const [ux, uy] = undistortBrownConradyNewton(u, v, distortion);
      out[idx++] = ux;
      out[idx++] = uy;
    }
  }
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
