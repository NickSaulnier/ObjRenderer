#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;

uniform sampler2D uRaw;
uniform uint uWidth;
uniform uint uHeight;
uniform uint uCfa;
uniform uint uBitDepth;
uniform float uBlackLevel;
uniform vec3 uWb;
uniform mat3 uCcm;
uniform float uGamma;

in vec2 vUv;
out vec4 fragColor;

float rawAt(ivec2 p) {
  ivec2 c = clamp(p, ivec2(0), ivec2(int(uWidth) - 1, int(uHeight) - 1));
  return texelFetch(uRaw, c, 0).r;
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

vec3 debayerBilinear(ivec2 p) {
  if (uCfa == 0u) {
    float m = rawAt(p);
    return vec3(m);
  }

  uint ch = cfaChannel(uvec2(p), uCfa);
  float c = rawAt(p);
  float l = rawAt(p + ivec2(-1, 0));
  float r = rawAt(p + ivec2(1, 0));
  float u = rawAt(p + ivec2(0, -1));
  float d = rawAt(p + ivec2(0, 1));
  float ul = rawAt(p + ivec2(-1, -1));
  float ur = rawAt(p + ivec2(1, -1));
  float dl = rawAt(p + ivec2(-1, 1));
  float dr = rawAt(p + ivec2(1, 1));

  vec3 rgb = vec3(0.0);
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
    bool rowGreen = cfaChannel(uvec2(p + ivec2(-1, 0)), uCfa) == cfaChannel(uvec2(p + ivec2(1, 0)), uCfa);
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

void main() {
  ivec2 pix = ivec2(gl_FragCoord.xy);
  vec3 rgb = debayerBilinear(pix);

  float white = float((1u << uBitDepth) - 1u);
  rgb = max((rgb - vec3(uBlackLevel)) / max(1.0, white), vec3(0.0));

  rgb *= uWb;
  rgb = max(uCcm * rgb, vec3(0.0));
  rgb = pow(rgb, vec3(1.0 / max(1.0, uGamma)));

  fragColor = vec4(rgb, 1.0);
}
