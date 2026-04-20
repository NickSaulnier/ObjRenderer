struct SensorUBO {
  width: u32,
  height: u32,
  cfa: u32,
  bitDepth: u32,
  qeR: f32,
  qeG: f32,
  qeB: f32,
  fullWellE: f32,
  readNoiseE: f32,
  darkCurrentEPerSec: f32,
  prnuStd: f32,
  dsnuStdE: f32,
  gain: f32,
  blackLevel: f32,
  exposureSec: f32,
  _pad0: f32,
};

struct FrameUBO {
  frameSeed: u32,
  sampleIndex: u32,
  maxBounces: u32,
  width: u32,
  height: u32,
  triCount: u32,
  nodeCount: u32,
  _pad0: u32,
};

@group(0) @binding(0) var<uniform> frame: FrameUBO;
@group(0) @binding(1) var<uniform> sensor: SensorUBO;
@group(0) @binding(2) var<storage, read> accum: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> rawOut: array<f32>;
@group(0) @binding(4) var<storage, read> prnuNoise: array<f32>;
@group(0) @binding(5) var<storage, read> dsnuNoise: array<f32>;

fn pcgHash(v: u32) -> u32 {
  var x = v * 747796405u + 2891336453u;
  let word = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (word >> 22u) ^ word;
}

fn randf(state: ptr<function, u32>) -> f32 {
  *state = pcgHash(*state);
  return f32(*state) * (1.0 / 4294967296.0);
}

fn randn(state: ptr<function, u32>) -> f32 {
  let u1 = max(1e-6, randf(state));
  let u2 = randf(state);
  return sqrt(-2.0 * log(u1)) * cos(6.28318530718 * u2);
}

fn poissonApprox(mu: f32, state: ptr<function, u32>) -> f32 {
  if (mu <= 0.0) {
    return 0.0;
  }
  if (mu < 30.0) {
    let limit = exp(-mu);
    var p = 1.0;
    var k = 0.0;
    loop {
      k = k + 1.0;
      p = p * max(1e-7, randf(state));
      if (p <= limit) { break; }
      if (k > 256.0) { break; }
    }
    return max(0.0, k - 1.0);
  }
  return max(0.0, mu + sqrt(mu) * randn(state));
}

fn cfaChannel(x: u32, y: u32, cfa: u32) -> u32 {
  // 0 mono, 1 RGGB, 2 BGGR, 3 GRBG, 4 GBRG
  if (cfa == 0u) { return 3u; }
  let xm = x & 1u;
  let ym = y & 1u;
  if (cfa == 1u) {
    if (ym == 0u && xm == 0u) { return 0u; }
    if (ym == 1u && xm == 1u) { return 2u; }
    return 1u;
  }
  if (cfa == 2u) {
    if (ym == 0u && xm == 0u) { return 2u; }
    if (ym == 1u && xm == 1u) { return 0u; }
    return 1u;
  }
  if (cfa == 3u) {
    if (ym == 0u && xm == 1u) { return 0u; }
    if (ym == 1u && xm == 0u) { return 2u; }
    return 1u;
  }
  if (ym == 0u && xm == 1u) { return 2u; }
  if (ym == 1u && xm == 0u) { return 0u; }
  return 1u;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= frame.width || gid.y >= frame.height) { return; }
  let idx = gid.y * frame.width + gid.x;

  var state: u32 = pcgHash(pcgHash(idx + frame.frameSeed * 17u) ^ 0xA5A5A5A5u);

  let ac = accum[idx];
  let samples = max(ac.w, 1.0);
  let rgb = ac.xyz / samples;

  let ch = cfaChannel(gid.x, gid.y, sensor.cfa);
  var qe = sensor.qeG;
  var signal = rgb.y;
  if (ch == 0u) {
    qe = sensor.qeR;
    signal = rgb.x;
  } else if (ch == 2u) {
    qe = sensor.qeB;
    signal = rgb.z;
  } else if (ch == 3u) {
    qe = (sensor.qeR + sensor.qeG + sensor.qeB) / 3.0;
    signal = dot(rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  }

  let photons = max(0.0, signal) * sensor.exposureSec * 10000.0;
  var electrons = poissonApprox(photons * qe, &state);
  electrons = electrons + poissonApprox(sensor.darkCurrentEPerSec * sensor.exposureSec, &state);

  electrons = electrons * (1.0 + prnuNoise[idx] * sensor.prnuStd);
  electrons = electrons + dsnuNoise[idx] * sensor.dsnuStdE;
  electrons = clamp(electrons, 0.0, sensor.fullWellE);

  var dn = electrons * sensor.gain;
  dn = dn + randn(&state) * sensor.readNoiseE * sensor.gain;

  let white = f32((1u << sensor.bitDepth) - 1u);
  dn = clamp(round(dn), 0.0, white) + sensor.blackLevel;
  rawOut[idx] = dn;
}
