#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform mat4 uInvView;
uniform mat4 uInvProj;
uniform vec3 uCamPos;
uniform uvec2 uResolution;
uniform uint uFrameSeed;
uniform uint uSampleIndex;
uniform uint uMaxBounces;
uniform uint uTriCount;
uniform uint uNodeCount;

uniform sampler2D uPrevAccum;
uniform sampler2D uBvh;
uniform sampler2D uTris;

uniform uvec2 uBvhDim;
uniform uvec2 uTrisDim;

in vec2 vUv;
out vec4 fragColor;

uint pcgHash(uint v) {
  uint x = v * 747796405u + 2891336453u;
  uint word = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  return (word >> 22u) ^ word;
}

float randf(inout uint state) {
  state = pcgHash(state);
  return float(state) * (1.0 / 4294967296.0);
}

vec4 fetchBvh(uint index) {
  uint w = uBvhDim.x;
  uint x = index % w;
  uint y = index / w;
  return texelFetch(uBvh, ivec2(int(x), int(y)), 0);
}

vec4 fetchTri(uint index) {
  uint w = uTrisDim.x;
  uint x = index % w;
  uint y = index / w;
  return texelFetch(uTris, ivec2(int(x), int(y)), 0);
}

vec3 triV0(uint i) { return fetchTri(i * 6u + 0u).xyz; }
vec3 triV1(uint i) { return fetchTri(i * 6u + 1u).xyz; }
vec3 triV2(uint i) { return fetchTri(i * 6u + 2u).xyz; }
vec3 triN0(uint i) { return fetchTri(i * 6u + 3u).xyz; }
vec3 triN1(uint i) { return fetchTri(i * 6u + 4u).xyz; }
vec3 triN2(uint i) { return fetchTri(i * 6u + 5u).xyz; }

vec3 skyColor(vec3 dir) {
  float t = clamp(0.5 * (dir.y + 1.0), 0.0, 1.0);
  vec3 horizon = vec3(1.0);
  vec3 zenith = vec3(0.45, 0.65, 1.0);
  vec3 sky = mix(horizon, zenith, t);
  vec3 sunDir = normalize(vec3(0.5, 0.8, 0.3));
  float sun = pow(max(dot(dir, sunDir), 0.0), 200.0) * 6.0;
  return sky + vec3(sun);
}

struct Hit {
  float t;
  uint triIdx;
  float u;
  float v;
  bool hit;
};

vec3 intersectTri(vec3 ro, vec3 rd, uint triIdx, float tMax) {
  vec3 v0 = triV0(triIdx);
  vec3 v1 = triV1(triIdx);
  vec3 v2 = triV2(triIdx);
  vec3 e1 = v1 - v0;
  vec3 e2 = v2 - v0;
  vec3 p = cross(rd, e2);
  float det = dot(e1, p);
  if (abs(det) < 1e-10) return vec3(-1.0, 0.0, 0.0);
  float invDet = 1.0 / det;
  vec3 s = ro - v0;
  float u = dot(s, p) * invDet;
  if (u < 0.0 || u > 1.0) return vec3(-1.0, 0.0, 0.0);
  vec3 q = cross(s, e1);
  float v = dot(rd, q) * invDet;
  if (v < 0.0 || u + v > 1.0) return vec3(-1.0, 0.0, 0.0);
  float t = dot(e2, q) * invDet;
  if (t <= 1e-4 || t >= tMax) return vec3(-1.0, 0.0, 0.0);
  return vec3(t, u, v);
}

float intersectAabb(vec3 ro, vec3 invDir, vec3 bmin, vec3 bmax, float tMax) {
  vec3 t0 = (bmin - ro) * invDir;
  vec3 t1 = (bmax - ro) * invDir;
  vec3 tsmall = min(t0, t1);
  vec3 tbig = max(t0, t1);
  float tNear = max(max(tsmall.x, tsmall.y), tsmall.z);
  float tFar = min(min(tbig.x, tbig.y), tbig.z);
  if (tFar < max(tNear, 0.0) || tNear > tMax) return -1.0;
  return max(tNear, 0.0);
}

Hit traceClosest(vec3 ro, vec3 rd) {
  Hit h;
  h.hit = false;
  h.t = 1e30;
  h.triIdx = 0u;
  h.u = 0.0;
  h.v = 0.0;
  if (uTriCount == 0u) return h;

  vec3 invDir = vec3(
    abs(rd.x) < 1e-20 ? 1e30 : 1.0 / rd.x,
    abs(rd.y) < 1e-20 ? 1e30 : 1.0 / rd.y,
    abs(rd.z) < 1e-20 ? 1e30 : 1.0 / rd.z
  );

  uint stack[32];
  int sp = 0;
  stack[0] = 0u;
  sp = 1;

  while (sp > 0) {
    sp = sp - 1;
    uint nodeIdx = stack[sp];
    vec4 a = fetchBvh(nodeIdx * 2u + 0u);
    vec4 b = fetchBvh(nodeIdx * 2u + 1u);
    vec3 bmin = a.xyz;
    vec3 bmax = b.xyz;
    float tBox = intersectAabb(ro, invDir, bmin, bmax, h.t);
    if (tBox < 0.0) continue;
    uint primCount = floatBitsToUint(b.w);
    uint leftOrFirst = floatBitsToUint(a.w);
    if (primCount > 0u) {
      for (uint i = 0u; i < primCount; i++) {
        uint triIdx = leftOrFirst + i;
        vec3 res = intersectTri(ro, rd, triIdx, h.t);
        if (res.x > 0.0) {
          h.t = res.x;
          h.u = res.y;
          h.v = res.z;
          h.triIdx = triIdx;
          h.hit = true;
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
  return h;
}

vec3 cosineSampleHemisphere(vec3 n, inout uint state) {
  float r1 = randf(state);
  float r2 = randf(state);
  float phi = 6.2831853 * r1;
  float cosTheta = sqrt(1.0 - r2);
  float sinTheta = sqrt(r2);
  float x = cos(phi) * sinTheta;
  float y = sin(phi) * sinTheta;
  float z = cosTheta;
  vec3 upVec = abs(n.z) > 0.999 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 0.0, 1.0);
  vec3 tangent = normalize(cross(upVec, n));
  vec3 bitangent = cross(n, tangent);
  return normalize(x * tangent + y * bitangent + z * n);
}

vec3 pathTrace(vec3 ro, vec3 rd, inout uint state) {
  vec3 radiance = vec3(0.0);
  vec3 throughput = vec3(1.0);
  vec3 albedo = vec3(0.75);
  for (uint bounce = 0u; bounce < uMaxBounces; bounce++) {
    Hit h = traceClosest(ro, rd);
    if (!h.hit) {
      radiance += throughput * skyColor(rd);
      break;
    }
    float w = 1.0 - h.u - h.v;
    vec3 n = normalize(
      triN0(h.triIdx) * w + triN1(h.triIdx) * h.u + triN2(h.triIdx) * h.v
    );
    if (dot(n, rd) > 0.0) n = -n;

    throughput *= albedo;

    if (bounce >= 3u) {
      float q = max(throughput.x, max(throughput.y, throughput.z));
      float qc = min(q, 0.95);
      if (randf(state) > qc) break;
      throughput /= qc;
    }

    ro = ro + rd * h.t + n * 1e-4;
    rd = cosineSampleHemisphere(n, state);
  }
  return radiance;
}

void main() {
  uvec2 pix = uvec2(gl_FragCoord.xy);
  if (pix.x >= uResolution.x || pix.y >= uResolution.y) {
    fragColor = vec4(0.0);
    return;
  }
  uint state = pcgHash(
    pcgHash(pix.x * 1973u + pix.y * 9277u) ^ (uFrameSeed + uSampleIndex * 26699u)
  );

  float jx = randf(state);
  float jy = randf(state);
  vec2 ndc = vec2(
    (float(pix.x) + jx) / float(uResolution.x) * 2.0 - 1.0,
    (float(pix.y) + jy) / float(uResolution.y) * 2.0 - 1.0
  );
  vec4 pNear = uInvProj * vec4(ndc, 0.0, 1.0);
  vec3 dirView = normalize(pNear.xyz / pNear.w);
  vec3 dirWorld = normalize((uInvView * vec4(dirView, 0.0)).xyz);
  vec3 ro = uCamPos;

  vec3 color = pathTrace(ro, dirWorld, state);

  vec4 prev = texelFetch(uPrevAccum, ivec2(pix), 0);
  fragColor = vec4(prev.xyz + color, prev.w + 1.0);
}
