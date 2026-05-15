import * as THREE from 'three'

export const MAX_MOSS_POINTS = 120

export const mossVert = /* glsl */ `
varying vec3 vLocalPos;
varying vec3 vWorldNormal;

void main() {
  vec4 worldPos = modelMatrix * vec4(position, 1.0);
  vLocalPos = position;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`

export const mossFrag = /* glsl */ `
uniform vec4 uMossPoints[${MAX_MOSS_POINTS}];
uniform int uMossCount;
uniform float uMossRadius;
uniform sampler2D uMossTex;
uniform float uMossTexScale;
uniform float uTime;
uniform int uDebugMode;

varying vec3 vLocalPos;
varying vec3 vWorldNormal;

// ── noise ──────────────────────────────────────────────────

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

// ── main ───────────────────────────────────────────────────

void main() {
  // — proximity carpet mask —
  // Additive accumulation lets dense cylindrical-band samples merge into a carpet,
  // instead of staying as separated circular spots.
  float mossMask = 0.0;

  for (int i = 0; i < ${MAX_MOSS_POINTS}; i++) {
    if (i >= uMossCount) break;
    vec3 pt = uMossPoints[i].xyz;
    float strength = uMossPoints[i].w;
    if (strength < 0.01) continue;

    float d = distance(vLocalPos, pt);
    if (d < uMossRadius) {
      float visualStrength = pow(clamp(strength, 0.0, 1.0), 0.50);
      float core = 1.0 - smoothstep(0.0, uMossRadius, d);
      float soft = 1.0 - smoothstep(uMossRadius * 0.35, uMossRadius, d);
      float spot = mix(soft * 0.45, core, 0.55) * visualStrength;
      mossMask += spot * 0.62;
    }
  }

  mossMask = clamp(mossMask, 0.0, 1.0);

  if (mossMask < 0.003) discard;

  // — core / edge split —
  float edgeMask = smoothstep(0.02, 0.18, mossMask);
  float coreMask = smoothstep(0.12, 0.48, mossMask);

  // — 3-layer edge breakup —
  float clumpNoise = noise2d(vLocalPos.xy * 5.0 + vLocalPos.z * 1.7 + uTime * 0.012);
  float edgeNoise  = noise2d(vLocalPos.yz * 14.0 + vLocalPos.x * 3.0 - uTime * 0.02);
  float fiberNoise = noise2d(vLocalPos.xz * 38.0 + vLocalPos.y * 5.0 + uTime * 0.028);

  float broken = mossMask;
  broken *= smoothstep(0.10, 0.64, clumpNoise + mossMask * 0.88);
  broken *= mix(0.72, 1.0, smoothstep(0.18, 0.82, edgeNoise + mossMask * 0.42));
  broken *= mix(0.78, 1.10, fiberNoise);
  broken = clamp(broken, 0.0, 1.0);

  if (broken < 0.004) discard;

  // — bark holes (internal gaps) —
  float gapNoise = noise2d(vLocalPos.xy * 18.0 + vLocalPos.z * 4.0);
  float gap = smoothstep(0.20, 0.82, gapNoise + coreMask * 0.30);
  broken *= mix(0.76, 1.0, gap);

  // — mild up-factor, don't kill side visibility —
  float upFactor = smoothstep(-0.35, 0.72, dot(normalize(vWorldNormal), vec3(0.0, 1.0, 0.0)));
  broken *= mix(0.92, 1.05, upFactor);

  if (broken < 0.004) discard;

  // — triplanar texture sampling —
  vec3 nBlend = abs(vWorldNormal);
  nBlend = pow(nBlend, vec3(4.0));
  float nSum = max(nBlend.x + nBlend.y + nBlend.z, 0.0001);
  nBlend /= nSum;

  float ts = uMossTexScale;
  vec2 uvX = vLocalPos.yz * ts;
  vec2 uvY = vLocalPos.xz * ts;
  vec2 uvZ = vLocalPos.xy * ts;

  vec3 texX = texture2D(uMossTex, uvX).rgb;
  vec3 texY = texture2D(uMossTex, uvY).rgb;
  vec3 texZ = texture2D(uMossTex, uvZ).rgb;

  vec3 texColor = texX * nBlend.x + texY * nBlend.y + texZ * nBlend.z;

  float texLum   = dot(texColor, vec3(0.299, 0.587, 0.114));
  float texDetail = smoothstep(0.12, 0.78, texLum);
  float texDark   = 1.0 - texDetail;
  float texContrast = abs(texLum - 0.5) * 2.0;

  // Texture modulates the broken mask density
  broken *= mix(0.70, 1.22, texDetail);

  // — color hierarchy — (darkened for realistic moss carpet look)
  vec3 rootDark   = vec3(0.004, 0.022, 0.004);
  vec3 deepGreen  = vec3(0.012, 0.065, 0.014);
  vec3 coreGreen  = vec3(0.028, 0.145, 0.024);
  vec3 mossGreen  = vec3(0.060, 0.240, 0.044);
  vec3 oliveTip   = vec3(0.180, 0.280, 0.065);
  vec3 yellowTip  = vec3(0.300, 0.380, 0.080);

  vec3 mossCol = mix(rootDark, deepGreen, edgeMask);
  mossCol = mix(mossCol, coreGreen, coreMask * 0.95);
  mossCol = mix(mossCol, mossGreen, texDetail * coreMask * 0.35);
  mossCol = mix(mossCol, oliveTip, pow(texDetail, 2.0) * fiberNoise * coreMask * 0.18);
  mossCol = mix(mossCol, yellowTip, pow(texDetail, 4.0) * fiberNoise * coreMask * 0.05);

  // Grain via texture dark areas
  mossCol = mix(mossCol, mossCol * 0.68, texDark * 0.32);
  mossCol = mix(mossCol, oliveTip * 0.78, fiberNoise * texDetail * 0.10);
  mossCol *= 1.0 + (texDetail - 0.5) * 0.18;

  // — Layer B: contact shadow / root darkening —
  // Deepens the transition zone where moss meets bare bark,
  // anchoring moss to the surface so it looks grown, not stuck on.
  float rootZone = smoothstep(0.04, 0.24, mossMask) * (1.0 - smoothstep(0.34, 0.70, mossMask));
  vec3  rootShadow = mix(mossCol, rootDark * 2.5, 0.82);
  mossCol = mix(mossCol, rootShadow, rootZone * 0.72);

  // — alpha (Layer A: soft base, more continuous to bridge cards) —
  float alphaEdge    = edgeMask * 0.035;
  float alphaCore    = coreMask * 0.52;
  float alphaTexMod  = mix(0.76, 1.16, texDetail);
  float textureDensity = mix(0.68, 1.30, texDetail);
  textureDensity *= mix(0.80, 1.16, texContrast);
  float alpha        = (alphaEdge + alphaCore) * broken * alphaTexMod * textureDensity;
  alpha = clamp(alpha, 0.0, 0.58);

  // — debug overrides —
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

  gl_FragColor = vec4(mossCol, alpha);
}
`

export function createMossUniforms() {
  return {
    uMossPoints: { value: new Float32Array(MAX_MOSS_POINTS * 4) },
    uMossCount: { value: 0 },
    uMossRadius: { value: 0.18 },
    uMossTex: { value: null },
    uMossTexScale: { value: 10.0 },
    uTime: { value: 0 },
    uDebugMode: { value: 0 },
  }
}

export function createMossMaterial() {
  return new THREE.ShaderMaterial({
    vertexShader: mossVert,
    fragmentShader: mossFrag,
    uniforms: createMossUniforms(),
    transparent: true,
    depthTest: true,
    depthWrite: false,
    side: THREE.FrontSide,
  })
}
