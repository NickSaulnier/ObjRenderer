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

struct ISPUBO {
  wbR: f32,
  wbG: f32,
  wbB: f32,
  gamma: f32,
  ccm00: f32,
  ccm01: f32,
  ccm02: f32,
  ccm10: f32,
  ccm11: f32,
  ccm12: f32,
  ccm20: f32,
  ccm21: f32,
  ccm22: f32,
  _padA: f32,
  _padB: f32,
  _padC: f32,
};

@group(0) @binding(0) var<uniform> sensor: SensorUBO;
@group(0) @binding(1) var<uniform> isp: ISPUBO;
@group(0) @binding(2) var<storage, read> rawIn: array<f32>;
@group(0) @binding(3) var<storage, read_write> ispOut: array<vec4<f32>>;

fn rawAt(x: i32, y: i32) -> f32 {
  let xx = clamp(x, 0, i32(sensor.width) - 1);
  let yy = clamp(y, 0, i32(sensor.height) - 1);
  let idx = u32(yy) * sensor.width + u32(xx);
  return rawIn[idx];
}

fn cfaChannel(x: u32, y: u32, cfa: u32) -> u32 {
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

fn debayerBilinear(x: i32, y: i32) -> vec3<f32> {
  if (sensor.cfa == 0u) {
    let m = rawAt(x, y);
    return vec3<f32>(m, m, m);
  }

  let ch = cfaChannel(u32(x), u32(y), sensor.cfa);
  let c = rawAt(x, y);
  let l = rawAt(x - 1, y);
  let r = rawAt(x + 1, y);
  let u = rawAt(x, y - 1);
  let d = rawAt(x, y + 1);
  let ul = rawAt(x - 1, y - 1);
  let ur = rawAt(x + 1, y - 1);
  let dl = rawAt(x - 1, y + 1);
  let dr = rawAt(x + 1, y + 1);

  var rgb = vec3<f32>(0.0);
  if (ch == 0u) {
    rgb.r = c;
    rgb.g = (l + r + u + d) * 0.25;
    rgb.b = (ul + ur + dl + dr) * 0.25;
  } else if (ch == 2u) {
    rgb.b = c;
    rgb.g = (l + r + u + d) * 0.25;
    rgb.r = (ul + ur + dl + dr) * 0.25;
  } else {
    rgb.g = c;
    let rowGreen = cfaChannel(u32(x - 1), u32(y), sensor.cfa) == cfaChannel(u32(x + 1), u32(y), sensor.cfa);
    if (rowGreen) {
      rgb.r = (l + r) * 0.5;
      rgb.b = (u + d) * 0.5;
    } else {
      rgb.r = (u + d) * 0.5;
      rgb.b = (l + r) * 0.5;
    }
  }
  return rgb;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= sensor.width || gid.y >= sensor.height) { return; }
  let idx = gid.y * sensor.width + gid.x;

  let white = f32((1u << sensor.bitDepth) - 1u);
  let black = sensor.blackLevel;

  var rgb = debayerBilinear(i32(gid.x), i32(gid.y));
  rgb = max((rgb - vec3<f32>(black)) / max(1.0, white), vec3<f32>(0.0));

  rgb = rgb * vec3<f32>(isp.wbR, isp.wbG, isp.wbB);

  let ccm = mat3x3<f32>(
    vec3<f32>(isp.ccm00, isp.ccm10, isp.ccm20),
    vec3<f32>(isp.ccm01, isp.ccm11, isp.ccm21),
    vec3<f32>(isp.ccm02, isp.ccm12, isp.ccm22)
  );
  rgb = max(ccm * rgb, vec3<f32>(0.0));

  rgb = pow(rgb, vec3<f32>(1.0 / max(1.0, isp.gamma)));
  ispOut[idx] = vec4<f32>(rgb, 1.0);
}
