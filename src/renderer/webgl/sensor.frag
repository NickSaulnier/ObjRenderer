#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uAccum;
uniform sampler2D uPrnuNoise;
uniform sampler2D uDsnuNoise;

uniform uint uWidth;
uniform uint uHeight;
uniform uint uCfa;
uniform uint uBitDepth;
uniform vec3 uQe;
uniform float uFullWellE;
uniform float uReadNoiseE;
uniform float uDarkCurrentEPerSec;
uniform float uPrnuStd;
uniform float uDsnuStdE;
uniform float uGain;
uniform float uBlackLevel;
uniform float uExposureSec;
uniform uint uFrameSeed;

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

float randn(inout uint state) {
  float u1 = max(1e-6, randf(state));
  float u2 = randf(state);
  return sqrt(-2.0 * log(u1)) * cos(6.28318530718 * u2);
}

float poissonApprox(float mu, inout uint state) {
  if (mu <= 0.0) return 0.0;
  if (mu < 30.0) {
    float limit = exp(-mu);
    float p = 1.0;
    float k = 0.0;
    for (int i = 0; i < 256; i++) {
      k += 1.0;
      p *= max(1e-7, randf(state));
      if (p <= limit) break;
    }
    return max(0.0, k - 1.0);
  }
  return max(0.0, mu + sqrt(mu) * randn(state));
}

uint cfaChannel(uvec2 pix, uint cfa) {
  if (cfa == 0u) return 3u;
  uint xm = pix.x & 1u;
  uint ym = pix.y & 1u;
  if (cfa == 1u) {
    if (ym == 0u && xm == 0u) return 0u;
    if (ym == 1u && xm == 1u) return 2u;
    return 1u;
  }
  if (cfa == 2u) {
    if (ym == 0u && xm == 0u) return 2u;
    if (ym == 1u && xm == 1u) return 0u;
    return 1u;
  }
  if (cfa == 3u) {
    if (ym == 0u && xm == 1u) return 0u;
    if (ym == 1u && xm == 0u) return 2u;
    return 1u;
  }
  if (ym == 0u && xm == 1u) return 2u;
  if (ym == 1u && xm == 0u) return 0u;
  return 1u;
}

void main() {
  uvec2 pix = uvec2(gl_FragCoord.xy);
  vec4 ac = texelFetch(uAccum, ivec2(pix), 0);
  float samples = max(ac.w, 1.0);
  vec3 rgb = ac.xyz / samples;

  uint state = pcgHash(pix.x * 1973u + pix.y * 9277u + uFrameSeed * 131u);
  uint ch = cfaChannel(pix, uCfa);
  float qe = uQe.y;
  float signal = rgb.y;
  if (ch == 0u) {
    qe = uQe.x;
    signal = rgb.x;
  } else if (ch == 2u) {
    qe = uQe.z;
    signal = rgb.z;
  } else if (ch == 3u) {
    qe = (uQe.x + uQe.y + uQe.z) / 3.0;
    signal = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  }

  float photons = max(0.0, signal) * uExposureSec * 10000.0;
  float e = poissonApprox(photons * qe, state);
  e += poissonApprox(uDarkCurrentEPerSec * uExposureSec, state);

  float prnu = texelFetch(uPrnuNoise, ivec2(pix), 0).r;
  float dsnu = texelFetch(uDsnuNoise, ivec2(pix), 0).r;
  e *= (1.0 + prnu * uPrnuStd);
  e += dsnu * uDsnuStdE;
  e = clamp(e, 0.0, uFullWellE);

  float dn = e * uGain + randn(state) * uReadNoiseE * uGain;
  float white = float((1u << uBitDepth) - 1u);
  dn = clamp(round(dn), 0.0, white) + uBlackLevel;

  fragColor = vec4(dn, dn, dn, 1.0);
}
