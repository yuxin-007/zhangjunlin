import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { ASSET_URLS, MODEL_URLS } from '../assetPaths'
import MossOverlay from './MossOverlay'
import MossCardCluster, { MOSS_CLUSTER_SETTINGS } from './MossCardCluster'

// ── Emergency toggle: set to false to isolate MossOverlay from branch rendering ──
const ENABLE_MOSS_OVERLAY = true

const PATCH_OVERRIDE = (() => {
  if (typeof window !== 'undefined') {
    const p = new URLSearchParams(window.location.search).get('patch')
    if (p === '0') return 'off'
    if (p === '1') return 'on'
  }
  return 'default'
})()

const DEFAULT_LAYOUT = {
  // Locked layout — tuned to match reference crop feel.
  // Upper half: clean for headline.  Lower half: two crossing trunks.
  // Both thick ends cropped outside the viewport edges.
  _version: '2026-05-14-T3-fixed',
  long: {
    url: MODEL_URLS.branchLong,
    targetWidthRatio: 1.15,
    positionRatio: { x: 0.07, y: -0.29, z: -1.00 },
    rotation: [0.03, -0.09, 0.31],
  },
  short: {
    url: MODEL_URLS.branchShort,
    targetWidthRatio: 0.58,
    positionRatio: { x: -0.25, y: -0.38, z: 0.24 },
    rotation: [0.04, -0.03, -0.11],
  },
}

const SHORT_PRESETS = {
  referenceA: {
    label: 'A: locked default',
    description: 'y=-0.38, front branch from left-lower edge',
    targetWidthRatio: 0.58,
    positionRatio: { x: -0.25, y: -0.38, z: 0.24 },
    rotation: [0.04, -0.03, -0.11],
  },
  referenceB: {
    label: 'B: steeper front branch',
    description: 'More 45-degree feeling; use if A is too flat',
    targetWidthRatio: 0.58,
    positionRatio: { x: -0.25, y: -0.38, z: 0.24 },
    rotation: [0.04, -0.03, 0.22],
  },
  referenceC: {
    label: 'C: more visible cross',
    description: 'Slightly larger and more inside the frame',
    targetWidthRatio: 0.64,
    positionRatio: { x: -0.20, y: -0.38, z: 0.22 },
    rotation: [0.04, -0.03, -0.11],
  },
  referenceD: {
    label: 'D: less dominant front',
    description: 'Smaller, still in front; use if short is too heavy',
    targetWidthRatio: 0.52,
    positionRatio: { x: -0.30, y: -0.38, z: 0.18 },
    rotation: [0.04, -0.03, -0.11],
  },
  referenceE: {
    label: 'E: lower crossing',
    description: 'Keeps short lower while still in front',
    targetWidthRatio: 0.58,
    positionRatio: { x: -0.25, y: -0.42, z: 0.24 },
    rotation: [0.04, -0.03, -0.11],
  },
}

// ── helpers ──────────────────────────────────────────────

function formatVec3(v) {
  if (!v) return 'none'
  return `${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)}`
}

function formatUv(uv) {
  if (!uv) return 'none'
  return `${uv.x.toFixed(3)}, ${uv.y.toFixed(3)}`
}

function prepareScene(scene) {
  const cloned = scene.clone(true)

  cloned.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true
      child.receiveShadow = true
      child.frustumCulled = false
      if (child.material) {
        child.material.side = THREE.FrontSide
        child.material.depthTest = true
        child.material.depthWrite = true
        child.material.needsUpdate = true
      }
    }
  })

  const box = new THREE.Box3().setFromObject(cloned)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())

  cloned.position.sub(center)

  // Detect branch local axis from bounding box longest dimension.
  // Fallback: X axis. Used for cylindrical moss band generation.
  let axisLocal = new THREE.Vector3(1, 0, 0)
  if (size.x >= size.y && size.x >= size.z) axisLocal.set(1, 0, 0)
  else if (size.y >= size.x && size.y >= size.z) axisLocal.set(0, 1, 0)
  else axisLocal.set(0, 0, 1)

  let meshCount = 0
  cloned.traverse((child) => {
    if (child.isMesh) meshCount += 1
  })

  return { cloned, size, center, meshCount, axisLocal }
}

// ── per-branch model ─────────────────────────────────────

function BranchModel({ name, config, onHit, onLeave, onModelInfo, onMossPaint, mossPoints, activeMossRef, debugMode }) {
  const { scene } = useGLTF(config.url)
  const { viewport } = useThree()
  const groupRef = useRef(null)

  const prepared = useMemo(() => prepareScene(scene), [scene])

  const safeWidth = Math.max(prepared.size.x, 0.0001)
  const scale = (viewport.width * config.targetWidthRatio) / safeWidth
  const position = [
    viewport.width * config.positionRatio.x,
    viewport.height * config.positionRatio.y,
    config.positionRatio.z ?? 0,
  ]

  useEffect(() => {
    onModelInfo((prev) => ({
      ...prev,
      [name]: {
        loaded: true,
        url: config.url,
        size: prepared.size,
        center: prepared.center,
        meshCount: prepared.meshCount,
        targetWidthRatio: config.targetWidthRatio,
        positionRatio: config.positionRatio,
        rotation: config.rotation,
        scale,
      },
    }))
  }, [config.positionRatio, config.rotation, config.targetWidthRatio, config.url, name, onModelInfo, prepared, scale])

  console.log(
    `[BranchModel:${name}] w=${config.targetWidthRatio.toFixed(2)} x=${config.positionRatio.x.toFixed(2)} y=${config.positionRatio.y.toFixed(2)} z=${config.positionRatio.z.toFixed(2)} rz=${config.rotation[2].toFixed(2)}`,
  )

  const handlePointerMove = useCallback(
    (e) => {
      e.stopPropagation()

      // Compute local point in mesh local space (matches shader vLocalPos = position)
      let localPoint = null
      let worldPoint = null
      let worldNormal = null
      if (e.point && e.object) {
        const lp = e.object.worldToLocal(e.point.clone())
        localPoint = { x: lp.x, y: lp.y, z: lp.z }
        worldPoint = { x: e.point.x, y: e.point.y, z: e.point.z }
        if (e.face && e.face.normal) {
          const nm = new THREE.Matrix3().getNormalMatrix(e.object.matrixWorld)
          const wn = e.face.normal.clone().applyMatrix3(nm).normalize()
          worldNormal = { x: wn.x, y: wn.y, z: wn.z }
        }
      }

      const hasUV = !!(e.uv && typeof e.uv.x === 'number')

      onHit({
        hit: true,
        branch: name,
        point: e.point ? e.point.clone() : null,
        uv: e.uv ? { x: e.uv.x, y: e.uv.y } : null,
        localPoint,
        hasUV,
        objectName: e.object?.name || '(unnamed)',
        faceIndex: e.faceIndex ?? null,
        distance: e.distance ?? null,
      })

      // Paint moss at local point
      if (localPoint && onMossPaint) {
        // Compute inverse of the hit mesh's world matrix so MossOverlay can convert
        // world-space band samples back to mesh-local space for the shader.
        const mwi = e.object.matrixWorld.clone().invert()
        const matrixWorldInverse = mwi.toArray()

        // Branch axis in world space: rotate local bbox axis by group rotation
        const branchAxisWorld = prepared.axisLocal.clone()
          .applyEuler(new THREE.Euler(config.rotation[0], config.rotation[1], config.rotation[2]))
          .normalize()

        // Branch center in world space (group position = bbox center since clone is centered)
        const branchCenterWorld = new THREE.Vector3()
        groupRef.current.getWorldPosition(branchCenterWorld)

        onMossPaint(name, localPoint, worldPoint, worldNormal, matrixWorldInverse, branchAxisWorld, branchCenterWorld)
      }
    },
    [name, onHit, onMossPaint],
  )

  const handlePointerOut = useCallback(
    (e) => {
      e.stopPropagation()
      onLeave()
      if (onMossPaint) onMossPaint(name, null, null, null, null, null, null)
    },
    [name, onLeave, onMossPaint],
  )

  return (
    <group
      ref={groupRef}
      name={`branch-${name}`}
      position={position}
      rotation={config.rotation}
      scale={scale}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerMove}
      onPointerOut={handlePointerOut}
      onPointerLeave={handlePointerOut}
    >
      <primitive object={prepared.cloned} />
      {ENABLE_MOSS_OVERLAY && (
        <MossOverlay
          branchName={name}
          scene={prepared.cloned}
          mossPoints={mossPoints}
          activeMossRef={activeMossRef}
          debugMode={debugMode}
        />
      )}
    </group>
  )
}

// ── 3D scene content ─────────────────────────────────────

function BranchModelLayer({ layout, onHit, onLeave, onModelInfo, onMossPaint, mossPointsMap, activeMossRef, debugMode, mossPatchTexture, onAlphaAnalysis, patchEnabled, patchMounted }) {
  return (
    <group>
      <ambientLight intensity={1.15} />
      <hemisphereLight args={['#ffffff', '#b8b2a8', 0.85]} />
      <directionalLight position={[4, 6, 7]} intensity={1.65} />
      <directionalLight position={[-5, 2, 3]} intensity={0.55} />

      <BranchModel
        name="long"
        config={layout.long}
        onHit={onHit}
        onLeave={onLeave}
        onModelInfo={onModelInfo}
        onMossPaint={onMossPaint}
        mossPoints={mossPointsMap.current.long}
        activeMossRef={activeMossRef}
        debugMode={debugMode}
      />
      <BranchModel
        name="short"
        config={layout.short}
        onHit={onHit}
        onLeave={onLeave}
        onModelInfo={onModelInfo}
        onMossPaint={onMossPaint}
        mossPoints={mossPointsMap.current.short}
        activeMossRef={activeMossRef}
        debugMode={debugMode}
      />

      {patchMounted && mossPatchTexture && (
        <MossCardCluster
          mossPointsMap={mossPointsMap}
          patchTexture={mossPatchTexture}
          enabled={patchEnabled}
          onAlphaAnalysis={onAlphaAnalysis}
        />
      )}
    </group>
  )
}

// ── raycast debug panel ──────────────────────────────────

function DebugPanel({ hitDebug, modelInfo, mossDebug, mossTexLoaded, mossPatchAlpha, patchEnabled, patchMounted }) {
  const longInfo = modelInfo?.long
  const shortInfo = modelInfo?.short
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 10,
        right: 10,
        zIndex: 9999,
        maxWidth: 420,
        background: 'rgba(0,0,0,0.85)',
        color: '#fff',
        fontFamily: 'monospace',
        fontSize: 11,
        padding: '8px 12px',
        borderRadius: 4,
        pointerEvents: 'none',
        lineHeight: 1.5,
      }}
    >
      <div style={{ marginBottom: 4, borderBottom: '1px solid #555', paddingBottom: 4 }}>
        <div>
          branch scene mounted:{' '}
          <span style={{ color: (longInfo?.loaded || shortInfo?.loaded) ? '#4f4' : '#f44' }}>
            {(longInfo?.loaded || shortInfo?.loaded) ? 'TRUE' : 'FALSE'}
          </span>
        </div>
        <div>
          long model visible:{' '}
          <span style={{ color: longInfo?.loaded ? '#4f4' : '#f44' }}>
            {longInfo?.loaded ? 'TRUE' : 'FALSE'}
          </span>
        </div>
        <div>
          short model visible:{' '}
          <span style={{ color: shortInfo?.loaded ? '#4f4' : '#f44' }}>
            {shortInfo?.loaded ? 'TRUE' : 'FALSE'}
          </span>
        </div>
        <div>
          moss overlay enabled:{' '}
          <span style={{ color: ENABLE_MOSS_OVERLAY ? '#4f4' : '#f84' }}>
            {ENABLE_MOSS_OVERLAY ? 'TRUE' : 'FALSE'}
          </span>
        </div>
        <div>
          moss texture loaded:{' '}
          <span style={{ color: mossTexLoaded ? '#4f4' : '#f84' }}>
            {mossTexLoaded ? 'TRUE' : 'FALSE'}
          </span>
        </div>
        <div>
          shader carpet base: alphaCore 0.68 | alphaEdge 0.05 | max 0.74
        </div>
        <div>
          tex scale: 10.0 | max points per branch: 120
        </div>
        <div style={{ marginTop: 2, borderTop: '1px solid #444', paddingTop: 2 }}>
          card cluster mounted:{' '}
          <span style={{ color: patchMounted ? '#4f4' : '#f84' }}>
            {patchMounted ? 'TRUE' : 'FALSE'}
          </span>
        </div>
        <div>
          card cluster enabled:{' '}
          <span style={{ color: patchEnabled ? '#4f4' : '#f84' }}>
            {patchEnabled ? 'TRUE' : 'FALSE'}
          </span>
        </div>
        <div>
          patch texture loaded:{' '}
          <span style={{ color: mossPatchAlpha ? '#4f4' : '#f84' }}>
            {mossPatchAlpha ? 'TRUE' : 'FALSE'}
          </span>
        </div>
        {mossPatchAlpha && (
          <>
            <div>
              patch alpha transparent ratio:{' '}
              {(mossPatchAlpha.transparentRatio * 100).toFixed(1)}%
            </div>
            <div>
              patch alpha opaque ratio:{' '}
              {(mossPatchAlpha.opaqueRatio * 100).toFixed(1)}%
            </div>
            <div>
              patch alpha semi-transparent ratio:{' '}
              {(mossPatchAlpha.semiTransparentRatio * 100).toFixed(1)}%
            </div>
            <div>
              patch alpha valid:{' '}
              <span style={{ color: mossPatchAlpha.hasRealAlpha ? '#4f4' : '#f44' }}>
                {mossPatchAlpha.hasRealAlpha ? 'TRUE' : 'FALSE'}
              </span>
            </div>
          </>
        )}
        {!mossPatchAlpha && (
          <div style={{ color: '#888' }}>patch alpha: not analyzed</div>
        )}
        <div>
          cards per cluster: {MOSS_CLUSTER_SETTINGS.CARDS_PER_CLUSTER} | base size: {MOSS_CLUSTER_SETTINGS.BASE_SIZE.toFixed(2)} | tiers: inner={MOSS_CLUSTER_SETTINGS.INNER_COUNT} mid={MOSS_CLUSTER_SETTINGS.MID_COUNT} outer={MOSS_CLUSTER_SETTINGS.OUTER_COUNT}
        </div>
        <div>
          carpet band mode: ON | localized band 0.42 len x 150° arc | {MOSS_CLUSTER_SETTINGS.CARDS_PER_CLUSTER} cards/point | max opacity: {MOSS_CLUSTER_SETTINGS.MAX_OPACITY.toFixed(2)}
        </div>
      </div>
      <div>
        3D hit:{' '}
        <span style={{ color: hitDebug?.hit ? '#4f4' : '#f44' }}>
          {hitDebug?.hit ? 'TRUE' : 'FALSE'}
        </span>
      </div>
      {hitDebug?.hit && (
        <>
          <div>branch: {hitDebug.branch}</div>
          <div>object: {hitDebug.objectName}</div>
          <div>
            hasUV:{' '}
            <span style={{ color: hitDebug.hasUV ? '#4f4' : '#f84' }}>
              {hitDebug.hasUV ? 'TRUE' : 'FALSE'}
            </span>
          </div>
          <div>uv: {formatUv(hitDebug.uv)}</div>
          <div>point (world): {formatVec3(hitDebug.point)}</div>
          <div>localPoint: {formatVec3(hitDebug.localPoint)}</div>
          <div>
            distance:{' '}
            {typeof hitDebug.distance === 'number'
              ? hitDebug.distance.toFixed(3)
              : 'none'}
          </div>
          <div>faceIndex: {hitDebug.faceIndex ?? 'N/A'}</div>
        </>
      )}

      {/* Moss debug */}
      {mossDebug && (
        <div style={{ marginTop: 6, borderTop: '1px solid #5a5', paddingTop: 4 }}>
          <div style={{ color: '#8f8' }}>active branch: {mossDebug.activeBranch || 'none'}</div>
          <div>active localPos: {formatVec3(mossDebug.lastLocalPos)}</div>
          <div>
            points: long {mossDebug.longCount ?? 0}/{mossDebug.maxPoints ?? 120} | short {mossDebug.shortCount ?? 0}/{mossDebug.maxPoints ?? 120}
          </div>
          {patchEnabled && (
            <>
              <div>
                total cards: {((mossDebug.longCount ?? 0) + (mossDebug.shortCount ?? 0)) * MOSS_CLUSTER_SETTINGS.CARDS_PER_CLUSTER} ({(mossDebug.longCount ?? 0) + (mossDebug.shortCount ?? 0)} points x {MOSS_CLUSTER_SETTINGS.CARDS_PER_CLUSTER})
              </div>
            </>
          )}
          <div style={{ color: '#ff0' }}>
            moss mode: {mossDebug.mossMode || 'cylindrical band carpet'}
          </div>
          <div>band: len {mossDebug.bandLength?.toFixed(2)} | arc {mossDebug.bandArcDeg ?? 150}°</div>
          <div>band samples: {mossDebug.lengthSamples ?? 7} len x {mossDebug.arcSamples ?? 5} arc</div>
          <div>branch axis (world): {mossDebug.branchAxis || 'none'}</div>
          <div>est. radius: {mossDebug.estimatedRadius || 'computed per-frame'}</div>
          <div>active keep radius: {mossDebug.activeKeepRadius ?? '0.22'}</div>
          <div>merge radius: {mossDebug.mergeRadius ?? '0.045'}</div>
          <div>decay mode: {mossDebug.decayMode || 'cylindrical band'}</div>
          <div>active strength: {mossDebug.activeStrength?.toFixed(3) ?? '0.000'}</div>
          <div>decay state: {mossDebug.decaying ? 'YES' : 'no'}</div>
          <div>route: {mossDebug.route || 'cylindrical band samples'}</div>
        </div>
      )}

      {Object.entries(modelInfo || {}).map(([name, info]) => (
        <div
          key={name}
          style={{
            marginTop: 6,
            borderTop: '1px solid #555',
            paddingTop: 4,
          }}
        >
          <div>
            model {name}:{' '}
            <span style={{ color: info.loaded ? '#4f4' : '#f44' }}>
              {info.loaded ? 'YES' : 'NO'}
            </span>
          </div>
          <div>meshes: {info.meshCount}</div>
          <div>size: {formatVec3(info.size)}</div>
          <div>center: {formatVec3(info.center)}</div>
          <div>scale: {info.scale.toFixed(4)}</div>
          <div>
            layout: w={info.targetWidthRatio}, x={info.positionRatio.x}, y={info.positionRatio.y}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── layout tuning panel ──────────────────────────────────

const PANEL_STYLE = {
  position: 'absolute',
  right: 10,
  top: 10,
  zIndex: 9998,
  width: 310,
  maxHeight: 'calc(100vh - 60px)',
  overflowY: 'auto',
  background: 'rgba(0,0,0,0.88)',
  color: '#eee',
  fontFamily: 'monospace',
  fontSize: 11,
  padding: '12px 14px',
  borderRadius: 6,
  lineHeight: 1.6,
}

const SLIDER_ROW_STYLE = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginBottom: 4,
}

const LABEL_STYLE = { flex: '0 0 120px', textAlign: 'right' }
const VALUE_STYLE = { flex: '0 0 52px', textAlign: 'right' }

function SliderRow({ label, value, min, max, step, onChange }) {
  return (
    <div style={SLIDER_ROW_STYLE}>
      <span style={LABEL_STYLE}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{ flex: '1 1 auto' }}
      />
      <span style={VALUE_STYLE}>{value.toFixed(2)}</span>
    </div>
  )
}

function LayoutPanel({ layout, onChange, onReset, presets, onApplyPreset, activePreset }) {
  const [copied, setCopied] = useState(false)

  function updateLong(key, subKey, value) {
    onChange((prev) => {
      const long = { ...prev.long }
      if (key === 'rotation') {
        long.rotation = [...long.rotation]
        long.rotation[subKey] = value
      } else if (subKey != null) {
        long[key] = { ...long[key], [subKey]: value }
      } else {
        long[key] = value
      }
      return { ...prev, long }
    })
  }

  function updateShort(key, subKey, value) {
    onChange((prev) => {
      const short = { ...prev.short }
      if (key === 'rotation') {
        short.rotation = [...short.rotation]
        short.rotation[subKey] = value
      } else if (subKey != null) {
        short[key] = { ...short[key], [subKey]: value }
      } else {
        short[key] = value
      }
      return { ...prev, short }
    })
  }

  function buildJson() {
    return {
      long: {
        targetWidthRatio: layout.long.targetWidthRatio,
        positionRatio: { ...layout.long.positionRatio },
        rotation: [...layout.long.rotation],
      },
      short: {
        targetWidthRatio: layout.short.targetWidthRatio,
        positionRatio: { ...layout.short.positionRatio },
        rotation: [...layout.short.rotation],
      },
    }
  }

  const jsonText = JSON.stringify(buildJson(), null, 2)

  function copyJson() {
    navigator.clipboard.writeText(jsonText).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500) },
      () => alert('Failed to copy'),
    )
  }

  return (
    <div style={PANEL_STYLE}>
      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
        Layout Tuning
      </div>
      <div style={{ fontSize: 10, color: '#aaa', marginBottom: 4 }}>
        actual v={layout._version || '?'}: long w={layout.long.targetWidthRatio.toFixed(2)} x={layout.long.positionRatio.x.toFixed(2)} y={layout.long.positionRatio.y.toFixed(2)} z={layout.long.positionRatio.z.toFixed(2)} rz={layout.long.rotation[2].toFixed(2)} | short w={layout.short.targetWidthRatio.toFixed(2)} x={layout.short.positionRatio.x.toFixed(2)} y={layout.short.positionRatio.y.toFixed(2)} z={layout.short.positionRatio.z.toFixed(2)} rz={layout.short.rotation[2].toFixed(2)}
      </div>
      <button
        onClick={onReset}
        style={{
          marginBottom: 8,
          padding: '3px 8px',
          fontSize: 11,
          fontFamily: 'monospace',
          background: '#833',
          color: '#fff',
          border: '1px solid #a55',
          borderRadius: 3,
          cursor: 'pointer',
        }}
      >
        Reset to default
      </button>

      {presets && (
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 11, marginBottom: 4 }}>Short Presets</div>
          {Object.entries(presets).map(([key, preset]) => {
            const isActive = activePreset === key
            return (
              <button
                key={key}
                onClick={() => onApplyPreset(key)}
                title={preset.description}
                style={{
                  display: 'block',
                  width: '100%',
                  marginBottom: 3,
                  padding: '4px 8px',
                  fontSize: 10,
                  fontFamily: 'monospace',
                  textAlign: 'left',
                  background: isActive ? '#285' : '#333',
                  color: isActive ? '#fff' : '#aaa',
                  border: isActive ? '1px solid #4a4' : '1px solid #555',
                  borderRadius: 3,
                  cursor: 'pointer',
                }}
              >
                {preset.label}
              </button>
            )
          })}
        </div>
      )}

      <details open>
        <summary style={{ fontWeight: 700, cursor: 'pointer', marginBottom: 4 }}>
          long (main branch)
        </summary>
        <SliderRow label="targetWidthRatio" value={layout.long.targetWidthRatio} min={0.70} max={1.80} step={0.01} onChange={(v) => updateLong('targetWidthRatio', null, v)} />
        <SliderRow label="positionRatio.x" value={layout.long.positionRatio.x} min={-0.80} max={0.40} step={0.01} onChange={(v) => updateLong('positionRatio', 'x', v)} />
        <SliderRow label="positionRatio.y" value={layout.long.positionRatio.y} min={-0.80} max={0.10} step={0.01} onChange={(v) => updateLong('positionRatio', 'y', v)} />
        <SliderRow label="zOffset" value={layout.long.positionRatio.z} min={-1.00} max={1.00} step={0.01} onChange={(v) => updateLong('positionRatio', 'z', v)} />
        <SliderRow label="rotation.x" value={layout.long.rotation[0]} min={-1.00} max={1.00} step={0.01} onChange={(v) => updateLong('rotation', 0, v)} />
        <SliderRow label="rotation.y" value={layout.long.rotation[1]} min={-1.00} max={1.00} step={0.01} onChange={(v) => updateLong('rotation', 1, v)} />
        <SliderRow label="rotation.z" value={layout.long.rotation[2]} min={-1.50} max={1.50} step={0.01} onChange={(v) => updateLong('rotation', 2, v)} />
      </details>

      <details open>
        <summary style={{ fontWeight: 700, cursor: 'pointer', marginBottom: 4, marginTop: 8 }}>
          short (cross branch)
        </summary>
        <SliderRow label="targetWidthRatio" value={layout.short.targetWidthRatio} min={0.30} max={1.40} step={0.01} onChange={(v) => updateShort('targetWidthRatio', null, v)} />
        <SliderRow label="positionRatio.x" value={layout.short.positionRatio.x} min={-1.00} max={0.20} step={0.01} onChange={(v) => updateShort('positionRatio', 'x', v)} />
        <SliderRow label="positionRatio.y" value={layout.short.positionRatio.y} min={-0.90} max={0.10} step={0.01} onChange={(v) => updateShort('positionRatio', 'y', v)} />
        <SliderRow label="zOffset" value={layout.short.positionRatio.z} min={-1.00} max={1.00} step={0.01} onChange={(v) => updateShort('positionRatio', 'z', v)} />
        <SliderRow label="rotation.x" value={layout.short.rotation[0]} min={-1.00} max={1.00} step={0.01} onChange={(v) => updateShort('rotation', 0, v)} />
        <SliderRow label="rotation.y" value={layout.short.rotation[1]} min={-1.00} max={1.00} step={0.01} onChange={(v) => updateShort('rotation', 1, v)} />
        <SliderRow label="rotation.z" value={layout.short.rotation[2]} min={-2.00} max={1.00} step={0.01} onChange={(v) => updateShort('rotation', 2, v)} />
      </details>

      <details>
        <summary style={{ fontWeight: 700, cursor: 'pointer', marginBottom: 4, marginTop: 8 }}>
          Current JSON
        </summary>
        <pre style={{ background: '#111', padding: 8, borderRadius: 4, fontSize: 10, overflowX: 'auto', maxHeight: 240 }}>{jsonText}</pre>
        <button
          onClick={copyJson}
          style={{
            marginTop: 4,
            padding: '4px 10px',
            fontSize: 11,
            fontFamily: 'monospace',
            background: copied ? '#3a3' : '#444',
            color: '#fff',
            border: '1px solid #666',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          {copied ? 'Copied!' : 'Copy layout JSON'}
        </button>
      </details>
    </div>
  )
}

// ── main scene wrapper ───────────────────────────────────

export default function BranchModelScene({ debugMode }) {
  const [liveLayout, setLiveLayout] = useState(DEFAULT_LAYOUT)
  const [hitDebug, setHitDebug] = useState({ hit: false })
  const [modelInfo, setModelInfo] = useState({})
  const [activePreset, setActivePreset] = useState('referenceA')
  const [mossTex, setMossTex] = useState(null)
  const [mossPatchTex, setMossPatchTex] = useState(null)
  const [mossPatchAlpha, setMossPatchAlpha] = useState(null)
  const [patchAlphaValid, setPatchAlphaValid] = useState(false)
  const [mossDebug, setMossDebug] = useState(null)

  // Mount the patch overlay as soon as the texture is loaded so it can run alpha analysis.
  // Enable rendering only after alpha analysis passes (or when forced on by ?patch=1).
  const patchMounted = PATCH_OVERRIDE !== 'off' && !!mossPatchTex
  const patchEnabled =
    PATCH_OVERRIDE === 'on' ? patchAlphaValid :
    PATCH_OVERRIDE === 'off' ? false :
    patchAlphaValid

  // per-branch moss points — written by pointer events, decayed in MossOverlay useFrame
  const mossPointsMap = useRef({
    long: [],
    short: [],
  })
  const activeMossRef = useRef({ branch: null, localPos: null, lastPaint: 0 })

  // Load moss texture via vanilla Three (no R3F context needed here)
  useEffect(() => {
    const loader = new THREE.TextureLoader()
    loader.load(
      ASSET_URLS.mossTexture,
      (tex) => {
        tex.wrapS = THREE.RepeatWrapping
        tex.wrapT = THREE.RepeatWrapping
        tex.colorSpace = THREE.SRGBColorSpace
        setMossTex(tex)
      },
      undefined,
      () => console.warn('[moss] failed to load moss texture')
    )
  }, [])

  useEffect(() => {
    const loader = new THREE.TextureLoader()
    const applyTexture = (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace
      tex.minFilter = THREE.LinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.generateMipmaps = false
      tex.needsUpdate = true
      setMossPatchTex(tex)
    }

    loader.load(
      ASSET_URLS.mossPatchClean || ASSET_URLS.mossPatchBase,
      applyTexture,
      undefined,
      () => {
        console.warn('[moss patch] failed to load moss-patch-clean.png, falling back to moss-patch-base.png')
        loader.load(
          ASSET_URLS.mossPatchBase,
          applyTexture,
          undefined,
          () => console.warn('[moss patch] failed to load moss patch texture')
        )
      }
    )
  }, [])

  const showLayout = useMemo(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).has('layout')
  }, [])

  useEffect(() => {
    setLiveLayout(DEFAULT_LAYOUT)
    setActivePreset('referenceA')
  }, [DEFAULT_LAYOUT._version])

  const handleApplyPreset = useCallback((presetKey) => {
    const preset = SHORT_PRESETS[presetKey]
    if (!preset) return
    setActivePreset(presetKey)
    setLiveLayout((prev) => ({
      ...prev,
      short: {
        ...prev.short,
        targetWidthRatio: preset.targetWidthRatio,
        positionRatio: { ...preset.positionRatio },
        rotation: [...preset.rotation],
      },
    }))
  }, [])

  const layout = showLayout ? liveLayout : DEFAULT_LAYOUT

  const onHit = useCallback((info) => setHitDebug(info), [])
  const onLeave = useCallback(() => setHitDebug({ hit: false }), [])

  const onAlphaAnalysis = useCallback((result) => {
    setMossPatchAlpha(result)
    setPatchAlphaValid(!!result.hasRealAlpha)
  }, [])

  // ── moss paint callback ──────────────────────────────────
  const onMossPaint = useCallback((branch, localPos, worldPos, worldNormal, matrixWorldInverse, branchAxisWorld, branchCenterWorld) => {
    if (!localPos) {
      activeMossRef.current = { branch: null, localPos: null, worldPos: null, worldNormal: null, matrixWorldInverse: null, branchAxisWorld: null, branchCenterWorld: null, lastPaint: 0 }
      setMossDebug((prev) => prev ? { ...prev, activeBranch: null, decayMode: 'all-fast', decaying: true } : null)
      return
    }
    activeMossRef.current = {
      branch,
      localPos: { x: localPos.x, y: localPos.y, z: localPos.z },
      worldPos: worldPos ? { x: worldPos.x, y: worldPos.y, z: worldPos.z } : null,
      worldNormal: worldNormal ? { x: worldNormal.x, y: worldNormal.y, z: worldNormal.z } : null,
      matrixWorldInverse: matrixWorldInverse || null,
      branchAxisWorld: branchAxisWorld ? { x: branchAxisWorld.x, y: branchAxisWorld.y, z: branchAxisWorld.z } : null,
      branchCenterWorld: branchCenterWorld ? { x: branchCenterWorld.x, y: branchCenterWorld.y, z: branchCenterWorld.z } : null,
      lastPaint: performance.now(),
    }
    if (debugMode) {
      setMossDebug({
        activeBranch: branch,
        lastLocalPos: localPos,
        longCount: mossPointsMap.current.long.length,
        shortCount: mossPointsMap.current.short.length,
        activeStrength: 0.85,
        decayMode: 'cylindrical band (per-point: near-active slow, far: fast)',
        decaying: false,
        route: 'cylindrical band samples + path interpolation',
        activeKeepRadius: 0.22,
        mergeRadius: 0.045,
        mossMode: 'localized cylindrical band carpet',
        bandLength: 0.42,
        bandArcDeg: 150,
        lengthSamples: 7,
        arcSamples: 5,
        branchAxis: branchAxisWorld ? formatVec3(branchAxisWorld) : 'none',
        estimatedRadius: 'computed per-frame',
        maxPoints: 120,
      })
    }
  }, [debugMode])

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        orthographic
        camera={{ position: [0, 0, 10], zoom: 90, near: -100, far: 100 }}
        gl={{ alpha: true, premultipliedAlpha: true, antialias: true }}
      >
        <Suspense key={DEFAULT_LAYOUT._version} fallback={null}>
          <BranchModelLayer
            layout={layout}
            onHit={onHit}
            onLeave={onLeave}
            onModelInfo={setModelInfo}
            onMossPaint={onMossPaint}
            mossPointsMap={mossPointsMap}
            activeMossRef={activeMossRef}
            debugMode={debugMode}
            mossPatchTexture={mossPatchTex}
            onAlphaAnalysis={onAlphaAnalysis}
            patchEnabled={patchEnabled}
            patchMounted={patchMounted}
          />
        </Suspense>
      </Canvas>

      {debugMode && <DebugPanel hitDebug={hitDebug} modelInfo={modelInfo} mossDebug={mossDebug} mossTexLoaded={!!mossTex} mossPatchAlpha={mossPatchAlpha} patchEnabled={patchEnabled} patchMounted={patchMounted} />}
      {showLayout && (
        <LayoutPanel
          layout={layout}
          onChange={setLiveLayout}
          onReset={() => { setLiveLayout(DEFAULT_LAYOUT); setActivePreset('referenceA') }}
          presets={SHORT_PRESETS}
          onApplyPreset={handleApplyPreset}
          activePreset={activePreset}
        />
      )}
    </div>
  )
}

useGLTF.preload(MODEL_URLS.branchLong)
useGLTF.preload(MODEL_URLS.branchShort)
