struct CameraUBO {
  invView: mat4x4<f32>,
  invProj: mat4x4<f32>,
  camPos: vec4<f32>,
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

@group(0) @binding(0) var<uniform> camera: CameraUBO;
@group(0) @binding(1) var<uniform> frame: FrameUBO;
@group(0) @binding(2) var<storage, read_write> accum: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> bvh: array<vec4<f32>>;
@group(0) @binding(4) var<storage, read> tris: array<vec4<f32>>;

fn pcgHash(v: u32) -> u32 {
  var x = v * 747796405u + 2891336453u;
  let word = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (word >> 22u) ^ word;
}

fn randf(state: ptr<function, u32>) -> f32 {
  *state = pcgHash(*state);
  return f32(*state) * (1.0 / 4294967296.0);
}

fn skyColor(dir: vec3<f32>) -> vec3<f32> {
  let t = clamp(0.5 * (dir.y + 1.0), 0.0, 1.0);
  let horizon = vec3<f32>(1.0, 1.0, 1.0);
  let zenith = vec3<f32>(0.45, 0.65, 1.0);
  let sky = mix(horizon, zenith, t);
  let sunDir = normalize(vec3<f32>(0.5, 0.8, 0.3));
  let sun = pow(max(dot(dir, sunDir), 0.0), 200.0) * 6.0;
  return sky + vec3<f32>(sun);
}

fn triV0(i: u32) -> vec3<f32> { return tris[i * 6u + 0u].xyz; }
fn triV1(i: u32) -> vec3<f32> { return tris[i * 6u + 1u].xyz; }
fn triV2(i: u32) -> vec3<f32> { return tris[i * 6u + 2u].xyz; }
fn triN0(i: u32) -> vec3<f32> { return tris[i * 6u + 3u].xyz; }
fn triN1(i: u32) -> vec3<f32> { return tris[i * 6u + 4u].xyz; }
fn triN2(i: u32) -> vec3<f32> { return tris[i * 6u + 5u].xyz; }

struct Hit {
  t: f32,
  triIdx: u32,
  u: f32,
  v: f32,
  hit: bool,
};

fn intersectTri(
  ro: vec3<f32>,
  rd: vec3<f32>,
  triIdx: u32,
  tMax: f32,
) -> vec3<f32> {
  let v0 = triV0(triIdx);
  let v1 = triV1(triIdx);
  let v2 = triV2(triIdx);
  let e1 = v1 - v0;
  let e2 = v2 - v0;
  let p = cross(rd, e2);
  let det = dot(e1, p);
  if (abs(det) < 1e-10) {
    return vec3<f32>(-1.0, 0.0, 0.0);
  }
  let invDet = 1.0 / det;
  let s = ro - v0;
  let u = dot(s, p) * invDet;
  if (u < 0.0 || u > 1.0) {
    return vec3<f32>(-1.0, 0.0, 0.0);
  }
  let q = cross(s, e1);
  let v = dot(rd, q) * invDet;
  if (v < 0.0 || u + v > 1.0) {
    return vec3<f32>(-1.0, 0.0, 0.0);
  }
  let t = dot(e2, q) * invDet;
  if (t <= 1e-4 || t >= tMax) {
    return vec3<f32>(-1.0, 0.0, 0.0);
  }
  return vec3<f32>(t, u, v);
}

fn intersectAabb(
  ro: vec3<f32>,
  invDir: vec3<f32>,
  bmin: vec3<f32>,
  bmax: vec3<f32>,
  tMax: f32,
) -> f32 {
  let t0 = (bmin - ro) * invDir;
  let t1 = (bmax - ro) * invDir;
  let tsmall = min(t0, t1);
  let tbig = max(t0, t1);
  let tNear = max(max(tsmall.x, tsmall.y), tsmall.z);
  let tFar = min(min(tbig.x, tbig.y), tbig.z);
  if (tFar < max(tNear, 0.0) || tNear > tMax) {
    return -1.0;
  }
  return max(tNear, 0.0);
}

fn traceClosest(ro: vec3<f32>, rd: vec3<f32>) -> Hit {
  var hit: Hit;
  hit.hit = false;
  hit.t = 1e30;
  hit.triIdx = 0u;
  hit.u = 0.0;
  hit.v = 0.0;

  if (frame.triCount == 0u) {
    return hit;
  }

  let invDir = vec3<f32>(
    select(1.0 / rd.x, 1e30, abs(rd.x) < 1e-20),
    select(1.0 / rd.y, 1e30, abs(rd.y) < 1e-20),
    select(1.0 / rd.z, 1e30, abs(rd.z) < 1e-20),
  );

  var stack: array<u32, 32>;
  var sp: i32 = 0;
  stack[0] = 0u;
  sp = 1;

  while (sp > 0) {
    sp = sp - 1;
    let nodeIdx = stack[sp];
    let a = bvh[nodeIdx * 2u + 0u];
    let b = bvh[nodeIdx * 2u + 1u];
    let bmin = a.xyz;
    let bmax = b.xyz;
    let tBox = intersectAabb(ro, invDir, bmin, bmax, hit.t);
    if (tBox < 0.0) { continue; }

    let primCount = bitcast<u32>(b.w);
    let leftOrFirst = bitcast<u32>(a.w);

    if (primCount > 0u) {
      for (var i: u32 = 0u; i < primCount; i = i + 1u) {
        let triIdx = leftOrFirst + i;
        let res = intersectTri(ro, rd, triIdx, hit.t);
        if (res.x > 0.0) {
          hit.t = res.x;
          hit.u = res.y;
          hit.v = res.z;
          hit.triIdx = triIdx;
          hit.hit = true;
        }
      }
    } else {
      if (sp < 30) {
        stack[sp] = leftOrFirst;
        sp = sp + 1;
        stack[sp] = leftOrFirst + 1u;
        sp = sp + 1;
      }
    }
  }
  return hit;
}

fn cosineSampleHemisphere(n: vec3<f32>, state: ptr<function, u32>) -> vec3<f32> {
  let r1 = randf(state);
  let r2 = randf(state);
  let phi = 6.2831853 * r1;
  let cosTheta = sqrt(1.0 - r2);
  let sinTheta = sqrt(r2);
  let x = cos(phi) * sinTheta;
  let y = sin(phi) * sinTheta;
  let z = cosTheta;
  var upVec = vec3<f32>(0.0, 0.0, 1.0);
  if (abs(n.z) > 0.999) { upVec = vec3<f32>(1.0, 0.0, 0.0); }
  let tangent = normalize(cross(upVec, n));
  let bitangent = cross(n, tangent);
  return normalize(x * tangent + y * bitangent + z * n);
}

fn pathTrace(initRo: vec3<f32>, initRd: vec3<f32>, state: ptr<function, u32>) -> vec3<f32> {
  var ro = initRo;
  var rd = initRd;
  var radiance = vec3<f32>(0.0);
  var throughput = vec3<f32>(1.0);
  let albedo = vec3<f32>(0.75, 0.75, 0.75);

  let maxB = frame.maxBounces;
  for (var bounce: u32 = 0u; bounce < maxB; bounce = bounce + 1u) {
    let hit = traceClosest(ro, rd);
    if (!hit.hit) {
      radiance = radiance + throughput * skyColor(rd);
      break;
    }
    let w = 1.0 - hit.u - hit.v;
    var n = normalize(
      triN0(hit.triIdx) * w + triN1(hit.triIdx) * hit.u + triN2(hit.triIdx) * hit.v
    );
    if (dot(n, rd) > 0.0) { n = -n; }

    throughput = throughput * albedo;

    if (bounce >= 3u) {
      let q = max(throughput.x, max(throughput.y, throughput.z));
      let qc = min(q, 0.95);
      if (randf(state) > qc) {
        break;
      }
      throughput = throughput / qc;
    }

    ro = ro + rd * hit.t + n * 1e-4;
    rd = cosineSampleHemisphere(n, state);
  }
  return radiance;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= frame.width || gid.y >= frame.height) { return; }
  let idx = gid.y * frame.width + gid.x;
  var state: u32 = pcgHash(
    pcgHash(gid.x * 1973u + gid.y * 9277u) ^ (frame.frameSeed + frame.sampleIndex * 26699u)
  );

  let jx = randf(&state);
  let jy = randf(&state);
  let ndc = vec2<f32>(
    (f32(gid.x) + jx) / f32(frame.width) * 2.0 - 1.0,
    1.0 - (f32(gid.y) + jy) / f32(frame.height) * 2.0,
  );

  let pNear = camera.invProj * vec4<f32>(ndc, 0.0, 1.0);
  let dirView = normalize(pNear.xyz / pNear.w);
  let dirWorld = normalize((camera.invView * vec4<f32>(dirView, 0.0)).xyz);
  let ro = camera.camPos.xyz;

  let color = pathTrace(ro, dirWorld, &state);
  let prev = accum[idx];
  let newSum = prev.xyz + color;
  let newCount = prev.w + 1.0;
  accum[idx] = vec4<f32>(newSum, newCount);
}
