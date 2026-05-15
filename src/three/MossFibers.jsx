import React, { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

function seeded(i) {
  return fract(Math.sin(i * 41.735 + 2.123) * 43758.5453)
}

function fract(v) {
  return v - Math.floor(v)
}

function writeLine(array, index, start, end) {
  const i = index * 6
  array[i + 0] = start.x
  array[i + 1] = start.y
  array[i + 2] = start.z
  array[i + 3] = end.x
  array[i + 4] = end.y
  array[i + 5] = end.z
}

export default function MossFibers({ shared, mossPoints }) {
  const baseGeometry = useMemo(() => {
    const count = 450
    const positions = new Float32Array(count * 2 * 3)
    const root = new THREE.Vector3()
    const tip = new THREE.Vector3()

    for (let i = 0; i < count; i++) {
      const along = (seeded(i + 21) - 0.5) * 2.5
      const across = (seeded(i + 31) - 0.5) * 0.55
      const height = 0.06 + seeded(i + 55) * 0.38

      root.set(0.05 + along, -0.18 + along * 0.065 + across * 0.18, 0.18 + across)
      tip.copy(root).add(new THREE.Vector3(
        (seeded(i + 61) - 0.5) * 0.12,
        height,
        (seeded(i + 71) - 0.5) * 0.10,
      ))
      writeLine(positions, i, root, tip)
    }

    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return geometry
  }, [])

  const dynamicGeometry = useMemo(() => {
    const count = 180
    const positions = new Float32Array(count * 2 * 3)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    return geometry
  }, [])

  const dynamicMaterial = useRef(null)
  const tempA = useMemo(() => new THREE.Vector3(), [])
  const tempB = useMemo(() => new THREE.Vector3(), [])

  useFrame((_, delta) => {
    const attr = dynamicGeometry.getAttribute('position')
    const arr = attr.array
    const center = shared.current.hoverPoint
    const strength = shared.current.hoverStrength

    let pointBoost = 0
    for (const p of mossPoints.current) pointBoost = Math.max(pointBoost, p.strength)
    const visible = Math.max(strength, pointBoost * 0.55)

    for (let i = 0; i < 180; i++) {
      const r = Math.sqrt(seeded(i + 100)) * 0.58
      const a = seeded(i + 200) * Math.PI * 2
      const h = (0.03 + seeded(i + 300) * 0.24) * visible
      tempA.set(
        center.x + Math.cos(a) * r * 0.72,
        center.y + Math.sin(a) * r * 0.22 + 0.13,
        center.z + Math.sin(a) * r * 0.55,
      )
      tempB.copy(tempA).add(new THREE.Vector3(
        (seeded(i + 400) - 0.5) * 0.12,
        h,
        (seeded(i + 500) - 0.5) * 0.10,
      ))
      writeLine(arr, i, tempA, tempB)
    }

    attr.needsUpdate = true
    if (dynamicMaterial.current) {
      dynamicMaterial.current.opacity = THREE.MathUtils.damp(dynamicMaterial.current.opacity, visible * 0.88, 7, delta)
    }
  })

  return (
    <group renderOrder={10}>
      <lineSegments geometry={baseGeometry}>
        <lineBasicMaterial color="#2d4a0e" transparent opacity={0.72} depthWrite={false} />
      </lineSegments>
      <lineSegments geometry={dynamicGeometry}>
        <lineBasicMaterial ref={dynamicMaterial} color="#446b14" transparent opacity={0} depthWrite={false} />
      </lineSegments>
    </group>
  )
}
