precision highp float;

#define MAX_MOSS_POINTS 10

uniform float uTime;
uniform vec3 uMousePoint;
uniform float uHoverStrength;
uniform vec3 uMossPoints[MAX_MOSS_POINTS];
uniform float uMossStrengths[MAX_MOSS_POINTS];

varying vec3 vWorldPosition;
varying vec3 vLocalPosition;
varying vec3 vWorldNormal;
varying vec2 vUv;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.13, 0.17, 0.19));
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

float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}

float ridge(float v) {
  return 1.0 - abs(2.0 * v - 1.0);
}

vec3 barkColor() {
  vec3 p = vLocalPosition;

  float broad = fbm(vWorldPosition * vec3(0.32, 2.2, 2.3));
  float flakes = fbm(p * vec3(1.6, 17.0, 17.0) + broad * 2.8);
  float fine = fbm(p * vec3(4.5, 44.0, 44.0));
  float crackField = fbm(vec3(p.x * 0.85, p.y * 15.0 + broad * 3.5, p.z * 15.0));
  float crack = smoothstep(0.52, 0.92, ridge(crackField + fine * 0.44));
  crack *= smoothstep(0.18, 0.82, flakes);
  crack *= crack;

  vec3 barkBase   = vec3(0.48, 0.50, 0.48);
  vec3 barkLight  = vec3(0.68, 0.72, 0.66);
  vec3 barkShadow = vec3(0.24, 0.29, 0.30);
  vec3 barkBrown  = vec3(0.16, 0.12, 0.09);
  vec3 crackColor = vec3(0.05, 0.04, 0.03);

  vec3 col = mix(barkBase, barkLight, smoothstep(0.22, 0.92, flakes));
  col = mix(col, barkShadow, smoothstep(0.38, 0.85, broad) * 0.45);
  col = mix(col, barkBrown, smoothstep(0.48, 0.84, fine) * 0.28);
  col = mix(col, crackColor, crack * 0.85);

  return col;
}

float mossInfluence() {
  vec3 p = vWorldPosition;

  float centerPatch = 1.0 - smoothstep(0.50, 3.2, distance(p, vec3(0.05, -0.18, 0.08)));
  float secondPatch = 1.0 - smoothstep(0.15, 1.2, distance(p, vec3(-0.65, -0.38, 0.05)));
  float base = max(centerPatch * 0.90, secondPatch * 0.35);

  float hover = 0.0;
  float live = 1.0 - smoothstep(0.12, 1.45, distance(p, uMousePoint));
  hover = max(hover, live * uHoverStrength);

  for (int i = 0; i < MAX_MOSS_POINTS; i++) {
    float d = distance(p, uMossPoints[i]);
    float trail = 1.0 - smoothstep(0.18, 1.1, d);
    hover = max(hover, trail * uMossStrengths[i] * 0.82);
  }

  return max(base, hover);
}

void main() {
  vec3 normal = normalize(vWorldNormal);
  vec3 lightDir = normalize(vec3(-0.35, 0.8, 0.6));
  float lambert = dot(normal, lightDir) * 0.5 + 0.5;
  float topness = smoothstep(-0.35, 0.72, normal.y);

  vec3 bark = barkColor();

  float organic = fbm(vWorldPosition * vec3(2.8, 6.5, 5.2) + vec3(0.0, uTime * 0.025, 0.0));
  float micro  = fbm(vWorldPosition * vec3(8.0, 16.0, 12.0));
  float spread = mossInfluence();

  float brokenEdge = smoothstep(0.16, 0.84, organic + micro * 0.40);
  float crackCatch = smoothstep(0.44, 0.88, fbm(vLocalPosition * vec3(1.1, 15.0, 15.0)));
  float mossMask = spread * mix(brokenEdge, max(brokenEdge, crackCatch), 0.50) * topness;
  mossMask = smoothstep(0.15, 0.88, mossMask);

  vec3 mossDark  = vec3(0.022, 0.090, 0.016);
  vec3 mossMid   = vec3(0.10, 0.25, 0.040);
  vec3 mossWarm  = vec3(0.28, 0.44, 0.060);
  vec3 mossLight = vec3(0.38, 0.52, 0.080);

  vec3 moss = mix(mossDark, mossMid, smoothstep(0.15, 0.78, organic));
  moss = mix(moss, mossWarm, smoothstep(0.45, 0.85, micro) * 0.45);
  moss = mix(moss, mossLight, smoothstep(0.70, 0.96, micro) * 0.48);

  vec3 color = mix(bark, moss, mossMask);

  float shade = mix(0.62, 1.12, lambert);
  color *= shade;

  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  vec3 halfVec = normalize(lightDir + viewDir);
  float spec = pow(max(dot(normal, halfVec), 0.0), 48.0);
  float flakesForSpec = fbm(vLocalPosition * vec3(1.6, 17.0, 17.0));
  float specArea = smoothstep(0.40, 0.88, flakesForSpec);
  color += vec3(0.10, 0.12, 0.08) * spec * specArea * 0.25;

  color += mossMask * vec3(0.035, 0.055, 0.0) * smoothstep(0.55, 1.0, lambert);

  color = pow(color, vec3(0.94));

  gl_FragColor = vec4(color, 1.0);
}
