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

/**
 * 使用 meshoptimizer WASM 对 BufferGeometry 做三角网格简化（改写 index，不压缩顶点缓冲）。
 *
 * @param {THREE.BufferGeometry} geometry
 * @param {{ ratio: number, algorithm: 'qem' | 'cluster' | 'incremental' | 'attribute_aware', lockBorder: boolean }} opts
 * @returns {{ trianglesBefore: number, trianglesAfter: number, simplifierError: number }}
 */
export async function applyMeshoptSimplifyToGeometry(geometry, opts) {
  await meshoptSimplifierReady()
  if (!MeshoptSimplifier.supported) {
    throw new Error('MeshoptSimplifier 不可用（需要支持 WebAssembly 的浏览器）')
  }

  const ratio = Math.min(1, Math.max(0.05, Number(opts.ratio) || 0.5))
  const algorithm = opts.algorithm || 'qem'
  const lockBorder = !!opts.lockBorder

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
  let targetIndexCount = Math.round((indices.length * ratio) / 3) * 3
  targetIndexCount = Math.max(3, Math.min(indices.length, targetIndexCount))

  if (targetIndexCount >= indices.length) {
    return { trianglesBefore, trianglesAfter: trianglesBefore, simplifierError: 0 }
  }

  const scale = MeshoptSimplifier.getScale(positions, stride)
  const targetError = 1e-2 * (scale > 0 ? scale : 1)

  const borderFlags = lockBorder ? (/** @type {const} */ (['LockBorder'])) : []

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
      const flags = lockBorder ? (/** @type {const} */ (['LockBorder'])) : undefined
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
      const flags = lockBorder ? (/** @type {const} */ (['LockBorder'])) : undefined
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
      : (/** @type {const} */ (['Regularize']))
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

  return { trianglesBefore, trianglesAfter, simplifierError }
}
