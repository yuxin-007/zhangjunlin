import React, { useRef, useEffect, useCallback } from 'react'

const FADE_STEPS = 48
const SPOT_RADIUS = 72
const MASK_UPDATE_INTERVAL = 120

function seededRandom(seed) {
  let s = seed
  return function () {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

function drawMaskSpot(ctx, x, y, radius, seed) {
  const rand = seededRandom(seed)
  const points = 36

  const grad = ctx.createRadialGradient(x, y, radius * 0.05, x, y, radius)
  grad.addColorStop(0, 'rgba(255,255,255,0.85)')
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)')
  grad.addColorStop(0.7, 'rgba(255,255,255,0.15)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')

  ctx.fillStyle = grad
  ctx.beginPath()

  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2
    const n1 = Math.sin(angle * 5.3 + rand() * 6.28) * 0.5 + 0.5
    const n2 = Math.sin(angle * 3.1 + rand() * 6.28) * 0.5 + 0.5
    const n3 = Math.cos(angle * 7.7 + rand() * 6.28) * 0.5 + 0.5
    const noiseR = radius * (0.62 + 0.38 * n1 * n2 * n3)
    const px = x + Math.cos(angle) * noiseR
    const py = y + Math.sin(angle) * noiseR
    if (i === 0) ctx.moveTo(px, py)
    else ctx.lineTo(px, py)
  }

  ctx.closePath()
  ctx.fill()
}

function fadeMask(ctx, width, height, step) {
  if (step % 3 !== 0) return
  ctx.fillStyle = 'rgba(0,0,0,0.035)'
  ctx.fillRect(0, 0, width, height)
}

export default function MossCanvas({ onMaskUpdate, hitTest }) {
  const canvasRef = useRef(null)
  const ctxRef = useRef(null)
  const animIdRef = useRef(null)
  const sizeRef = useRef({ width: 0, height: 0 })
  const seedRef = useRef(0)
  const drawTickRef = useRef(0)
  const frameRef = useRef(0)
  const lastMaskUpdateRef = useRef(0)

  const updateMaskCSS = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    try {
      const dataUrl = canvas.toDataURL('image/png')
      if (onMaskUpdate) onMaskUpdate(dataUrl)
    } catch (_) {
      // canvas tainted or unavailable
    }
  }, [onMaskUpdate])

  const resize = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const parent = canvas.parentElement
    if (!parent) return
    const rect = parent.getBoundingClientRect()
    const w = Math.round(rect.width)
    const h = Math.round(rect.height)
    if (w > 0 && h > 0 && (w !== sizeRef.current.width || h !== sizeRef.current.height)) {
      canvas.width = w
      canvas.height = h
      sizeRef.current = { width: w, height: h }
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, w, h)
      ctxRef.current = ctx
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    resize()

    const observer = new ResizeObserver(() => resize())
    observer.observe(canvas.parentElement)

    function animate() {
      const c = ctxRef.current
      if (c && sizeRef.current.width > 0) {
        fadeMask(c, sizeRef.current.width, sizeRef.current.height, frameRef.current)
        frameRef.current++

        const now = performance.now()
        if (now - lastMaskUpdateRef.current > MASK_UPDATE_INTERVAL) {
          lastMaskUpdateRef.current = now
          updateMaskCSS()
        }
      }
      animIdRef.current = requestAnimationFrame(animate)
    }
    animIdRef.current = requestAnimationFrame(animate)

    // 初始 mask
    setTimeout(() => updateMaskCSS(), 200)

    return () => {
      observer.disconnect()
      if (animIdRef.current) cancelAnimationFrame(animIdRef.current)
    }
  }, [resize, updateMaskCSS])

  const handlePointerMove = useCallback((e) => {
    const canvas = canvasRef.current
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const now = performance.now()
    if (now - drawTickRef.current < 40) return
    drawTickRef.current = now

    if (hitTest && !hitTest(e.clientX, e.clientY)) return

    const ctx = ctxRef.current
    if (!ctx) return
    drawMaskSpot(ctx, x, y, SPOT_RADIUS, seedRef.current++)
  }, [hitTest])

  return (
    <canvas
      ref={canvasRef}
      className="moss-mask-canvas"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'auto',
        cursor: 'crosshair',
        opacity: 0,
      }}
      onPointerMove={handlePointerMove}
    />
  )
}
