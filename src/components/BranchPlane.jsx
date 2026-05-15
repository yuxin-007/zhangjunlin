import { useMemo } from 'react'
import { useTexture } from '@react-three/drei'
import * as THREE from 'three'
import { ASSET_URLS } from '../assetPaths'

const BranchPlaneMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uBranchTexture: { value: null },
    uVisualMask: { value: null },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D uBranchTexture;
    uniform sampler2D uVisualMask;
    varying vec2 vUv;
    void main() {
      float visualMask = texture2D(uVisualMask, vUv).r;
      if (visualMask < 0.5) discard;
      vec4 color = texture2D(uBranchTexture, vUv);
      gl_FragColor = color;
    }
  `,
  transparent: false,
  depthWrite: false,
})

export default function BranchPlane({ width, height, visualMaskUrl }) {
  const textures = useTexture([ASSET_URLS.branchMain, visualMaskUrl])

  const material = useMemo(() => {
    const mat = BranchPlaneMaterial.clone()
    mat.uniforms.uBranchTexture.value = textures[0]
    mat.uniforms.uVisualMask.value = textures[1]
    return mat
  }, [textures])

  const geometry = useMemo(() => new THREE.PlaneGeometry(width, height), [width, height])

  return (
    <mesh geometry={geometry} material={material} renderOrder={0} />
  )
}
