struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0),
  );
  let p = positions[vi];
  var out: VSOut;
  out.pos = vec4<f32>(p, 0.0, 1.0);
  out.uv = p * 0.5 + vec2<f32>(0.5);
  return out;
}

struct PresentUBO {
  width: u32,
  height: u32,
  _pad0: u32,
  _pad1: u32,
};

@group(0) @binding(0) var<uniform> info: PresentUBO;
@group(0) @binding(1) var<storage, read> accum: array<vec4<f32>>;

fn acesTonemap(x: vec3<f32>) -> vec3<f32> {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3<f32>(0.0), vec3<f32>(1.0));
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4<f32> {
  let uv = vec2<f32>(in.uv.x, 1.0 - in.uv.y);
  var px = i32(uv.x * f32(info.width));
  var py = i32(uv.y * f32(info.height));
  if (px < 0) { px = 0; }
  if (py < 0) { py = 0; }
  if (px >= i32(info.width)) { px = i32(info.width) - 1; }
  if (py >= i32(info.height)) { py = i32(info.height) - 1; }
  let idx = u32(py) * info.width + u32(px);
  let data = accum[idx];
  let samples = max(data.w, 1.0);
  var color = data.xyz / samples;
  color = acesTonemap(color);
  color = pow(color, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(color, 1.0);
}
