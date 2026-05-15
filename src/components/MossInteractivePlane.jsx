import { useMemo, useEffect } from 'react'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { ASSET_URLS } from '../assetPaths'

const MossMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uBranchMask: { value: null },
    uCoverageMap: { value: null },
    uMossTexture: { value: null },
    uDebugMode: { value: 0 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D uBranchMask;
    uniform sampler2D uCoverageMap;
    uniform sampler2D uMossTexture;
    uniform int uDebugMode;
    uniform float uTime;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
        f.y
      );
    }

    float fbm(vec2 p) {
      float v = 0.0;
      float a = 0.5;
      vec2 shift = vec2(100.0);
      for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p = p * 2.0 + shift;
        a *= 0.5;
      }
      return v;
    }

    void main() {
      float branchMask = texture2D(uBranchMask, vUv).r;

      if (uDebugMode == 1) {
        float c = texture2D(uCoverageMap, vUv).r;
        gl_FragColor = vec4(vec3(c), 1.0);
        return;
      }
      if (uDebugMode == 2) {
        float c = texture2D(uCoverageMap, vUv).r;
        gl_FragColor = vec4(c, branchMask, 0.0, 1.0);
        return;
      }

      if (branchMask < 0.5) discard;

      float coverage = texture2D(uCoverageMap, vUv).r;
      coverage = clamp(coverage, 0.0, 1.0);
      if (coverage < 0.012) discard;

      // Coverage is written in small local strokes. Keep this threshold low
      // enough that a single pass is visible, while alpha/noise below prevent
      // the old full-branch green paint look.
      float mossDensity = smoothstep(0.07, 0.38, coverage);

      float edgeNoise   = fbm(vUv * 18.0 + uTime * 0.02);
      float clumpNoise  = fbm(vUv * 42.0 + vec2(8.0, 2.0));
      float fiberNoise  = fbm(vUv * 120.0 + vec2(3.0, 7.0));
      float microNoise  = fbm(vUv * 220.0 + vec2(6.0, 10.0));

      float broken = mossDensity;
      broken *= smoothstep(0.24, 0.82, edgeNoise + mossDensity * 0.42);
      broken *= mix(0.35, 1.0, smoothstep(0.42, 0.92, clumpNoise));
      broken *= mix(0.45, 1.0, smoothstep(0.48, 0.96, fiberNoise));

      float mossMask = clamp(broken * branchMask, 0.0, 1.0);
      if (mossMask < 0.012) discard;

      float colorNoise = fbm(vUv * 32.0) * 0.5 + 0.5;
      float highlightNoise = fbm(vUv * 90.0 + 5.0) * 0.5 + 0.5;

      vec3 rootDark    = vec3(0.020, 0.055, 0.018);
      vec3 deepGreen   = vec3(0.040, 0.120, 0.030);
      vec3 midGreen    = vec3(0.090, 0.240, 0.055);
      vec3 oliveGreen  = vec3(0.210, 0.330, 0.080);
      vec3 yellowGreen = vec3(0.430, 0.560, 0.130);

      vec3 mossColor = mix(rootDark, deepGreen, colorNoise);
      mossColor = mix(mossColor, midGreen, mossDensity * 0.45 + colorNoise * 0.18);
      mossColor = mix(mossColor, oliveGreen, highlightNoise * 0.45);
      mossColor = mix(mossColor, yellowGreen, highlightNoise * colorNoise * 0.18);

      vec2 mossUv = vUv * 22.0;
      vec3 texColor = texture2D(uMossTexture, mossUv).rgb;
      float texLum = dot(texColor, vec3(0.299, 0.587, 0.114));
      float texDetail = smoothstep(0.18, 0.82, texLum);
      vec3 texMossTint = mix(deepGreen, oliveGreen, texDetail);
      texMossTint = mix(texMossTint, yellowGreen, texDetail * highlightNoise * 0.22);
      mossColor = mix(mossColor, texMossTint, 0.18 * mossDensity);
      mossColor *= mix(0.78, 1.10, microNoise);

      float alpha = mossMask;
      alpha *= mix(0.48, 0.92, smoothstep(0.35, 0.95, microNoise));
      alpha *= 0.76;
      alpha = clamp(alpha, 0.0, 0.82);

      gl_FragColor = vec4(mossColor, alpha);
    }
  `,
  transparent: true,
  depthWrite: false,
})

export default function MossInteractivePlane({ width, height, materialRef, coverageTexture, onPointerMove, onPointerLeave }) {
  const textures = useTexture([ASSET_URLS.branchHitMask, ASSET_URLS.mossTexture])

  useEffect(() => {
    const mossTex = textures[1]
    if (!mossTex) return
    mossTex.wrapS = THREE.RepeatWrapping
    mossTex.wrapT = THREE.RepeatWrapping
    mossTex.minFilter = THREE.LinearFilter
    mossTex.magFilter = THREE.LinearFilter
    mossTex.needsUpdate = true
  }, [textures])

  const material = useMemo(() => {
    const mat = MossMaterial.clone()
    mat.uniforms.uBranchMask.value = textures[0]
    mat.uniforms.uMossTexture.value = textures[1]
    mat.uniforms.uCoverageMap.value = coverageTexture
    return mat
  }, [textures, coverageTexture])

  useEffect(() => {
    if (materialRef) materialRef.current = material
    return () => {
      if (materialRef) materialRef.current = null
    }
  }, [material, materialRef])

  useEffect(() => {
    if (material && coverageTexture) {
      material.uniforms.uCoverageMap.value = coverageTexture
      material.needsUpdate = true
    }
  }, [material, coverageTexture])

  const geometry = useMemo(() => new THREE.PlaneGeometry(width, height), [width, height])

  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={1}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerMove}
      onPointerOut={onPointerLeave}
    />
  )
}
