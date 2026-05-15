import { useState, useCallback, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { ASSET_URLS } from '../assetPaths'
import BranchPlane from './BranchPlane'
import MossInteractivePlane from './MossInteractivePlane'
import { createMaskSampler } from '../utils/maskSampler'
import { analyzeImageAlpha } from '../utils/analyzeImageAlpha'
import { projectUvToCenterline } from '../utils/branchCenterline'
import BranchModelScene from './BranchModelScene'

const USE_3D_BRANCH = true

const COVERAGE_SIZE = 1024
const COVERAGE_FLIP_Y = true

function SceneContent({
  onPointerMove,
  onPointerLeave,
  materialRef,
  coverageTexture,
  coverageCtxRef,
  coverageTextureRef,
  activeBrushRef,
  lastActivePaintTimeRef,
  paintMossCoverageFn,
  debugMode,
  visualMaskUrl,
}) {
  const { viewport } = useThree()
  const w = viewport.width
  const h = viewport.height

  useFrame((_, delta) => {
    const ctx = coverageCtxRef.current
    const texture = coverageTextureRef.current
    const mat = materialRef.current
    if (!ctx || !texture || !mat) return

    const now = performance.now()
    const active = activeBrushRef.current

    const isActive = !!active

    // Slower decay while mouse is on branch, normal decay when off
    const decay = isActive
      ? Math.min(0.010, delta * 0.18)
      : Math.min(0.030, delta * 0.55)

    ctx.save()
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = `rgba(0, 0, 0, ${decay})`
    ctx.fillRect(0, 0, COVERAGE_SIZE, COVERAGE_SIZE)
    ctx.restore()

    // Continuously replenish coverage while mouse is on branch
    if (isActive && (now - lastActivePaintTimeRef.current) > 33) {
      paintMossCoverageFn(active.uv, active.tangent, active.strength)
      lastActivePaintTimeRef.current = now
    }

    texture.needsUpdate = true

    if (mat.uniforms.uCoverageMap) mat.uniforms.uCoverageMap.value = texture
    if (mat.uniforms.uTime) mat.uniforms.uTime.value += delta
    if (mat.uniforms.uDebugMode) mat.uniforms.uDebugMode.value = debugMode
  })

  return (
    <group>
      <BranchPlane width={w} height={h} visualMaskUrl={visualMaskUrl} />
      <MossInteractivePlane
        width={w}
        height={h}
        materialRef={materialRef}
        coverageTexture={coverageTexture}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      />
    </group>
  )
}

export default function HeroVisual() {
  const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null
  const showDebug = !!searchParams?.has('debug')
  const shaderDebugMode = searchParams?.get('shaderDebug') === 'coverage'
    ? 1
    : searchParams?.get('shaderDebug') === 'mask'
      ? 2
      : 0

  const [assetStatus, setAssetStatus] = useState({ checking: true, messages: [] })
  const [hitDebug, setHitDebug] = useState(null)
  const [visualMaskUrl, setVisualMaskUrl] = useState(null)
  const [visualMaskFallback, setVisualMaskFallback] = useState(false)
  const [coverageTexture, setCoverageTexture] = useState(null)
  const [coverageDebugUrl, setCoverageDebugUrl] = useState(null)

  const materialRef = useRef(null)
  const maskSamplerRef = useRef(null)
  const coverageCanvasRef = useRef(null)
  const coverageCtxRef = useRef(null)
  const coverageTextureRef = useRef(null)
  const lastPaintTimeRef = useRef(0)
  const paintCountRef = useRef(0)
  const activeBrushRef = useRef(null)
  const lastActivePaintTimeRef = useRef(0)

  // IMPORTANT: this function must live inside HeroVisual so it can access refs.
  // The previous version defined it at module scope, which caused a runtime
  // ReferenceError on the first valid pointer hit and made the interaction appear dead.
  const paintMossCoverage = useCallback((uv, tangent, strength = 1) => {
    const canvas = coverageCanvasRef.current
    const ctx = coverageCtxRef.current
    const texture = coverageTextureRef.current
    if (!canvas || !ctx || !texture) return false

    const x = uv.x * canvas.width
    const y = COVERAGE_FLIP_Y
      ? (1 - uv.y) * canvas.height
      : uv.y * canvas.height

    const angle = -Math.atan2(tangent[1], tangent[0])
    const brushLength = 124
    const brushWidth = 34

    ctx.save()
    ctx.translate(x, y)
    ctx.rotate(angle)
    ctx.scale(brushLength, brushWidth)

    const gradient = ctx.createRadialGradient(0, 0, 0.0, 0, 0, 1.0)
    gradient.addColorStop(0.0, `rgba(255,255,255,${0.55 * strength})`)
    gradient.addColorStop(0.34, `rgba(255,255,255,${0.36 * strength})`)
    gradient.addColorStop(0.72, `rgba(255,255,255,${0.12 * strength})`)
    gradient.addColorStop(1.0, 'rgba(255,255,255,0)')

    ctx.globalCompositeOperation = 'lighter'
    ctx.fillStyle = gradient
    ctx.beginPath()
    ctx.ellipse(0, 0, 1, 1, 0, 0, Math.PI * 2)
    ctx.fill()

    // White coverage speckles, not green visible paint. The shader turns this
    // coverage into moss and clips it by the branch mask.
    for (let i = 0; i < 12; i++) {
      const px = (Math.random() - 0.5) * 1.7
      const py = (Math.random() - 0.5) * 1.0
      if ((px * px) / 1.0 + (py * py) / 0.38 > 1.0) continue

      const r = 0.024 + Math.random() * 0.055
      const a = 0.045 + Math.random() * 0.075
      ctx.beginPath()
      ctx.fillStyle = `rgba(255,255,255,${a * strength})`
      ctx.ellipse(px, py, r, r * 0.65, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    ctx.restore()
    texture.needsUpdate = true
    return true
  }, [])

  // Init coverage canvas + CanvasTexture.
  useEffect(() => {
    const canvas = document.createElement('canvas')
    canvas.width = COVERAGE_SIZE
    canvas.height = COVERAGE_SIZE

    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) {
      console.warn('[coverage] failed to create 2d context')
      return
    }

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, COVERAGE_SIZE, COVERAGE_SIZE)

    const texture = new THREE.CanvasTexture(canvas)
    texture.minFilter = THREE.LinearFilter
    texture.magFilter = THREE.LinearFilter
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    // Match ordinary image textures loaded by Three/useTexture. If the preview
    // is painted but moss appears vertically wrong, try changing this together
    // with COVERAGE_FLIP_Y.
    texture.flipY = true
    texture.needsUpdate = true

    coverageCanvasRef.current = canvas
    coverageCtxRef.current = ctx
    coverageTextureRef.current = texture
    setCoverageTexture(texture)
  }, [])

  // Check if branch-visual-mask.png exists, fallback to hit mask if not.
  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      setVisualMaskUrl(ASSET_URLS.branchVisualMask)
    }
    img.onerror = () => {
      if (cancelled) return
      console.warn('[Visual mask] branch-visual-mask.png missing, fallback to branch-hit-mask.png for visual clipping.')
      setVisualMaskUrl(ASSET_URLS.branchHitMask)
      setVisualMaskFallback(true)
    }
    img.src = ASSET_URLS.branchVisualMask
    return () => { cancelled = true }
  }, [])

  // Load hit mask sampler (UV-based).
  useEffect(() => {
    let cancelled = false
    createMaskSampler(ASSET_URLS.branchHitMask).then((sampler) => {
      if (cancelled) return
      maskSamplerRef.current = sampler
    }).catch((err) => {
      if (cancelled) return
      console.warn('[Hit mask] failed to load:', err)
    })
    return () => { cancelled = true }
  }, [])

  // Alpha check (diagnostic only — does not block interaction).
  useEffect(() => {
    async function check() {
      const msgs = []
      try {
        const branchR = await analyzeImageAlpha(ASSET_URLS.branchMain)
        msgs.push(`branch-main.png → ${branchR.verdict}`)
        if (!branchR.hasRealTransparency) msgs.push('WARNING: branch-main.png is NOT a real transparent PNG!')

        const mossR = await analyzeImageAlpha(ASSET_URLS.mossPatchBase)
        msgs.push(`moss-patch-base.png → ${mossR.verdict}`)
        if (!mossR.hasRealTransparency) msgs.push('WARNING: moss-patch-base.png is NOT a real transparent PNG!')

        if (!branchR.hasRealTransparency || !mossR.hasRealTransparency) {
          msgs.push('ACTION: Please re-export both images as real transparent PNG/WebP with alpha channel.')
        }
      } catch (err) {
        msgs.push(`Detection failed: ${err.message}`)
      }
      msgs.forEach((m) => console.warn('[Alpha check]', m))
      setAssetStatus({ checking: false, messages: msgs })
    }
    check()
  }, [])

  const handlePointerMove = useCallback((e) => {
    if (!e.uv || !maskSamplerRef.current || !coverageTextureRef.current) return

    const result = maskSamplerRef.current(e.uv)

    if (showDebug) {
      setHitDebug({
        uv: [e.uv.x.toFixed(3), e.uv.y.toFixed(3)],
        isHit: result.isHit,
        brightness: result.brightness,
        maskX: result.maskX,
        maskY: result.maskY,
        textureReady: !!coverageTextureRef.current,
        visualMaskFallback,
      })
    }

    // Hard guarantee: never write coverage outside the branch hit mask.
    if (!result.isHit) {
      activeBrushRef.current = null
      return
    }

    const projected = projectUvToCenterline(e.uv)
    if (!projected) return

    activeBrushRef.current = {
      uv: { x: e.uv.x, y: e.uv.y },
      tangent: projected.tangent,
      lastSeen: performance.now(),
      strength: 0.85,
    }

    const now = performance.now()
    if (now - lastPaintTimeRef.current < 16) return
    lastPaintTimeRef.current = now

    const painted = paintMossCoverage(e.uv, projected.tangent, 0.75)
    if (!painted) return

    paintCountRef.current += 1

    if (showDebug) {
      console.log('[paint coverage]', e.uv.x.toFixed(3), e.uv.y.toFixed(3), 'tangent:', projected.tangent.map((v) => v.toFixed(3)).join(','))
      setCoverageDebugUrl(coverageCanvasRef.current.toDataURL())
    }
  }, [paintMossCoverage, showDebug, visualMaskFallback])

  const handlePointerLeave = useCallback(() => {
    activeBrushRef.current = null
  }, [])

  return (
    <div className="hero-visual">
      {USE_3D_BRANCH ? (
        <div className="r3f-model-stage">
          <BranchModelScene debugMode={showDebug || shaderDebugMode > 0} />
        </div>
      ) : (
        <>
          <div className="r3f-stage">
            {visualMaskUrl && coverageTexture && (
              <Canvas
                orthographic
                camera={{ position: [0, 0, 1], near: 0.1, far: 10 }}
                gl={{ alpha: true, premultipliedAlpha: true }}
              >
                <SceneContent
                  onPointerMove={handlePointerMove}
                  onPointerLeave={handlePointerLeave}
                  materialRef={materialRef}
                  coverageTexture={coverageTexture}
                  coverageCtxRef={coverageCtxRef}
                  coverageTextureRef={coverageTextureRef}
                  activeBrushRef={activeBrushRef}
                  lastActivePaintTimeRef={lastActivePaintTimeRef}
                  paintMossCoverageFn={paintMossCoverage}
                  debugMode={shaderDebugMode}
                  visualMaskUrl={visualMaskUrl}
                />
              </Canvas>
            )}
          </div>

          {import.meta.env.DEV && showDebug && !assetStatus.checking && assetStatus.messages.length > 0 && (
            <div className="asset-debug-banner">
              {assetStatus.messages.join('\n')}
            </div>
          )}

          {import.meta.env.DEV && showDebug && hitDebug && (
            <div
              style={{
                position: 'fixed',
                bottom: 10,
                right: 10,
                zIndex: 9999,
                background: hitDebug.isHit ? 'rgba(0,80,0,0.85)' : 'rgba(80,0,0,0.85)',
                color: '#fff',
                fontFamily: 'monospace',
                fontSize: 11,
                padding: '8px 12px',
                borderRadius: 4,
                pointerEvents: 'none',
                lineHeight: 1.5,
              }}
            >
              uv=({hitDebug.uv[0]}, {hitDebug.uv[1]}){'\n'}
              maskXY=({hitDebug.maskX}, {hitDebug.maskY}) br={hitDebug.brightness}{'\n'}
              isHit={hitDebug.isHit ? 'TRUE' : 'FALSE'} paints={paintCountRef.current}{'\n'}
              texReady={hitDebug.textureReady ? 'YES' : 'NO'}{'\n'}
              visMask={hitDebug.visualMaskFallback ? 'FALLBACK' : 'OK'}
            </div>
          )}

          {import.meta.env.DEV && showDebug && coverageDebugUrl && (
            <div
              style={{
                position: 'fixed',
                top: 10,
                right: 10,
                zIndex: 9999,
                background: 'rgba(0,0,0,0.85)',
                padding: 4,
                borderRadius: 4,
                pointerEvents: 'none',
              }}
            >
              <div style={{ color: '#ffcc00', fontFamily: 'monospace', fontSize: 9, marginBottom: 2 }}>
                coverage map (1024x1024)
              </div>
              <img
                src={coverageDebugUrl}
                alt="Coverage map preview"
                style={{ width: 160, height: 160, imageRendering: 'pixelated', border: '1px solid #444' }}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
