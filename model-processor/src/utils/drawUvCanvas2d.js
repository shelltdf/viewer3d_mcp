/**
 * 在 2D canvas 上绘制 UV 三角网格线框（索引或非索引）。
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} w
 * @param {number} h
 * @param {import('three').BufferGeometry} geometry
 * @param {string} uvKey
 * @param {{ scale: number, ox: number, oy: number }} view  UV→像素：px = u*scale+ox, py = v*scale+oy（Y 向下）
 */
export function drawUvCanvas2d(ctx, w, h, geometry, uvKey, view) {
  ctx.fillStyle = '#141820'
  ctx.fillRect(0, 0, w, h)
  const uv = geometry.getAttribute(uvKey)
  const pos = geometry.getAttribute('position')
  if (!uv || !pos || uv.itemSize < 2) {
    ctx.fillStyle = '#8e97a6'
    ctx.font = '12px sans-serif'
    ctx.fillText('无可显示的 UV 属性', 12, 24)
    return
  }

  const { scale, ox, oy } = view
  const idx = geometry.index
  /** @type {number} */
  let i0 = 0
  /** @type {number} */
  let nTris = 0
  if (idx) {
    const dr = geometry.drawRange
    const start = dr?.start ?? 0
    const count = dr?.count ?? idx.count
    i0 = start
    nTris = Math.floor(count / 3)
  } else {
    const dr = geometry.drawRange
    const start = dr ? dr.start : 0
    const vc = pos.count
    const count = dr ? Math.min(dr.count, vc - start) : vc - start
    nTris = Math.floor(count / 3)
    i0 = start
  }

  function toPx(u, v) {
    return [u * scale + ox, h - (v * scale + oy)]
  }

  ctx.strokeStyle = 'rgba(107, 207, 255, 0.85)'
  ctx.lineWidth = 1
  ctx.beginPath()

  if (idx) {
    for (let t = 0; t < nTris; t++) {
      const a = idx.getX(i0 + t * 3)
      const b = idx.getX(i0 + t * 3 + 1)
      const c = idx.getX(i0 + t * 3 + 2)
      const verts = [a, b, c, a]
      for (let k = 0; k < 3; k++) {
        const vi = verts[k]
        const vj = verts[k + 1]
        const [x1, y1] = toPx(uv.getX(vi), uv.getY(vi))
        const [x2, y2] = toPx(uv.getX(vj), uv.getY(vj))
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
      }
    }
  } else {
    for (let t = 0; t < nTris; t++) {
      const a = i0 + t * 3
      const b = a + 1
      const c = a + 2
      const verts = [a, b, c, a]
      for (let k = 0; k < 3; k++) {
        const vi = verts[k]
        const vj = verts[k + 1]
        const [x1, y1] = toPx(uv.getX(vi), uv.getY(vi))
        const [x2, y2] = toPx(uv.getX(vj), uv.getY(vj))
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
      }
    }
  }

  ctx.stroke()

  ctx.strokeStyle = 'rgba(90, 90, 110, 0.5)'
  ctx.lineWidth = 0.5
  const grid = 8
  for (let i = 0; i <= grid; i++) {
    const u = i / grid
    const [x1, y1] = toPx(u, 0)
    const [x2, y2] = toPx(u, 1)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    const [xa, ya] = toPx(0, u)
    const [xb, yb] = toPx(1, u)
    ctx.beginPath()
    ctx.moveTo(xa, ya)
    ctx.lineTo(xb, yb)
    ctx.stroke()
  }
}

/**
 * @param {number} w
 * @param {number} h
 * @param {import('three').BufferGeometry} geometry
 * @param {string} uvKey
 * @returns {{ scale: number, ox: number, oy: number, umin: number, vmin: number, umax: number, vmax: number }}
 */
export function fitUvViewToCanvas(w, h, geometry, uvKey) {
  const uv = geometry.getAttribute(uvKey)
  if (!uv?.count) {
    return { scale: Math.min(w, h) * 0.88, ox: w * 0.06, oy: h * 0.06, umin: 0, vmin: 0, umax: 1, vmax: 1 }
  }
  let umin = Infinity
  let vmin = Infinity
  let umax = -Infinity
  let vmax = -Infinity
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i)
    const v = uv.getY(i)
    if (!Number.isFinite(u) || !Number.isFinite(v)) continue
    umin = Math.min(umin, u)
    umax = Math.max(umax, u)
    vmin = Math.min(vmin, v)
    vmax = Math.max(vmax, v)
  }
  if (!Number.isFinite(umin)) {
    return { scale: Math.min(w, h) * 0.88, ox: w * 0.06, oy: h * 0.06, umin: 0, vmin: 0, umax: 1, vmax: 1 }
  }
  const du = Math.max(umax - umin, 1e-4)
  const dv = Math.max(vmax - vmin, 1e-4)
  const pad = 0.08
  const uw = du * (1 + 2 * pad)
  const vh = dv * (1 + 2 * pad)
  const scale = Math.min(w / uw, h / vh)
  const cx = (umin + umax) / 2
  const cy = (vmin + vmax) / 2
  const ox = w / 2 - cx * scale
  const oy = h / 2 - cy * scale
  return { scale, ox, oy, umin, vmin, umax, vmax }
}

/**
 * @param {number} px
 * @param {number} py
 * @param {number} w
 * @param {number} h
 * @param {{ scale: number, ox: number, oy: number }} view
 * @returns {[number, number]} UV
 */
export function canvasPixelToUv(px, py, w, h, view) {
  const { scale, ox, oy } = view
  const u = (px - ox) / scale
  const v = (h - py - oy) / scale
  return [u, v]
}

/**
 * @param {import('three').BufferGeometry} geometry
 * @param {string} uvKey
 * @param {number} u
 * @param {number} v
 * @param {number} maxDistUv
 * @returns {number} 顶点索引，找不到为 -1
 */
export function pickNearestUvVertex(geometry, uvKey, u, v, maxDistUv) {
  const uv = geometry.getAttribute(uvKey)
  if (!uv) return null
  let best = -1
  let bestD = maxDistUv * maxDistUv
  for (let i = 0; i < uv.count; i++) {
    const du = uv.getX(i) - u
    const dv = uv.getY(i) - v
    const d = du * du + dv * dv
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}
