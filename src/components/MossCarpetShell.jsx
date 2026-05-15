import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { ASSET_URLS } from '../assetPaths'
import { createMossCarpetMaterial, MAX_BAND_STAMPS } from '../shaders/mossCarpetShader'

const BAND_LENGTH = 0.52
const BAND_ARC_DEG = 165
const BAND_ARC_RAD = BAND_ARC_DEG * Math.PI / 180
const BAND_STEP = 0.14
const MERGE_S_RADIUS = 0.16
const MERGE_THETA_RADIUS = 0.55
const ACTIVE_KEEP_S = 0.44
const ACTIVE_KEEP_THETA = 0.92
const DECAY_RATE = 1.0
const ACTIVE_DECAY = 0.02
const DELETE_THRESHOLD = 0.04
const REINFORCE_RATE = 1.9
const INITIAL_STRENGTH = 0.62
const MOSS_TEX_SCALE = 8.0
const SHELL_OFFSET = 0.008

function toVec3(obj, fallback = new THREE.Vector3()) {
  if (!obj) return fallback.clone()
  if (obj.isVector3) return obj.clone()
  return new THREE.Vector3(obj.x ?? 0, obj.y ?? 0, obj.z ?? 0)
}

function hashStamp(axisS, theta) {
  const a = Math.floor(axisS * 1000)
  const b = Math.floor(theta * 1000)
  let h = Math.imul((a ^ (b << 8)) >>> 0, 2654435761)
  h = Math.imul((h ^ 0x9e3779b9) >>> 0, 2246822519)
  return ((h >>> 0) & 0x7fffffff) / 0x7fffffff
}

function angleDistance(a, b) {
  let d = Math.abs(a - b) % (Math.PI * 2)
  return d > Math.PI ? Math.PI * 2 - d : d
}

function buildAxisBasis(axis) {
  const up = Math.abs(axis.y) < 0.92 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1)
  const u = new THREE.Vector3().crossVectors(axis, up).normalize()
  const v = new THREE.Vector3().crossVectors(axis, u).normalize()
  return { u, v }
}

function computeStampData(worldPos, worldNormal, axisWorld, centerWorld) {
  const wp = toVec3(worldPos)
  const axis = toVec3(axisWorld, new THREE.Vector3(1, 0, 0)).normalize()
  const center = toVec3(centerWorld)
  const normal = toVec3(worldNormal, new THREE.Vector3(0, 1, 0)).normalize()

  const fromCenter = wp.clone().sub(center)
  const axisS = fromCenter.dot(axis)
  const axisPoint = center.clone().addScaledVector(axis, axisS)
  const radial = wp.clone().sub(axisPoint)
  const radius = Math.max(0.01, radial.length())

  let radialDir = radial.lengthSq() > 0.0001 ? radial.clone().normalize() : normal.clone()
  radialDir.addScaledVector(axis, -radialDir.dot(axis))
  if (radialDir.lengthSq() < 0.0001) radialDir = buildAxisBasis(axis).u
  radialDir.normalize()

  const { u, v } = buildAxisBasis(axis)
  const theta = Math.atan2(radialDir.dot(v), radialDir.dot(u))

  const normalRadial = normal.clone().addScaledVector(axis, -normal.dot(axis))
  const stampNormal = normalRadial.lengthSq() > 0.0001 ? normalRadial.normalize() : radialDir.clone()

  return { axisS, theta, radius, normalWorld: stampNormal, centerWorld: wp, seed: hashStamp(axisS, theta) }
}

export default function MossCarpetShell({ branchName, scene, activeMossRef, branchAxisLocal, branchCenterLocal, branchAxisWorld, branchCenterWorld, debugMode, onStats }) {
  const materialRef = useRef(null)
  const mossTexRef = useRef(null)
  const stampsRef = useRef([])
  const lastActiveRef = useRef(null)
  const frameCounterRef = useRef(0)

  const axisLocal = useMemo(() => toVec3(branchAxisLocal, new THREE.Vector3(1, 0, 0)).normalize(), [branchAxisLocal])
  const centerLocal = useMemo(() => toVec3(branchCenterLocal, new THREE.Vector3(0, 0, 0)), [branchCenterLocal])
  const axisWorld = useMemo(() => toVec3(branchAxisWorld, new THREE.Vector3(1, 0, 0)).normalize(), [branchAxisWorld])
  const centerWorld = useMemo(() => toVec3(branchCenterWorld, new THREE.Vector3(0, 0, 0)), [branchCenterWorld])

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
        if (materialRef.current) materialRef.current.uniforms.uMossTex.value = tex
      },
      undefined,
      () => console.warn('[MossCarpetShell] moss texture failed to load'),
    )
  }, [])

  const carpetScene = useMemo(() => {
    if (!scene) return null
    const mat = createMossCarpetMaterial()
    materialRef.current = mat
    mat.uniforms.uBranchAxisWorld.value.copy(axisWorld)
    mat.uniforms.uBranchCenterWorld.value.copy(centerWorld)
    mat.uniforms.uMossTexScale.value = MOSS_TEX_SCALE
    mat.uniforms.uShellOffset.value = SHELL_OFFSET
    if (mossTexRef.current) mat.uniforms.uMossTex.value = mossTexRef.current

    const clone = scene.clone(true)
    clone.traverse((child) => {
      if (child.isMesh) {
        child.material = mat
        child.renderOrder = 1
        child.frustumCulled = false
      }
    })
    return clone
  }, [axisLocal, centerLocal, axisWorld, centerWorld, scene])

  function upsertStamp(stamp, delta) {
    const stamps = stampsRef.current
    let best = null
    let bestScore = Infinity
    for (const s of stamps) {
      const ds = Math.abs(s.axisS - stamp.axisS)
      const dt = angleDistance(s.theta, stamp.theta)
      if (ds < MERGE_S_RADIUS && dt < MERGE_THETA_RADIUS) {
        const score = ds / MERGE_S_RADIUS + dt / MERGE_THETA_RADIUS
        if (score < bestScore) {
          bestScore = score
          best = s
        }
      }
    }

    if (best) {
      best.strength = Math.min(1, best.strength + delta * REINFORCE_RATE)
      best.centerWorld = stamp.centerWorld
      best.normalWorld = stamp.normalWorld
      best.axisS = best.axisS * 0.78 + stamp.axisS * 0.22
      best.theta = best.theta * 0.82 + stamp.theta * 0.18
      best.radius = best.radius * 0.8 + stamp.radius * 0.2
      return
    }

    if (stamps.length >= MAX_BAND_STAMPS) {
      let worstIdx = 0
      let worstScore = Infinity
      for (let i = 0; i < stamps.length; i++) {
        const s = stamps[i]
        const ds = Math.abs(s.axisS - stamp.axisS)
        const score = s.strength - ds * 0.18
        if (score < worstScore) {
          worstScore = score
          worstIdx = i
        }
      }
      stamps.splice(worstIdx, 1)
    }

    stamps.push({
      centerWorld: stamp.centerWorld,
      normalWorld: stamp.normalWorld,
      axisS: stamp.axisS,
      theta: stamp.theta,
      radius: stamp.radius,
      strength: INITIAL_STRENGTH,
      length: BAND_LENGTH,
      arc: BAND_ARC_RAD,
      seed: stamp.seed,
      createdAt: performance.now(),
    })
  }

  function stampAt(worldPos, worldNormal, delta) {
    if (!worldPos) return
    const stamp = computeStampData(worldPos, worldNormal, axisWorld, centerWorld)
    upsertStamp(stamp, delta)
  }

  useFrame((_, delta) => {
    const mat = materialRef.current
    if (!mat) return
    if (mossTexRef.current && !mat.uniforms.uMossTex.value) mat.uniforms.uMossTex.value = mossTexRef.current

    const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
    const mossDebugParam = searchParams?.get('mossDebug')
    mat.uniforms.uDebugMode.value =
      mossDebugParam === 'mask' ? 1 :
      mossDebugParam === 'tex' ? 2 :
      mossDebugParam === 'alpha' ? 3 : 0

    const active = activeMossRef?.current
    const hasActive = active?.branch === branchName && !!active?.worldPos
    const activeData = hasActive ? computeStampData(active.worldPos, active.worldNormal, axisWorld, centerWorld) : null

    const stamps = stampsRef.current
    for (let i = stamps.length - 1; i >= 0; i--) {
      const s = stamps[i]
      let nearActive = false
      if (activeData) {
        const ds = Math.abs(s.axisS - activeData.axisS)
        const dt = angleDistance(s.theta, activeData.theta)
        nearActive = ds < ACTIVE_KEEP_S && dt < ACTIVE_KEEP_THETA
      }
      s.strength -= delta * (nearActive ? ACTIVE_DECAY : DECAY_RATE)
      if (s.strength < DELETE_THRESHOLD) stamps.splice(i, 1)
    }

    if (hasActive) {
      stampAt(active.worldPos, active.worldNormal, delta)

      const last = lastActiveRef.current
      if (last?.worldPos) {
        const cur = toVec3(active.worldPos)
        const prev = toVec3(last.worldPos)
        const dist = cur.distanceTo(prev)
        const maxInterpDist = BAND_LENGTH * 1.8
        if (dist > BAND_STEP && dist < maxInterpDist) {
          const steps = Math.ceil(dist / BAND_STEP)
          const n0 = toVec3(last.worldNormal, new THREE.Vector3(0, 1, 0))
          const n1 = toVec3(active.worldNormal, new THREE.Vector3(0, 1, 0))
          for (let i = 1; i <= steps; i++) {
            const t = i / steps
            const lp = prev.clone().lerp(cur, t)
            const ln = n0.clone().lerp(n1, t).normalize()
            stampAt(lp, ln, delta)
          }
        }
      }

      lastActiveRef.current = {
        worldPos: { ...active.worldPos },
        worldNormal: active.worldNormal ? { ...active.worldNormal } : null,
      }
    } else {
      lastActiveRef.current = null
    }

    const s0 = mat.uniforms.uStamp0.value
    const s1 = mat.uniforms.uStamp1.value
    const s2 = mat.uniforms.uStamp2.value
    const count = Math.min(stamps.length, MAX_BAND_STAMPS)

    for (let i = 0; i < count; i++) {
      const s = stamps[i]
      const off = i * 4
      s0[off] = s.centerWorld.x
      s0[off + 1] = s.centerWorld.y
      s0[off + 2] = s.centerWorld.z
      s0[off + 3] = Math.max(0, Math.min(1, s.strength))

      s1[off] = s.normalWorld.x
      s1[off + 1] = s.normalWorld.y
      s1[off + 2] = s.normalWorld.z
      s1[off + 3] = s.radius

      s2[off] = s.axisS
      s2[off + 1] = s.length
      s2[off + 2] = s.arc * 0.5
      s2[off + 3] = s.seed
    }
    for (let i = count; i < MAX_BAND_STAMPS; i++) {
      const off = i * 4
      s0[off] = s0[off + 1] = s0[off + 2] = s0[off + 3] = 0
      s1[off] = s1[off + 1] = s1[off + 2] = s1[off + 3] = 0
      s2[off] = s2[off + 1] = s2[off + 2] = s2[off + 3] = 0
    }

    mat.uniforms.uStampCount.value = count
    mat.uniforms.uStamp0.needsUpdate = true
    mat.uniforms.uStamp1.needsUpdate = true
    mat.uniforms.uStamp2.needsUpdate = true
    mat.uniforms.uTime.value += delta

    if (debugMode && onStats && frameCounterRef.current++ % 12 === 0) {
      const totalStrength = stamps.reduce((sum, s) => sum + s.strength, 0)
      onStats(branchName, {
        stampCount: count,
        totalStrength,
        maxStamps: MAX_BAND_STAMPS,
        decayMode: 'band stamps (local shell)',
        route: 'MossCarpetShell shader',
      })
    }
  })

  if (!carpetScene) return null
  return <primitive object={carpetScene} />
}

export const MOSS_CARPET_SETTINGS = {
  MAX_BAND_STAMPS,
  BAND_LENGTH,
  BAND_ARC_DEG,
  BAND_STEP,
  SHELL_OFFSET,
  MOSS_TEX_SCALE,
  ACTIVE_KEEP_S,
  ACTIVE_KEEP_THETA,
}
