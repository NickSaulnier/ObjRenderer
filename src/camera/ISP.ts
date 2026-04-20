export interface ISPConfig {
  wbGains: [number, number, number];
  ccm: [number, number, number, number, number, number, number, number, number];
  gamma: number;
  demosaic: 'bilinear';
}

export const DEFAULT_ISP: ISPConfig = {
  wbGains: [1.9, 1.0, 1.7],
  ccm: [1.55, -0.35, -0.2, -0.1, 1.25, -0.15, 0.02, -0.42, 1.4],
  gamma: 2.2,
  demosaic: 'bilinear',
};

export function normalizeISP(cfg: Partial<ISPConfig> | undefined): ISPConfig {
  const merged: ISPConfig = {
    ...DEFAULT_ISP,
    ...cfg,
    wbGains: cfg?.wbGains ?? DEFAULT_ISP.wbGains,
    ccm: cfg?.ccm ?? DEFAULT_ISP.ccm,
  };
  return {
    ...merged,
    wbGains: [
      clamp(merged.wbGains[0], 0.1, 8),
      clamp(merged.wbGains[1], 0.1, 8),
      clamp(merged.wbGains[2], 0.1, 8),
    ],
    gamma: clamp(merged.gamma, 1, 3),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
