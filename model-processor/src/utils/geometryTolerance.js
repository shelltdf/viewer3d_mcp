/**
 * @param {Float32Array | Float64Array} a
 * @param {Float32Array | Float64Array} b
 * @param {number} absEps
 * @param {number} relEps
 */
function floatArraysClose(a, b, absEps, relEps) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const u = a[i]
    const v = b[i]
    if (u === v) continue
    const d = Math.abs(u - v)
    const tol = absEps + relEps * Math.max(Math.abs(u), Math.abs(v))
    if (d > tol) return false
  }
  return true
}

function intArraysEqual(a, b) {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * 用 getComponent 逐分量比对，兼容 Float / normalized 整数及 InterleavedBufferAttribute。
 * @param {import('three').BufferAttribute | import('three').InterleavedBufferAttribute} a
 * @param {import('three').BufferAttribute | import('three').InterleavedBufferAttribute} b
 * @param {number} absEps
 * @param {number} relEps
 */
function bufferAttributeClose(a, b, absEps, relEps) {
  if (!a || !b) return a === b
  if (a.count !== b.count || a.itemSize !== b.itemSize || a.normalized !== b.normalized) return false
  for (let i = 0; i < a.count; i++) {
    for (let c = 0; c < a.itemSize; c++) {
      const u = a.getComponent(i, c)
      const v = b.getComponent(i, c)
      if (typeof u === 'number' && typeof v === 'number' && Number.isFinite(u) && Number.isFinite(v)) {
        if (u === v) continue
        const d = Math.abs(u - v)
        const tol = absEps + relEps * Math.max(Math.abs(u), Math.abs(v))
        if (d > tol) return false
      } else if (u !== v) {
        return false
      }
    }
  }
  return true
}

function morphAttributesClose(ma, mb, absEps, relEps) {
  const ka = Object.keys(ma || {}).sort()
  const kb = Object.keys(mb || {}).sort()
  if (ka.length !== kb.length) return false
  for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false
  for (const name of ka) {
    const aa = ma[name]
    const bb = mb[name]
    if (!aa || !bb || aa.length !== bb.length) return false
    for (let j = 0; j < aa.length; j++) {
      if (!bufferAttributeClose(aa[j], bb[j], absEps, relEps)) return false
    }
  }
  return true
}

/**
 * 几何结构签名（布局一致才可做容差数值比对）：属性名、数量、类型、索引拓扑等。
 * @param {import('three').BufferGeometry} geo
 */
export function geometryStructuralSignature(geo) {
  if (!geo?.isBufferGeometry) return 'invalid'
  const parts = []
  if (geo.index) {
    const ix = geo.index
    parts.push(
      `ix:${ix.count}:${ix.itemSize}:${ix.normalized ? 1 : 0}:${ix.array?.constructor?.name || '?'}`,
    )
  } else parts.push('ix:null')
  for (const n of Object.keys(geo.attributes).sort()) {
    const a = geo.attributes[n]
    parts.push(
      `a:${n}:${a.count}:${a.itemSize}:${a.normalized ? 1 : 0}:${a.array?.constructor?.name || '?'}`,
    )
  }
  if (geo.morphAttributes && Object.keys(geo.morphAttributes).length) {
    for (const name of Object.keys(geo.morphAttributes).sort()) {
      const arr = geo.morphAttributes[name]
      parts.push(`m:${name}:${arr.length}:${arr.map((x) => x.count).join(',')}`)
    }
  } else parts.push('m:null')
  if (geo.groups?.length) {
    parts.push(
      `g:${geo.groups.map((x) => `${x.start}/${x.count}/${x.materialIndex ?? 0}`).join(';')}`,
    )
  } else parts.push('g:null')
  const dr = geo.drawRange
  if (dr && (dr.start !== 0 || dr.count !== Infinity)) {
    parts.push(`dr:${dr.start},${dr.count}`)
  } else parts.push('dr:full')
  return parts.join('|')
}

/**
 * 两.geometry 在「结构相同」前提下，对所有属性数组做容差比对（浮点一对一带相对容差）。
 * @param {import('three').BufferGeometry} ga
 * @param {import('three').BufferGeometry} gb
 * @param {number} [absEps=1e-4]
 * @param {number} [relEps=1e-4]
 */
export function bufferGeometriesApproxEqual(ga, gb, absEps = 1e-4, relEps = 1e-4) {
  if (!ga?.isBufferGeometry || !gb?.isBufferGeometry) return false
  if (ga.index && gb.index) {
    if (!bufferAttributeClose(ga.index, gb.index, absEps, relEps)) return false
  } else if (ga.index || gb.index) return false

  const namesA = Object.keys(ga.attributes).sort()
  const namesB = Object.keys(gb.attributes).sort()
  if (namesA.length !== namesB.length) return false
  for (let i = 0; i < namesA.length; i++) if (namesA[i] !== namesB[i]) return false
  for (const n of namesA) {
    if (!bufferAttributeClose(ga.attributes[n], gb.attributes[n], absEps, relEps)) return false
  }
  if (!morphAttributesClose(ga.morphAttributes, gb.morphAttributes, absEps, relEps)) return false
  const gaG = ga.groups
  const gbG = gb.groups
  if ((gaG?.length || 0) !== (gbG?.length || 0)) return false
  if (gaG?.length) {
    for (let i = 0; i < gaG.length; i++) {
      const u = gaG[i]
      const v = gbG[i]
      if (u.start !== v.start || u.count !== v.count || (u.materialIndex ?? 0) !== (v.materialIndex ?? 0))
        return false
    }
  }
  const dra = ga.drawRange
  const drb = gb.drawRange
  const aFull = !dra || (dra.start === 0 && dra.count === Infinity)
  const bFull = !drb || (drb.start === 0 && drb.count === Infinity)
  if (aFull !== bFull) return false
  if (!aFull && dra && drb) {
    if (dra.start !== drb.start || dra.count !== drb.count) return false
  }
  return true
}

/**
 * @param {{ uuid: string, label: string, object: import('three').Object3D }[]} items
 * @param {number} absEps
 * @param {number} relEps
 * @returns {typeof items[]}
 */
export function clusterMeshesByGeometryTolerance(items, absEps = 1e-4, relEps = 1e-4) {
  const n = items.length
  if (n < 2) return []
  const parent = Array.from({ length: n }, (_, i) => i)
  function find(i) {
    return parent[i] === i ? i : (parent[i] = find(parent[i]))
  }
  function union(i, j) {
    const pi = find(i)
    const pj = find(j)
    if (pi !== pj) parent[pj] = pi
  }
  for (let i = 0; i < n; i++) {
    const gi = items[i].object.geometry
    for (let j = i + 1; j < n; j++) {
      const gj = items[j].object.geometry
      if (bufferGeometriesApproxEqual(gi, gj, absEps, relEps)) union(i, j)
    }
  }
  const clusters = new Map()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    if (!clusters.has(r)) clusters.set(r, [])
    clusters.get(r).push(items[i])
  }
  return [...clusters.values()].filter((c) => c.length >= 2)
}
