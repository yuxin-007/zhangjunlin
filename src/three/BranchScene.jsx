import React, { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import BranchMesh from './BranchMesh.jsx'
import MossFibers from './MossFibers.jsx'

const MAX_POINTS = 10

function makeBranchCurve(offsetY = 0, offsetZ = 0, scale = 1) {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(-5.4 * scale, -1.05 * scale + offsetY, offsetZ),
    new THREE.Vector3(-3.2 * scale, -0.84 * scale + offsetY, offsetZ + 0.05),
    new THREE.Vector3(-0.6 * scale, -0.46 * scale + offsetY, offsetZ + 0.03),
    new THREE.Vector3(2.4 * scale, -0.02 * scale + offsetY, offsetZ - 0.04),
    new THREE.Vector3(5.7 * scale, 0.34 * scale + offsetY, offsetZ),
  ])
}

function makeLeftForkCurve() {
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(-5.35, -0.05, -0.08),
    new THREE.Vector3(-4.05, -0.28, -0.03),
    new THREE.Vector3(-2.5, -0.58, 0.03),
    new THREE.Vector3(-1.45, -0.73, 0.02),
  ])
}

export default function BranchScene({ shared }) {
  const mossPoints = useRef(
    Array.from({ length: MAX_POINTS }, () => ({
      point: new THREE.Vector3(20, 20, 20),
      strength: 0,
    })),
  )
  const nextIndex = useRef(0)
  const lastSample = useRef(0)

  const materialRef = useRef(null)

  const branchData = useMemo(() => {
    const mainCurve = makeBranchCurve()
    const forkCurve = makeLeftForkCurve()
    const rearCurve = makeBranchCurve(-0.46, -0.18, 0.92)

    return [
      {
        key: 'main',
        curve: mainCurve,
        tubularSegments: 300,
        radius: 0.75,
        radialSegments: 38,
        renderOrder: 3,
      },
      {
        key: 'fork',
        curve: forkCurve,
        tubularSegments: 140,
        radius: 0.40,
        radialSegments: 28,
        renderOrder: 2,
      },
      {
        key: 'rear',
        curve: rearCurve,
        tubularSegments: 240,
        radius: 0.55,
        radialSegments: 32,
        renderOrder: 1,
      },
    ]
  }, [])

  const uniforms = useMemo(() => {
    const pointUniforms = mossPoints.current.map((p) => p.point)
    const strengthUniforms = mossPoints.current.map((p) => p.strength)

    return {
      uTime: { value: 0 },
      uMousePoint: { value: shared.current.hoverPoint },
      uHoverStrength: { value: 0 },
      uMossPoints: { value: pointUniforms },
      uMossStrengths: { value: strengthUniforms },
      uResolution: { value: new THREE.Vector2(1, 1) },
    }
  }, [shared])

  function registerMossPoint(point, clockTime) {
    if (clockTime - lastSample.current < 0.075) return
    lastSample.current = clockTime

    const slot = mossPoints.current[nextIndex.current]
    slot.point.copy(point)
    slot.strength = 1.0
    nextIndex.current = (nextIndex.current + 1) % MAX_POINTS
  }

  function handlePointerMove(event) {
    event.stopPropagation()
    shared.current.hoverPoint.copy(event.point)
    shared.current.targetHover = 1
    registerMossPoint(event.point, event.nativeEvent?.timeStamp ? event.nativeEvent.timeStamp / 1000 : performance.now() / 1000)
  }

  function handlePointerOut() {
    shared.current.targetHover = 0
  }

  useFrame((state, delta) => {
    shared.current.hoverStrength = THREE.MathUtils.damp(
      shared.current.hoverStrength,
      shared.current.targetHover,
      5.8,
      delta,
    )

    for (const item of mossPoints.current) {
      item.strength = Math.max(0, item.strength - delta * 0.22)
    }

    if (materialRef.current) {
      const mat = materialRef.current
      mat.uniforms.uTime.value = state.clock.elapsedTime
      mat.uniforms.uHoverStrength.value = shared.current.hoverStrength
      mat.uniforms.uMousePoint.value.copy(shared.current.hoverPoint)
      mat.uniforms.uMossPoints.value = mossPoints.current.map((p) => p.point)
      mat.uniforms.uMossStrengths.value = mossPoints.current.map((p) => p.strength)
    }
  })

  return (
    <group rotation={[0, 0, 0.02]} position={[0, -0.7, 0]}>
      <ambientLight intensity={1.6} />
      <directionalLight position={[-3, 4, 5]} intensity={1.9} />
      <directionalLight position={[3, -2, 4]} intensity={0.55} />

      {branchData.map((branch) => (
        <BranchMesh
          key={branch.key}
          {...branch}
          uniforms={uniforms}
          materialRef={materialRef}
          onPointerMove={handlePointerMove}
          onPointerOut={handlePointerOut}
        />
      ))}

      <MossFibers shared={shared} mossPoints={mossPoints} />
    </group>
  )
}
