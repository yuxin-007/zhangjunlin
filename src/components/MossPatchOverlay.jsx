import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

// Patch is now the visible moss clump layer.
// The shader stays as a subtle base; this layer gives the "fluffy moss" silhouette.
const PATCHES_PER_POINT = 6
const BASE_SIZE = 0.18
const MIN_SIZE_FACTOR = 0.70
const MAX_SIZE_FACTOR = 1.35
const MAX_OPACITY = 0.90
const NORMAL_OFFSET = 0.028
const CAMERA_OFFSET = 0.006
const JITTER_RADIUS = 0.060
const ALPHA_TEST = 0.08

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function disposeSpriteBatch(group, patches) {
  for (const { sprite } of patches) {
    if (sprite.material) sprite.material.dispose()
    group?.remove(sprite)
  }
}

function analyzeAlpha(texture) {
  const img = texture?.image
  if (!img || !img.width || !img.height) return null

  const canvas = document.createElement('canvas')
  canvas.width = img.width
  canvas.height = img.height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  ctx.drawImage(img, 0, 0)
  const data = ctx.getImageData(0, 0, img.width, img.height).data

  let total = 0
  let transparent = 0
  let opaque = 0
  let semi = 0

  for (let i = 3; i < data.length; i += 4) {
    total++
    if (data[i] < 10) transparent++
    else if (data[i] > 240) opaque++
    else semi++
  }

  const transparentRatio = total > 0 ? transparent / total : 0
  const opaqueRatio = total > 0 ? opaque / total : 0
  const semiTransparentRatio = total > 0 ? semi / total : 0

  return {
    transparentRatio,
    opaqueRatio,
    semiTransparentRatio,
    // The cleaned texture should have plenty of transparent pixels.
    hasRealAlpha: transparentRatio > 0.05,
    width: img.width,
    height: img.height,
    aspect: img.width / Math.max(1, img.height),
    totalPixels: total,
    transparentPixels: transparent,
    opaquePixels: opaque,
    semiTransparentPixels: semi,
  }
}

export default function MossPatchOverlay({
  mossPointsMap,
  patchTexture,
  enabled = true,
  onAlphaAnalysis,
}) {
  const groupRef = useRef(null)
  const spriteMapRef = useRef(new Map())
  const [alphaResult, setAlphaResult] = useState(null)
  const [alphaChecked, setAlphaChecked] = useState(false)
  const { camera } = useThree()

  useEffect(() => {
    if (!patchTexture || !patchTexture.image) return

    const result = analyzeAlpha(patchTexture)
    if (!result) return

    console.log('[MossPatchOverlay] alpha analysis:', result)
    setAlphaResult(result)
    setAlphaChecked(true)
    if (onAlphaAnalysis) onAlphaAnalysis(result)
  }, [patchTexture, onAlphaAnalysis])

  useEffect(() => {
    return () => {
      const group = groupRef.current
      for (const patches of spriteMapRef.current.values()) {
        disposeSpriteBatch(group, patches)
      }
      spriteMapRef.current.clear()
    }
  }, [])

  useFrame(() => {
    const group = groupRef.current
    if (!group || !patchTexture) return

    // Mounting this component is also used to analyze alpha. Rendering can stay disabled
    // until the alpha check has passed.
    if (!enabled || !alphaChecked || (alphaResult && !alphaResult.hasRealAlpha)) {
      for (const patches of spriteMapRef.current.values()) {
        disposeSpriteBatch(group, patches)
      }
      spriteMapRef.current.clear()
      return
    }

    const spriteMap = spriteMapRef.current
    const longPoints = mossPointsMap.current.long
    const shortPoints = mossPointsMap.current.short
    const allPoints = [...longPoints, ...shortPoints]
    const activeIds = new Set()
    const aspect = alphaResult?.aspect || patchTexture.image?.width / Math.max(1, patchTexture.image?.height || 1) || 1

    const tmpPos = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const toCamera = new THREE.Vector3()
    const tangentA = new THREE.Vector3()
    const tangentB = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    const right = new THREE.Vector3(1, 0, 0)

    for (let i = 0; i < allPoints.length; i++) {
      const pt = allPoints[i]
      if (!pt.worldPos || pt.strength <= 0.01) continue

      const id = pt.createdAt
      activeIds.add(id)

      if (!spriteMap.has(id)) {
        const seed = pt.seed ?? Math.random()
        const rng = mulberry32(Math.floor(seed * 4294967296))

        const patches = []
        for (let j = 0; j < PATCHES_PER_POINT; j++) {
          const mat = new THREE.SpriteMaterial({
            map: patchTexture,
            transparent: true,
            alphaTest: ALPHA_TEST,
            depthWrite: false,
            depthTest: true,
            opacity: 0,
            color: 0xffffff,
            toneMapped: false,
          })
          const sprite = new THREE.Sprite(mat)
          sprite.renderOrder = 4

          patches.push({
            sprite,
            offsetU: (rng() - 0.5) * JITTER_RADIUS * 2,
            offsetV: (rng() - 0.5) * JITTER_RADIUS * 2,
            sizeScale: MIN_SIZE_FACTOR + rng() * (MAX_SIZE_FACTOR - MIN_SIZE_FACTOR),
            rotation: rng() * Math.PI * 2,
            opacityScale: 0.75 + rng() * 0.25,
          })
          group.add(sprite)
        }
        spriteMap.set(id, patches)
      }

      const patches = spriteMap.get(id)

      tmpPos.set(pt.worldPos[0], pt.worldPos[1], pt.worldPos[2])
      normal.set(
        pt.worldNormal?.[0] ?? 0,
        pt.worldNormal?.[1] ?? 0,
        pt.worldNormal?.[2] ?? 1,
      )
      if (normal.lengthSq() < 0.0001) normal.set(0, 0, 1)
      normal.normalize()

      toCamera.copy(camera.position).sub(tmpPos)
      if (toCamera.lengthSq() < 0.0001) toCamera.set(0, 0, 1)
      toCamera.normalize()

      // Some imported meshes have inconsistent face normal direction. Flip toward camera
      // so patches are lifted out of the bark rather than buried inside it.
      if (normal.dot(toCamera) < 0) normal.multiplyScalar(-1)

      tangentA.crossVectors(normal, up)
      if (tangentA.lengthSq() < 0.0001) tangentA.crossVectors(normal, right)
      tangentA.normalize()
      tangentB.crossVectors(normal, tangentA).normalize()

      const strength = Math.max(0, Math.min(1, pt.strength))
      const opacity = Math.min(MAX_OPACITY, Math.pow(strength, 0.72) * MAX_OPACITY)

      for (const { sprite, offsetU, offsetV, sizeScale, rotation, opacityScale } of patches) {
        sprite.position.copy(tmpPos)
        sprite.position.addScaledVector(normal, NORMAL_OFFSET)
        sprite.position.addScaledVector(toCamera, CAMERA_OFFSET)
        sprite.position.addScaledVector(tangentA, offsetU)
        sprite.position.addScaledVector(tangentB, offsetV)

        const s = BASE_SIZE * sizeScale * (0.72 + 0.28 * strength)
        sprite.scale.set(s * aspect, s, 1)
        sprite.material.opacity = opacity * opacityScale
        sprite.material.rotation = rotation
      }
    }

    for (const [id, patches] of spriteMap) {
      if (!activeIds.has(id)) {
        disposeSpriteBatch(group, patches)
        spriteMap.delete(id)
      }
    }
  })

  return <group ref={groupRef} />
}

export const MOSS_PATCH_SETTINGS = {
  PATCHES_PER_POINT,
  BASE_SIZE,
  MAX_OPACITY,
  NORMAL_OFFSET,
  CAMERA_OFFSET,
  JITTER_RADIUS,
  ALPHA_TEST,
}
