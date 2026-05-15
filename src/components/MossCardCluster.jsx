import { useEffect, useRef, useState } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'

// ── cluster card constants ───────────────────────────────────
const CARDS_PER_CLUSTER = 3
const BASE_SIZE = 0.085
const MAX_OPACITY = 0.55
const NORMAL_BASE_OFFSET = 0.006
const ALPHA_TEST = 0.08
const CARD_POINT_DISPLAY_RATE = 0.30

// Tier distribution: inner (close + tall), mid, outer (far + flat)
// 3 cards: index 0=inner, 1=mid, 2=outer
const INNER_COUNT = 1
const MID_COUNT = 1
const OUTER_COUNT = 1

// Inner tier: core of the cluster — slightly taller, central
const INNER_DIST_MAX = 0.012
const INNER_HEIGHT_MIN = 0.004
const INNER_HEIGHT_MAX = 0.010
const INNER_SIZE_MIN = 0.85
const INNER_SIZE_MAX = 1.15

// Mid tier: bulk of the cluster — moderate height, spread out
const MID_DIST_MIN = 0.008
const MID_DIST_MAX = 0.024
const MID_HEIGHT_MIN = 0.002
const MID_HEIGHT_MAX = 0.006
const MID_SIZE_MIN = 0.55
const MID_SIZE_MAX = 0.80

// Outer tier: edge breakup — smallest, closest to surface
const OUTER_DIST_MIN = 0.018
const OUTER_DIST_MAX = 0.034
const OUTER_HEIGHT_MIN = 0.001
const OUTER_HEIGHT_MAX = 0.004
const OUTER_SIZE_MIN = 0.35
const OUTER_SIZE_MAX = 0.55

// ── helpers ──────────────────────────────────────────────────

function mulberry32(a) {
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function disposeCardBatch(group, cards) {
  for (const { sprite } of cards) {
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

  let total = 0, transparent = 0, opaque = 0, semi = 0
  for (let i = 3; i < data.length; i += 4) {
    total++
    if (data[i] < 10) transparent++
    else if (data[i] > 240) opaque++
    else semi++
  }

  return {
    transparentRatio: total > 0 ? transparent / total : 0,
    opaqueRatio: total > 0 ? opaque / total : 0,
    semiTransparentRatio: total > 0 ? semi / total : 0,
    hasRealAlpha: total > 0 ? transparent / total > 0.05 : false,
    width: img.width,
    height: img.height,
    aspect: img.width / Math.max(1, img.height),
    totalPixels: total,
    transparentPixels: transparent,
    opaquePixels: opaque,
    semiTransparentPixels: semi,
  }
}

function createCard(tier, rng, patchTexture) {
  let dist, height, sizeScale
  if (tier < INNER_COUNT) {
    dist = rng() * INNER_DIST_MAX
    height = INNER_HEIGHT_MIN + rng() * (INNER_HEIGHT_MAX - INNER_HEIGHT_MIN)
    sizeScale = INNER_SIZE_MIN + rng() * (INNER_SIZE_MAX - INNER_SIZE_MIN)
  } else if (tier < INNER_COUNT + MID_COUNT) {
    dist = MID_DIST_MIN + rng() * (MID_DIST_MAX - MID_DIST_MIN)
    height = MID_HEIGHT_MIN + rng() * (MID_HEIGHT_MAX - MID_HEIGHT_MIN)
    sizeScale = MID_SIZE_MIN + rng() * (MID_SIZE_MAX - MID_SIZE_MIN)
  } else {
    dist = OUTER_DIST_MIN + rng() * (OUTER_DIST_MAX - OUTER_DIST_MIN)
    height = OUTER_HEIGHT_MIN + rng() * (OUTER_HEIGHT_MAX - OUTER_HEIGHT_MIN)
    sizeScale = OUTER_SIZE_MIN + rng() * (OUTER_SIZE_MAX - OUTER_SIZE_MIN)
  }

  const angle = rng() * Math.PI * 2
  const u = Math.cos(angle) * dist
  const v = Math.sin(angle) * dist

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

  return {
    sprite,
    offsetU: u,
    offsetV: v,
    height,
    sizeScale,
    rotation: rng() * Math.PI * 2,
    opacityScale: 0.75 + rng() * 0.25,
    tier,
  }
}

// ── component ────────────────────────────────────────────────

export default function MossCardCluster({
  mossPointsMap,
  patchTexture,
  enabled = true,
  onAlphaAnalysis,
}) {
  const groupRef = useRef(null)
  const clusterMapRef = useRef(new Map())
  const [alphaResult, setAlphaResult] = useState(null)
  const [alphaChecked, setAlphaChecked] = useState(false)
  const { camera } = useThree()

  useEffect(() => {
    if (!patchTexture || !patchTexture.image) return
    const result = analyzeAlpha(patchTexture)
    if (!result) return
    console.log('[MossCardCluster] alpha analysis:', result)
    setAlphaResult(result)
    setAlphaChecked(true)
    if (onAlphaAnalysis) onAlphaAnalysis(result)
  }, [patchTexture, onAlphaAnalysis])

  useEffect(() => {
    return () => {
      const group = groupRef.current
      for (const cards of clusterMapRef.current.values()) {
        disposeCardBatch(group, cards)
      }
      clusterMapRef.current.clear()
    }
  }, [])

  useFrame(() => {
    const group = groupRef.current
    if (!group || !patchTexture) return

    if (!enabled || !alphaChecked || (alphaResult && !alphaResult.hasRealAlpha)) {
      for (const cards of clusterMapRef.current.values()) {
        disposeCardBatch(group, cards)
      }
      clusterMapRef.current.clear()
      return
    }

    const clusterMap = clusterMapRef.current
    const longPoints = mossPointsMap.current.long
    const shortPoints = mossPointsMap.current.short
    const allPoints = [...longPoints, ...shortPoints]
    const activeIds = new Set()

    const tmpPos = new THREE.Vector3()
    const normal = new THREE.Vector3()
    const toCamera = new THREE.Vector3()
    const tangentA = new THREE.Vector3()
    const tangentB = new THREE.Vector3()
    const up = new THREE.Vector3(0, 1, 0)
    const right = new THREE.Vector3(1, 0, 0)

    const aspect = alphaResult?.aspect || 1

    for (let i = 0; i < allPoints.length; i++) {
      const pt = allPoints[i]
      if (!pt.worldPos || pt.strength <= 0.01) continue

      // Cards are now a secondary fiber detail layer. Render only a stable
      // subset of points so the continuous shader carpet is not buried under
      // hundreds of separated leaf-like sprites.
      const displaySeed = pt.seed ?? 0
      if (displaySeed > CARD_POINT_DISPLAY_RATE) continue

      const id = pt.createdAt
      activeIds.add(id)

      if (!clusterMap.has(id)) {
        const seed = pt.seed ?? Math.random()
        const rng = mulberry32(Math.floor(seed * 4294967296))

        const cards = []
        for (let j = 0; j < CARDS_PER_CLUSTER; j++) {
          cards.push(createCard(j, rng, patchTexture))
          group.add(cards[j].sprite)
        }
        clusterMap.set(id, cards)
      }

      const cards = clusterMap.get(id)

      // Build surface reference frame
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

      // Flip normal toward camera so cards lift out of bark, not bury inside
      if (normal.dot(toCamera) < 0) normal.multiplyScalar(-1)

      tangentA.crossVectors(normal, up)
      if (tangentA.lengthSq() < 0.0001) tangentA.crossVectors(normal, right)
      tangentA.normalize()
      tangentB.crossVectors(normal, tangentA).normalize()

      const strength = Math.max(0, Math.min(1, pt.strength))
      const opacity = Math.min(MAX_OPACITY, Math.pow(strength, 0.72) * MAX_OPACITY)

      for (const card of cards) {
        card.sprite.position.copy(tmpPos)
        // Lift off surface: base offset + tier height * strength
        const h = NORMAL_BASE_OFFSET + card.height * strength
        card.sprite.position.addScaledVector(normal, h)
        card.sprite.position.addScaledVector(tangentA, card.offsetU)
        card.sprite.position.addScaledVector(tangentB, card.offsetV)

        const s = BASE_SIZE * card.sizeScale * (0.72 + 0.28 * strength)
        card.sprite.scale.set(s * aspect, s, 1)
        card.sprite.material.opacity = opacity * card.opacityScale
        card.sprite.material.rotation = card.rotation
      }
    }

    for (const [id, cards] of clusterMap) {
      if (!activeIds.has(id)) {
        disposeCardBatch(group, cards)
        clusterMap.delete(id)
      }
    }
  })

  return <group ref={groupRef} />
}

export const MOSS_CLUSTER_SETTINGS = {
  CARDS_PER_CLUSTER,
  BASE_SIZE,
  MAX_OPACITY,
  NORMAL_BASE_OFFSET,
  ALPHA_TEST,
  CARD_POINT_DISPLAY_RATE,
  INNER_COUNT,
  MID_COUNT,
  OUTER_COUNT,
}
