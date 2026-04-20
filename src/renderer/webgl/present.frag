#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uAccum;
uniform sampler2D uIsp;
uniform uint uCameraMode;

in vec2 vUv;
out vec4 fragColor;

vec3 acesTonemap(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  if (uCameraMode == 1u) {
    vec3 c = texture(uIsp, vUv).rgb;
    fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    return;
  }

  vec4 data = texture(uAccum, vUv);
  float samples = max(data.w, 1.0);
  vec3 color = data.xyz / samples;
  color = acesTonemap(color);
  color = pow(color, vec3(1.0 / 2.2));
  fragColor = vec4(color, 1.0);
}
