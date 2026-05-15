import React, { useMemo } from 'react'
import * as THREE from 'three'
import vertexShader from '../shaders/barkMoss.vert?raw'
import fragmentShader from '../shaders/barkMoss.frag?raw'

export default function BranchMesh({
  curve,
  tubularSegments,
  radius,
  radialSegments,
  uniforms,
  materialRef,
  onPointerMove,
  onPointerOut,
  renderOrder = 0,
}) {
  const geometry = useMemo(() => {
    const geo = new THREE.TubeGeometry(curve, tubularSegments, radius, radialSegments, false)
    geo.computeVertexNormals()
    geo.computeBoundingSphere()
    return geo
  }, [curve, tubularSegments, radius, radialSegments])

  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: false,
      depthWrite: true,
      depthTest: true,
    })
    mat.toneMapped = false
    return mat
  }, [uniforms])

  // 所有枝干共享同一个 shader uniform；这里记录主材质引用，便于 useFrame 更新。
  if (!materialRef.current) {
    materialRef.current = material
  }

  return (
    <mesh
      geometry={geometry}
      material={material}
      renderOrder={renderOrder}
      onPointerMove={onPointerMove}
      onPointerOver={onPointerMove}
      onPointerOut={onPointerOut}
    />
  )
}
