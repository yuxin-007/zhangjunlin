import * as THREE from 'three'

export const MAX_BAND_STAMPS = 32

export const carpetVert = /* glsl */ `
uniform float uShellOffset;

varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vLocalNormal;
varying vec3 vWorldNormal;

void main() {
  vec3 shellPosition = position + normal * uShellOffset;
  vec4 worldPos = modelMatrix * vec4(shellPosition, 1.0);
  vLocalPos = position;
  vWorldPos = worldPos.xyz;
  vLocalNormal = normalize(normal);
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

export const carpetFrag = /* glsl */ `
uniform vec4 uStamp0[${MAX_BAND_STAMPS}]; // centerLocal.xyz + strength
uniform vec4 uStamp1[${MAX_BAND_STAMPS}]; // normalLocal.xyz + radius
uniform vec4 uStamp2[${MAX_BAND_STAMPS}]; // axisS + length + halfArcRad + seed
uniform int uStampCount;
uniform vec3 uBranchAxisWorld;
uniform vec3 uBranchCenterWorld;
uniform sampler2D uMossTex;
uniform float uMossTexScale;
uniform float uTime;
uniform int uDebugMode;

varying vec3 vLocalPos;
varying vec3 vWorldPos;
varying vec3 vLocalNormal;
varying vec3 vWorldNormal;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise2d(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float safeAcos(float x) {
  return acos(clamp(x, -1.0, 1.0));
}

void main() {
  vec3 axis = normalize(uBranchAxisWorld);
  vec3 fromCenter = vWorldPos - uBranchCenterWorld;
  float fragS = dot(fromCenter, axis);
  vec3 axisPoint = uBranchCenterWorld + axis * fragS;
  vec3 radial = vWorldPos - axisPoint;
  float radialLen = length(radial);
  if (radialLen < 0.0001) discard;
  vec3 radialDir = radial / radialLen;

  float carpet = 0.0;
  float root = 0.0;
  float stampSeed = 0.0;

  for (int i = 0; i < ${MAX_BAND_STAMPS}; i++) {
    if (i >= uStampCount) break;

    vec3 stampCenter = uStamp0[i].xyz;
    float strength = uStamp0[i].w;
    if (strength < 0.01) continue;

    vec3 stampNormal = uStamp1[i].xyz;
    vec3 stampRadial = stampNormal - axis * dot(stampNormal, axis);
    if (length(stampRadial) < 0.0001) stampRadial = stampCenter - (uBranchCenterWorld + axis * uStamp2[i].x);
    if (length(stampRadial) < 0.0001) stampRadial = radialDir;
    stampRadial = normalize(stampRadial);

    float axisS = uStamp2[i].x;
    float bandLength = uStamp2[i].y;
    float halfArc = uStamp2[i].z;
    float seed = uStamp2[i].w;

    float axisDist = abs(fragS - axisS);
    float angleDist = safeAcos(dot(radialDir, stampRadial));

    // Broad center, feathered boundary.  This creates one continuous moss carpet
    // for each band stamp instead of many separated circular spots.
    float axisMask = 1.0 - smoothstep(bandLength * 0.38, bandLength * 0.50, axisDist);
    float arcMask = 1.0 - smoothstep(halfArc * 0.74, halfArc, angleDist);

    float localMask = clamp(axisMask * arcMask, 0.0, 1.0);
    localMask = pow(localMask, 0.72);

    // Dark root/contact is strongest near the band core.
    float localRoot = smoothstep(0.30, 0.92, localMask) * strength;
    root = max(root, localRoot);

    carpet += localMask * strength;
    stampSeed += seed * localMask * strength;
  }

  carpet = clamp(carpet, 0.0, 1.0);
  if (carpet < 0.006) discard;

  // Natural broken perimeter but stable dense core.
  float bigNoise = noise2d(vLocalPos.xy * 3.5 + vLocalPos.z * 1.3 + uTime * 0.010);
  float edgeNoise = noise2d(vLocalPos.yz * 9.0 + vLocalPos.x * 2.2 - uTime * 0.015);
  float fiberNoise = noise2d(vLocalPos.xz * 28.0 + vLocalPos.y * 4.0 + uTime * 0.020);

  float edge = smoothstep(0.05, 0.34, carpet);
  float core = smoothstep(0.22, 0.72, carpet);

  float broken = carpet;
  // Break mostly the edge; keep the core cohesive so it reads as a carpet.
  float edgeBreak = smoothstep(0.18, 0.72, bigNoise + carpet * 0.70);
  broken *= mix(edgeBreak, 1.0, core * 0.88);
  broken *= mix(0.86, 1.08, edgeNoise);
  broken *= mix(0.90, 1.10, fiberNoise);
  broken = clamp(broken, 0.0, 1.0);
  if (broken < 0.006) discard;

  // Triplanar moss texture in local space.
  vec3 nBlend = abs(vWorldNormal);
  nBlend = pow(nBlend, vec3(3.0));
  nBlend /= max(nBlend.x + nBlend.y + nBlend.z, 0.0001);
  float ts = uMossTexScale;
  vec3 texX = texture2D(uMossTex, vLocalPos.yz * ts).rgb;
  vec3 texY = texture2D(uMossTex, vLocalPos.xz * ts).rgb;
  vec3 texZ = texture2D(uMossTex, vLocalPos.xy * ts).rgb;
  vec3 texColor = texX * nBlend.x + texY * nBlend.y + texZ * nBlend.z;
  float texLum = dot(texColor, vec3(0.299, 0.587, 0.114));
  float texDetail = smoothstep(0.10, 0.80, texLum);
  float texDark = 1.0 - texDetail;

  vec3 rootDark  = vec3(0.004, 0.020, 0.004);
  vec3 deepGreen = vec3(0.012, 0.070, 0.014);
  vec3 mossGreen = vec3(0.045, 0.190, 0.035);
  vec3 freshGreen = vec3(0.105, 0.300, 0.055);
  vec3 tipGreen = vec3(0.240, 0.340, 0.075);

  vec3 col = mix(rootDark, deepGreen, edge);
  col = mix(col, mossGreen, core * 0.78);
  col = mix(col, freshGreen, texDetail * core * 0.32);
  col = mix(col, tipGreen, pow(texDetail, 3.0) * fiberNoise * core * 0.10);
  col = mix(col, rootDark * 2.2, root * 0.46);
  col = mix(col, col * 0.65, texDark * 0.22);

  float alphaEdge = edge * 0.10;
  float alphaCore = core * 0.86;
  float alpha = (alphaEdge + alphaCore) * broken * mix(0.82, 1.15, texDetail);
  alpha = clamp(alpha, 0.0, 0.88);

  if (uDebugMode == 1) {
    gl_FragColor = vec4(vec3(broken), 1.0);
    return;
  }
  if (uDebugMode == 2) {
    gl_FragColor = vec4(texColor, 1.0);
    return;
  }
  if (uDebugMode == 3) {
    gl_FragColor = vec4(vec3(alpha), 1.0);
    return;
  }

  gl_FragColor = vec4(col, alpha);
}
`

function makeFallbackMossTexture() {
  const data = new Uint8Array([28, 95, 18, 255])
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
  tex.needsUpdate = true
  return tex
}

export function createMossCarpetUniforms() {
  return {
    uStamp0: { value: new Float32Array(MAX_BAND_STAMPS * 4) },
    uStamp1: { value: new Float32Array(MAX_BAND_STAMPS * 4) },
    uStamp2: { value: new Float32Array(MAX_BAND_STAMPS * 4) },
    uStampCount: { value: 0 },
    uBranchAxisWorld: { value: new THREE.Vector3(1, 0, 0) },
    uBranchCenterWorld: { value: new THREE.Vector3(0, 0, 0) },
    uMossTex: { value: makeFallbackMossTexture() },
    uMossTexScale: { value: 8.0 },
    uShellOffset: { value: 0.008 },
    uTime: { value: 0 },
    uDebugMode: { value: 0 },
  }
}

export function createMossCarpetMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: carpetVert,
    fragmentShader: carpetFrag,
    uniforms: createMossCarpetUniforms(),
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
  })
}
