import React, { useRef } from 'react'
import { Canvas } from '@react-three/fiber'
import { AdaptiveDpr } from '@react-three/drei'
import * as THREE from 'three'
import BranchScene from '../three/BranchScene.jsx'

export default function CanvasScene() {
  const shared = useRef({
    hoverPoint: new THREE.Vector3(0.1, -0.15, 0.22),
    hoverStrength: 0,
    targetHover: 0,
  })

  return (
    <div className="canvas-layer">
      <Canvas
        orthographic
        dpr={[1, 1.75]}
        camera={{ position: [0, 0, 8], zoom: 125, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor(0xeff1ec, 0)
          gl.outputColorSpace = THREE.SRGBColorSpace
        }}
      >
        <AdaptiveDpr pixelated={false} />
        <BranchScene shared={shared} />
      </Canvas>
    </div>
  )
}
