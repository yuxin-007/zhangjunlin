import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { createMossMaterial, MAX_MOSS_POINTS } from '../shaders/mossOverlayShader'
import { ASSET_URLS } from '../assetPaths'

// ── cylindrical band constants ──────────────────────────────
const BAND_LENGTH = 0.42
const BAND_LENGTH_SAMPLES = 7
const BAND_ARC_DEG = 150
const BAND_ARC_SAMPLES = 5
const BAND_RADIUS_SCALE = 1.005
const BAND_STEP = 0.10
const ACTIVE_KEEP_RADIUS = 0.11
const MERGE_RADIUS = 0.045
const DECAY_RATE = 1.0
const ACTIVE_DECAY = 0.02
const DELETE_THRESHOLD = 0.06
const REINFORCE_RATE = 2.0
const INITIAL_STRENGTH = 0.50
const MOSS_TEX_SCALE = 10.0

const DEG2RAD = Math.PI / 180

// ── deterministic hash: same (pos, idx) → same output every frame ─
function hashSampleSeed(lx, ly, lz, sampleIndex) {
  const a = Math.imul((Math.floor(lx * 1000) ^ (Math.floor(ly * 1000) << 4)) >>> 0, 2654435761)
  const b = Math.imul((a ^ (Math.floor(lz * 1000) << 8)) >>> 0, 2246822519)
  const h = Math.imul((b ^ (sampleIndex * 3266489917)) >>> 0, 668265263)
  return ((h >>> 0) & 0x7fffffff) / 0x7fffffff
}

// ── generate cylindrical band samples ───────────────────────
// Wraps moss around the branch circumference (arc) along the branch axis (length).
// Uses branchAxisWorld + active worldPos to compute ring center and radius.
function generateCylindricalBandSamples(activeWorldPos, worldNormal, branchAxisWorld, branchCenterWorld, cameraPos) {
  const samples = []
  if (!activeWorldPos || !branchAxisWorld || !branchCenterWorld) return samples

  const wp = new THREE.Vector3(activeWorldPos.x, activeWorldPos.y, activeWorldPos.z)
  const axis = new THREE.Vector3(branchAxisWorld.x, branchAxisWorld.y, branchAxisWorld.z).normalize()
  if (axis.lengthSq() < 0.0001) return samples

  const bc = new THREE.Vector3(branchCenterWorld.x, branchCenterWorld.y, branchCenterWorld.z)

  // Project active point onto branch axis → ring center at this axial position
  const toActive = wp.clone().sub(bc)
  const projLen = toActive.dot(axis)
  const projectedCenter = bc.clone().addScaledVector(axis, projLen)

  // Radius from axis center to surface
  const toSurface = wp.clone().sub(projectedCenter)
  const radius = toSurface.length()
  if (radius < 0.005) return samples // degenerate

  // Radial direction (from axis center out toward active point)
  const radialDir = toSurface.normalize()

  // Compute view direction in the cross-section plane for arc centering.
  // This ensures the moss band is always on the visible side of the branch.
  const camPos = new THREE.Vector3(cameraPos.x, cameraPos.y, cameraPos.z)
  const camOnPlane = camPos.clone().sub(projectedCenter)
  const camProj = camOnPlane.dot(axis)
  camOnPlane.addScaledVector(axis, -camProj)
  const viewDir = camOnPlane.lengthSq() > 0.0001 ? camOnPlane.normalize() : radialDir.clone()

  for (let li = 0; li < BAND_LENGTH_SAMPLES; li++) {
    const tLen = li / (BAND_LENGTH_SAMPLES - 1 || 1) - 0.5
    const axisCenter = projectedCenter.clone().addScaledVector(axis, tLen * BAND_LENGTH)

    for (let ai = 0; ai < BAND_ARC_SAMPLES; ai++) {
      const tArc = ai / (BAND_ARC_SAMPLES - 1 || 1) - 0.5
      const angle = tArc * BAND_ARC_DEG * DEG2RAD

      // Rotate viewDir around axis by angle (arc centered on visible direction)
      const rotatedDir = viewDir.clone().applyAxisAngle(axis, angle)

      const sampleWorldPos = axisCenter.clone()
        .addScaledVector(rotatedDir, radius * BAND_RADIUS_SCALE)

      // Deterministic jitter per sample index
      const seed = hashSampleSeed(wp.x, wp.y, wp.z, li * 100 + ai)

      // Jitter mostly tangential (along axis and rotated dir plane), minimal radial push
      const jitterAxis = (seed - 0.5) * 0.02
      const jitterTangent = (hashSampleSeed(wp.x + 1, wp.y, wp.z, li * 100 + ai + 500) - 0.5) * 0.01
      const jitteredWorldPos = sampleWorldPos.clone()
        .addScaledVector(axis, jitterAxis)
        .addScaledVector(rotatedDir, jitterTangent)

      // Visibility culling: tighter — skip back/side-facing samples
      const toCam = camPos.clone().sub(jitteredWorldPos).normalize()
      const visibility = rotatedDir.dot(toCam)
      if (visibility < -0.05) continue
      // Smooth visibility bonus: barely-visible samples get lower strength
      const visBonus = Math.max(0.45, Math.min(1.0, (visibility + 0.05) / 0.50))

      // Strength falloff: center of band is strongest, edges weaker
      const lenFalloff = 1.0 - Math.abs(tLen) * 0.45
      const arcFalloff = 1.0 - Math.abs(tArc) * 0.40
      const strengthMul = Math.max(0.25, lenFalloff * arcFalloff * visBonus)

      samples.push({
        worldPos: jitteredWorldPos,
        worldNormal: rotatedDir.clone(),
        strengthMul,
        seed,
      })
    }
  }

  return samples
}

export default function MossOverlay({ branchName, scene, mossPoints, activeMossRef, debugMode }) {
  const materialRef = useRef(null)
  const mossTexRef = useRef(null)
  const texLoadedRef = useRef(false)
  const lastActiveRef = useRef({ localPos: null, worldPos: null })
  const { camera } = useThree()

  useEffect(() => {
    const loader = new THREE.TextureLoader()
    loader.load(
      ASSET_URLS.mossTexture,
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping
        tex.wrapT = THREE.RepeatWrapping
        tex.minFilter = THREE.LinearFilter
        tex.magFilter = THREE.LinearFilter
        tex.colorSpace = THREE.SRGBColorSpace
        mossTexRef.current = tex
        texLoadedRef.current = true
        if (materialRef.current) {
          materialRef.current.uniforms.uMossTex.value = tex
        }
      },
      undefined,
      () => console.warn('[MossOverlay] moss texture failed to load'),
    )
  }, [])

  const mossScene = useMemo(() => {
    if (!scene) return null
    const mat = createMossMaterial()
    materialRef.current = mat
    mat.uniforms.uMossTexScale.value = MOSS_TEX_SCALE
    if (mossTexRef.current) {
      mat.uniforms.uMossTex.value = mossTexRef.current
    }
    const clone = scene.clone(true)
    clone.traverse((child) => {
      if (child.isMesh) {
        child.material = mat
        child.renderOrder = 1
      }
    })
    return clone
  }, [scene])

  useFrame((_, delta) => {
    const mat = materialRef.current
    if (!mat || !mossPoints) return

    // Wire texture if loaded after material creation
    if (mossTexRef.current && !mat.uniforms.uMossTex.value) {
      mat.uniforms.uMossTex.value = mossTexRef.current
    }

    // Debug mode from URL param
    const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    const mossDebugParam = searchParams?.get('mossDebug')
    mat.uniforms.uDebugMode.value =
      mossDebugParam === 'mask' ? 1 :
      mossDebugParam === 'tex' ? 2 :
      mossDebugParam === 'alpha' ? 3 : 0
    mat.uniforms.uMossTexScale.value = MOSS_TEX_SCALE

    const points = mossPoints
    const active = activeMossRef?.current
    const hasActive = active?.branch === branchName && !!active?.localPos

    // ── band stamp helper ────────────────────────────────────
    // Generates a cylindrical band of coverage points around the active position
    // and upserts them into the points array.
    const stampBand = (centerLocalPos, centerWorldPos, centerWorldNormal) => {
      if (!centerLocalPos || !centerWorldPos || !centerWorldNormal) return
      if (!active?.branchAxisWorld || !active?.branchCenterWorld) return

      const samples = generateCylindricalBandSamples(
        centerWorldPos,
        centerWorldNormal,
        active.branchAxisWorld,
        active.branchCenterWorld,
        camera.position,
      )

      // Rebuild Matrix4 from stored array (matrixWorldInverse of the hit mesh)
      const mwiArr = active?.matrixWorldInverse
      // NOTE: matrixWorldInverse is passed from BranchModel via onMossPaint.
      // If unavailable, band samples collapse toward the center in local space.
      const mwi = mwiArr ? new THREE.Matrix4().fromArray(mwiArr) : null

      for (const sample of samples) {
        // World-space sample position
        const ws = sample.worldPos
        const wn = sample.worldNormal

        // Local-space position (for shader uMossPoints)
        let ls
        if (mwi) {
          const local = ws.clone().applyMatrix4(mwi)
          ls = { x: local.x, y: local.y, z: local.z }
        } else {
          // FALLBACK: approximate local offset from center localPos.
          ls = {
            x: centerLocalPos.x + (ws.x - centerWorldPos.x) * 0.5,
            y: centerLocalPos.y + (ws.y - centerWorldPos.y) * 0.5,
            z: centerLocalPos.z + (ws.z - centerWorldPos.z) * 0.5,
          }
        }

        // Try merge with existing point
        let merged = false
        for (let i = 0; i < points.length; i++) {
          const p = points[i]
          const dx = p.localPos[0] - ls.x
          const dy = p.localPos[1] - ls.y
          const dz = p.localPos[2] - ls.z
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) < MERGE_RADIUS) {
            p.strength = Math.min(1.0, p.strength + delta * REINFORCE_RATE * sample.strengthMul)
            p.worldPos = [ws.x, ws.y, ws.z]
            p.worldNormal = [wn.x, wn.y, wn.z]
            merged = true
            break
          }
        }

        if (merged) continue

        // Create new point
        if (points.length < MAX_MOSS_POINTS) {
          points.push({
            localPos: [ls.x, ls.y, ls.z],
            worldPos: [ws.x, ws.y, ws.z],
            worldNormal: [wn.x, wn.y, wn.z],
            strength: INITIAL_STRENGTH * sample.strengthMul,
            createdAt: performance.now() + sample.seed * 0.001,
            seed: sample.seed,
          })
        } else {
          // At capacity: evict weakest + furthest point, then insert
          let worstIdx = -1
          let worstScore = Infinity
          for (let i = 0; i < points.length; i++) {
            const p = points[i]
            const dx = p.localPos[0] - ls.x
            const dy = p.localPos[1] - ls.y
            const dz = p.localPos[2] - ls.z
            const d = Math.sqrt(dx * dx + dy * dy + dz * dz)
            const score = p.strength - d * 0.5
            if (score < worstScore) {
              worstScore = score
              worstIdx = i
            }
          }
          if (worstIdx >= 0 && (worstScore < 0.3 || points[worstIdx].strength < 0.15)) {
            points[worstIdx] = {
              localPos: [ls.x, ls.y, ls.z],
              worldPos: [ws.x, ws.y, ws.z],
              worldNormal: [wn.x, wn.y, wn.z],
              strength: INITIAL_STRENGTH * sample.strengthMul,
              createdAt: performance.now() + sample.seed * 0.001,
              seed: sample.seed,
            }
          }
        }
      }
    }

    // ── per-point decay ──────────────────────────────────────
    const activeLP = hasActive ? active.localPos : null
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i]
      let distToActive = Infinity
      if (activeLP) {
        const dx = p.localPos[0] - activeLP.x
        const dy = p.localPos[1] - activeLP.y
        const dz = p.localPos[2] - activeLP.z
        distToActive = Math.sqrt(dx * dx + dy * dy + dz * dz)
      }
      const isNearActive = distToActive < ACTIVE_KEEP_RADIUS
      const rate = isNearActive ? ACTIVE_DECAY : DECAY_RATE
      p.strength -= delta * rate
      if (p.strength < DELETE_THRESHOLD) {
        points.splice(i, 1)
      }
    }

    // ── band stamping (every frame while hovering) ───────────
    if (hasActive) {
      const lp = active.localPos
      const wp = active.worldPos
      const wn = active.worldNormal

      // 1. Stamp current band at the active cursor position
      stampBand(lp, wp, wn)

      // 2. Path interpolation: fill gaps when mouse moves fast along the branch
      const lastLP = lastActiveRef.current.localPos
      const lastWP = lastActiveRef.current.worldPos
      if (lastLP && lastWP && wp && lp) {
        const dx = lp.x - lastLP.x
        const dy = lp.y - lastLP.y
        const dz = lp.z - lastLP.z
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz)
        // Skip interpolation if distance is implausibly large (re-entry onto branch)
        const maxInterpDist = BAND_LENGTH * 2
        if (dist > BAND_STEP && dist < maxInterpDist) {
          const steps = Math.ceil(dist / BAND_STEP)
          for (let i = 1; i <= steps; i++) {
            const t = i / steps
            const interpLocal = {
              x: lastLP.x + dx * t,
              y: lastLP.y + dy * t,
              z: lastLP.z + dz * t,
            }
            const interpWorld = {
              x: lastWP.x + (wp.x - lastWP.x) * t,
              y: lastWP.y + (wp.y - lastWP.y) * t,
              z: lastWP.z + (wp.z - lastWP.z) * t,
            }
            stampBand(interpLocal, interpWorld, wn)
          }
        }
      }

      // Update last-active for next frame's interpolation
      lastActiveRef.current = {
        localPos: lp ? { x: lp.x, y: lp.y, z: lp.z } : null,
        worldPos: wp ? { x: wp.x, y: wp.y, z: wp.z } : null,
      }
    } else {
      // Mouse not on this branch — reset interpolation anchor
      lastActiveRef.current = { localPos: null, worldPos: null }
    }

    // ── upload points to shader uniforms ─────────────────────
    const arr = mat.uniforms.uMossPoints.value
    const count = Math.min(points.length, MAX_MOSS_POINTS)
    for (let i = 0; i < count; i++) {
      const p = points[i]
      const off = i * 4
      arr[off] = p.localPos[0]
      arr[off + 1] = p.localPos[1]
      arr[off + 2] = p.localPos[2]
      arr[off + 3] = Math.max(0, Math.min(1, p.strength))
    }
    for (let i = count; i < MAX_MOSS_POINTS; i++) {
      const off = i * 4
      arr[off] = 0
      arr[off + 1] = 0
      arr[off + 2] = 0
      arr[off + 3] = 0
    }
    mat.uniforms.uMossCount.value = count
    mat.uniforms.uMossPoints.needsUpdate = true
    mat.uniforms.uTime.value += delta
  })

  if (!mossScene) return null
  return <primitive object={mossScene} />
}

// Exported so DebugPanel can reference band settings
export const BAND_SETTINGS = {
  BAND_LENGTH,
  BAND_LENGTH_SAMPLES,
  BAND_ARC_DEG,
  BAND_ARC_SAMPLES,
  BAND_RADIUS_SCALE,
  BAND_STEP,
  ACTIVE_KEEP_RADIUS,
  MERGE_RADIUS,
}
