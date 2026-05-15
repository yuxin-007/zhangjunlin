precision highp float;

uniform float uTime;

varying vec3 vWorldPosition;
varying vec3 vLocalPosition;
varying vec3 vWorldNormal;
varying vec2 vUv;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);

  return mix(
    mix(
      mix(hash(i + vec3(0.0, 0.0, 0.0)), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
      mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x),
      f.y
    ),
    mix(
      mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
      mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x),
      f.y
    ),
    f.z
  );
}

void main() {
  vUv = uv;
  vLocalPosition = position;

  vec3 transformed = position;

  float rough = noise(position * vec3(1.0, 7.0, 7.0));
  float fissure = noise(position * vec3(2.5, 18.0, 18.0) + rough * 3.0);
  float microRough = noise(position * vec3(5.0, 28.0, 28.0));
  float displacement = (rough - 0.5) * 0.10
                     + smoothstep(0.68, 1.0, fissure) * 0.05
                     + (microRough - 0.5) * 0.02;
  float thickness = 1.0
                  + sin(uv.y * 6.2832 * 1.7 + 1.2) * 0.06
                  + sin(uv.y * 6.2832 * 4.3 + 3.5) * 0.04;
  transformed += normal * displacement * thickness;

  vec4 world = modelMatrix * vec4(transformed, 1.0);
  vWorldPosition = world.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);

  gl_Position = projectionMatrix * viewMatrix * world;
}
