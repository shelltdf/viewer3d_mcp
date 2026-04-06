import * as THREE from 'three'
import { MeshoptSimplifier } from 'meshoptimizer/simplifier'

let _readyChain = null

export function meshoptSimplifierReady() {
  if (!_readyChain) _readyChain = MeshoptSimplifier.ready.then(() => undefined)
  return _readyChain
}

export function isMeshoptSimplifySupported() {
  return MeshoptSimplifier.supported === true
}

function maxIndexValue(arr) {
  let m = 0
  for (let i = 0; i < arr.length; i++) if (arr[i] > m) m = arr[i]
  return m
}

const REMOVED_VTX = 0xffffffff

/**
 * meshoptimizer compactMesh：去掉未被索引引用的顶点，并重映射所有顶点属性。
 * @returns {{ verticesBefore: number, verticesAfter: number, skipped?: string }}
 */
export function applyMeshoptVertexCompact(geometry) {
  const idx = geometry.index
  if (!idx) {
    return {
      verticesBefore: geometry.attributes.position.count,
      verticesAfter: geometry.attributes.position.count,
      skipped: 'no_index',
    }
  }

  const ia = idx.array
  const indices = ia instanceof Uint32Array ? new Uint32Array(ia) : new Uint32Array(ia)
  const pos = geometry.attributes.position
  const oldCount = pos.count
  const maxRef = maxIndexValue(indices) + 1
  if (maxRef > oldCount) {
    throw new Error('索引引用超出 position 顶点数')
  }

  const [remap, unique] = MeshoptSimplifier.compactMesh(indices)

  for (const name of Object.keys(geometry.attributes)) {
    const attr = geometry.attributes[name]
    const itemSize = attr.itemSize
    const oldArr = attr.array
    const Ctor = oldArr.constructor
    const newArr = new Ctor(unique * itemSize)
    for (let i = 0; i < remap.length; i++) {
      const r = remap[i]
      if (r === REMOVED_VTX) continue
      for (let k = 0; k < itemSize; k++) {
        newArr[r * itemSize + k] = oldArr[i * itemSize + k]
      }
    }
    geometry.setAttribute(name, new THREE.BufferAttribute(newArr, itemSize, attr.normalized))
  }

  let outIdx = /** @type {Uint16Array | Uint32Array} */ (indices)
  if (ia instanceof Uint16Array && maxIndexValue(indices) < 65536) {
    outIdx = new Uint16Array(indices.length)
    outIdx.set(indices)
  }
  geometry.setIndex(new THREE.BufferAttribute(outIdx, 1))
  geometry.clearGroups()

  return { verticesBefore: oldCount, verticesAfter: unique }
}

/**
 * @param {THREE.BufferGeometry} geometry
 * @param {{
 *   targetMode?: 'tri_ratio' | 'tri_count' | 'vert_ratio' | 'vert_count',
 *   ratio?: number,
 *   targetTriangleCount?: number,
 *   targetVertexRatio?: number,
 *   targetVertexCount?: number,
 *   compactVertices?: boolean,
 *   algorithm: string,
 *   lockBorder: boolean,
 * }} opts
 */
export async function applyMeshoptSimplifyToGeometry(geometry, opts) {
  await meshoptSimplifierReady()
  if (!MeshoptSimplifier.supported) {
    throw new Error('MeshoptSimplifier 不可用（需要支持 WebAssembly 的浏览器）')
  }

  /** @type {'tri_ratio' | 'tri_count' | 'vert_ratio' | 'vert_count'} */
  const mode = opts.targetMode || 'tri_ratio'
  const ratio = Math.min(1, Math.max(0.05, Number(opts.ratio) || 0.5))
  const triCountOpt = Math.max(1, Math.floor(Number(opts.targetTriangleCount) || 1))
  const vertRatioGoal = Math.min(1, Math.max(0.05, Number(opts.targetVertexRatio) || 0.5))
  const vertCountOpt = Math.max(1, Math.floor(Number(opts.targetVertexCount) || 1))
  const compactVertices = opts.compactVertices !== false
  const algorithm = opts.algorithm || 'qem'
  const lockBorder = !!opts.lockBorder

  /** @type {{ key: string, a?: number, b?: number, c?: number }[]} */
  const warnings = []

  const posAttr = geometry.attributes.position
  if (!posAttr || posAttr.itemSize < 3) {
    throw new Error('geometry 缺少 position 或 itemSize<3')
  }

  const dr = geometry.drawRange
  if (dr.start !== 0 || (Number.isFinite(dr.count) && dr.count < posAttr.count)) {
    throw new Error('暂不支持非默认 drawRange 的几何体')
  }

  const stride = posAttr.itemSize
  const vertCount = posAttr.count
  const verticesBefore = vertCount

  const positions =
    posAttr.array instanceof Float32Array ? posAttr.array : new Float32Array(posAttr.array)

  /** @type {Uint32Array} */
  let indices
  /** @type {new (len: number) => Uint16Array | Uint32Array} */
  let IndexCtor = Uint32Array

  if (geometry.index) {
    const ia = geometry.index.array
    IndexCtor = ia instanceof Uint16Array ? Uint16Array : Uint32Array
    indices = ia instanceof Uint32Array ? ia : new Uint32Array(ia)
  } else {
    if (vertCount % 3 !== 0) {
      throw new Error('非索引几何的顶点数必须是 3 的倍数（三角列表）')
    }
    indices = new Uint32Array(vertCount)
    for (let i = 0; i < vertCount; i++) indices[i] = i
  }

  if (indices.length % 3 !== 0) {
    throw new Error('索引数量必须是 3 的倍数')
  }

  const trianglesBefore = indices.length / 3

  let goalTri = 1
  switch (mode) {
    case 'tri_ratio':
      goalTri = Math.max(1, Math.floor(trianglesBefore * ratio))
      break
    case 'tri_count':
      goalTri = Math.max(1, Math.min(trianglesBefore, triCountOpt))
      break
    case 'vert_ratio':
      goalTri = Math.max(1, Math.floor(trianglesBefore * vertRatioGoal))
      break
    case 'vert_count': {
      const gv = Math.max(1, Math.min(verticesBefore, vertCountOpt))
      goalTri = Math.max(1, Math.floor((trianglesBefore * gv) / Math.max(1, verticesBefore)))
      break
    }
    default:
      goalTri = Math.max(1, Math.floor(trianglesBefore * ratio))
  }

  let targetIndexCount = goalTri * 3
  targetIndexCount = Math.max(3, Math.min(indices.length, targetIndexCount))
  goalTri = targetIndexCount / 3

  if (targetIndexCount >= indices.length) {
    /** @type {{ key: string, a?: number, b?: number, c?: number }[]} */
    const w = [{ key: 'tri_goal_noop' }]
    if (mode === 'vert_count' && verticesBefore > vertCountOpt) {
      w.push({ key: 'vert_above_count', a: verticesBefore, b: vertCountOpt })
    }
    return {
      trianglesBefore,
      trianglesAfter: trianglesBefore,
      trianglesGoal: goalTri,
      simplifierError: 0,
      verticesBefore,
      verticesAfter: verticesBefore,
      warnings: w,
    }
  }

  const scale = MeshoptSimplifier.getScale(positions, stride)
  const s = scale > 0 ? scale : 1
  const targetError = 1e20 * s

  const borderFlags = lockBorder
    ? (/** @type {const} */ (['LockBorder']))
    : (/** @type {const} */ (['Permissive']))

  let newIndices
  let simplifierError = 0

  if (algorithm === 'cluster') {
    ;[newIndices, simplifierError] = MeshoptSimplifier.simplifySloppy(
      indices,
      positions,
      stride,
      null,
      targetIndexCount,
      targetError,
    )
  } else if (algorithm === 'attribute_aware') {
    const hasNormal = geometry.attributes.normal && geometry.attributes.normal.itemSize >= 3
    const hasUv = geometry.attributes.uv && geometry.attributes.uv.itemSize >= 2

    if (hasNormal && hasUv) {
      const attStride = 5
      const attrs = new Float32Array(vertCount * attStride)
      const nrm = geometry.attributes.normal.array
      const uv = geometry.attributes.uv.array
      const ni = geometry.attributes.normal.itemSize
      const ui = geometry.attributes.uv.itemSize
      for (let i = 0; i < vertCount; i++) {
        const b = i * attStride
        attrs[b] = nrm[i * ni]
        attrs[b + 1] = nrm[i * ni + 1]
        attrs[b + 2] = nrm[i * ni + 2]
        attrs[b + 3] = uv[i * ui]
        attrs[b + 4] = uv[i * ui + 1]
      }
      const weights = [0.05, 0.05, 0.05, 0.5, 0.5]
      const flags = borderFlags.length ? borderFlags : undefined
      ;[newIndices, simplifierError] = MeshoptSimplifier.simplifyWithAttributes(
        indices,
        positions,
        stride,
        attrs,
        attStride,
        weights,
        null,
        targetIndexCount,
        targetError,
        flags,
      )
    } else if (hasNormal) {
      const attStride = 3
      const attrs = new Float32Array(vertCount * attStride)
      const nrm = geometry.attributes.normal.array
      const ni = geometry.attributes.normal.itemSize
      for (let i = 0; i < vertCount; i++) {
        const b = i * attStride
        attrs[b] = nrm[i * ni]
        attrs[b + 1] = nrm[i * ni + 1]
        attrs[b + 2] = nrm[i * ni + 2]
      }
      const weights = [0.08, 0.08, 0.08]
      const flags = borderFlags.length ? borderFlags : undefined
      ;[newIndices, simplifierError] = MeshoptSimplifier.simplifyWithAttributes(
        indices,
        positions,
        stride,
        attrs,
        attStride,
        weights,
        null,
        targetIndexCount,
        targetError,
        flags,
      )
    } else {
      const flags = borderFlags.length ? borderFlags : undefined
      ;[newIndices, simplifierError] = MeshoptSimplifier.simplify(
        indices,
        positions,
        stride,
        targetIndexCount,
        targetError,
        flags,
      )
    }
  } else if (algorithm === 'incremental') {
    const flags = lockBorder
      ? (/** @type {const} */ (['Regularize', 'LockBorder']))
      : (/** @type {const} */ (['Regularize', 'Permissive']))
    ;[newIndices, simplifierError] = MeshoptSimplifier.simplify(
      indices,
      positions,
      stride,
      targetIndexCount,
      targetError,
      flags,
    )
  } else {
    const flags = borderFlags.length ? borderFlags : undefined
    ;[newIndices, simplifierError] = MeshoptSimplifier.simplify(
      indices,
      positions,
      stride,
      targetIndexCount,
      targetError,
      flags,
    )
  }

  const trianglesAfter = newIndices.length / 3

  let outArray = newIndices
  if (IndexCtor === Uint16Array && maxIndexValue(newIndices) < 65536) {
    outArray = new Uint16Array(newIndices)
  }

  geometry.setIndex(new THREE.BufferAttribute(outArray, 1))

  geometry.computeBoundingSphere()
  geometry.computeBoundingBox()
  try {
    geometry.computeVertexNormals()
  } catch {
    /* 部分非流形几何可能失败 */
  }

  /** 未减少三角面（与「仍高于上限」语义重复，故不再追加 tri_above_cap） */
  const noTriReduction =
    trianglesAfter >= trianglesBefore && targetIndexCount < indices.length
  if (noTriReduction) {
    warnings.push({ key: 'tri_no_reduction' })
  } else if (mode === 'tri_ratio' && ratio < 0.97) {
    const want = ratio
    const actualRatio = trianglesAfter / trianglesBefore
    if (actualRatio > want + 0.04) {
      warnings.push({
        key: 'tri_under_target_ratio',
        a: Math.round(want * 100),
        b: Math.round(actualRatio * 100),
      })
    }
  } else if (mode === 'tri_count' && trianglesAfter > goalTri + 1) {
    warnings.push({
      key: 'tri_above_count_goal',
      a: Math.round(trianglesAfter),
      b: Math.round(goalTri),
    })
  }

  /** 已减少但仍高于 goal；无减少时仅保留 tri_no_reduction */
  if (
    !noTriReduction &&
    trianglesAfter > goalTri + 1e-6 &&
    mode !== 'tri_count'
  ) {
    warnings.push({
      key: 'tri_above_cap',
      a: Math.round(trianglesAfter),
      b: Math.round(goalTri),
    })
  }

  let verticesAfter = verticesBefore
  const hasMorph = geometry.morphAttributes && Object.keys(geometry.morphAttributes).length > 0

  if (compactVertices && !hasMorph) {
    try {
      const c = applyMeshoptVertexCompact(geometry)
      verticesAfter = c.verticesAfter
    } catch (e) {
      warnings.push({ key: 'compact_failed', a: String(e?.message || e) })
    }
  } else if (compactVertices && hasMorph) {
    warnings.push({ key: 'compact_skipped_morph' })
    verticesAfter = verticesBefore
  }

  if (mode === 'vert_count' && verticesAfter > vertCountOpt + 0.5) {
    warnings.push({ key: 'vert_above_count', a: verticesAfter, b: vertCountOpt })
  }
  if (mode === 'vert_ratio' && verticesAfter > verticesBefore * vertRatioGoal + 0.5) {
    warnings.push({
      key: 'vert_above_ratio',
      a: verticesAfter,
      b: verticesBefore,
      c: Math.round(vertRatioGoal * 100),
    })
  }

  return {
    trianglesBefore,
    trianglesAfter,
    trianglesGoal: goalTri,
    simplifierError,
    verticesBefore,
    verticesAfter,
    warnings,
  }
}
