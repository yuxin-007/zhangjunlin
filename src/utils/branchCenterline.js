const BRANCH_CENTERLINE = [
  [0.02, 0.76],
  [0.10, 0.70],
  [0.22, 0.62],
  [0.35, 0.53],
  [0.49, 0.43],
  [0.64, 0.32],
  [0.80, 0.21],
  [0.96, 0.10],
]

export function projectUvToCenterline(uv) {
  let bestDist = Infinity
  let bestResult = null

  let totalLength = 0
  const segmentLengths = []
  for (let i = 0; i < BRANCH_CENTERLINE.length - 1; i++) {
    const p0 = BRANCH_CENTERLINE[i]
    const p1 = BRANCH_CENTERLINE[i + 1]
    const dx = p1[0] - p0[0]
    const dy = p1[1] - p0[1]
    const len = Math.sqrt(dx * dx + dy * dy)
    segmentLengths.push(len)
    totalLength += len
  }

  let accumulatedLength = 0

  for (let i = 0; i < BRANCH_CENTERLINE.length - 1; i++) {
    const p0 = BRANCH_CENTERLINE[i]
    const p1 = BRANCH_CENTERLINE[i + 1]
    const dx = p1[0] - p0[0]
    const dy = p1[1] - p0[1]
    const segLen = segmentLengths[i]

    const vx = uv.x - p0[0]
    const vy = uv.y - p0[1]

    let t = (vx * dx + vy * dy) / (segLen * segLen)
    t = Math.max(0, Math.min(1, t))

    const closestX = p0[0] + t * dx
    const closestY = p0[1] + t * dy

    const distX = uv.x - closestX
    const distY = uv.y - closestY
    const dist = Math.sqrt(distX * distX + distY * distY)

    if (dist < bestDist) {
      bestDist = dist

      const mag = segLen || 0.001
      const tx = dx / mag
      const ty = dy / mag

      const nx = -ty
      const ny = tx

      const s = totalLength > 0 ? (accumulatedLength + t * segLen) / totalLength : 0

      bestResult = {
        projectedUv: { x: closestX, y: closestY },
        tangent: [tx, ty],
        normal: [nx, ny],
        s,
        distanceToCenter: dist,
      }
    }

    accumulatedLength += segLen
  }

  return bestResult
}
