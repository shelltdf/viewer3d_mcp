import { MATERIAL_MAP_KEYS } from './analyzeDuplicateResources.js'

/**
 * @param {import('three').Object3D | null} root
 */
export function computeMeshStats(root) {
  let meshes = 0
  let triangles = 0
  let vertices = 0
  root?.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    meshes += 1
    const g = obj.geometry
    if (!g) return
    const index = g.index
    const pos = g.attributes?.position
    if (index) {
      triangles += Math.floor(index.count / 3)
    } else if (pos) {
      triangles += Math.floor(pos.count / 3)
    }
    if (pos) vertices += pos.count
  })
  return { meshes, triangles, vertices }
}

/**
 * 场景内可渲染资源计数（Mesh / 三角面 / 顶点 / 唯一材质 / 唯一贴图槽实例）
 * @param {import('three').Object3D | null} root
 */
export function computeSceneResourceCounts(root) {
  const { meshes, triangles, vertices } = computeMeshStats(root)
  const materialUuids = new Set()
  const textureUuids = new Set()
  root?.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m) continue
      materialUuids.add(m.uuid)
      for (const k of MATERIAL_MAP_KEYS) {
        const t = m[k]
        if (t?.isTexture) textureUuids.add(t.uuid)
      }
    }
  })
  return {
    meshes,
    triangles,
    vertices,
    materials: materialUuids.size,
    textures: textureUuids.size,
  }
}

const _lodBackup = new WeakMap()

/**
 * LOD 预览：按比例缩小 draw range（非真实减面）。
 * @param {import('three').Object3D | null} root
 * @param {number} level01 0~1
 */
export function applyLodDrawRange(root, level01) {
  const t = Math.max(0.02, Math.min(1, level01))
  root?.traverse((obj) => {
    const g = obj.geometry
    if (!g || !g.isBufferGeometry) return
    if (!_lodBackup.has(g)) {
      const index = g.index
      const pos = g.attributes?.position
      const maxIndex = index ? index.count : pos ? pos.count : 0
      if (!maxIndex) return
      _lodBackup.set(g, { maxIndex })
    }
    const { maxIndex } = _lodBackup.get(g)
    let count = Math.floor(maxIndex * t)
    count -= count % 3
    if (count < 3) count = Math.min(3, maxIndex)
    g.setDrawRange(0, Math.min(count, maxIndex))
  })
}

export function resetLodDrawRange(root) {
  root?.traverse((obj) => {
    const g = obj.geometry
    if (!g || !g.isBufferGeometry) return
    const b = _lodBackup.get(g)
    if (b) g.setDrawRange(0, b.maxIndex)
  })
}

/**
 * 几何在运行时被写入 index / 顶点缓冲后，LOD 缓存的 maxIndex 可能与当前 index 语义不一致，需丢弃后重算。
 * @param {import('three').Object3D | null} root
 */
export function invalidateLodCacheForRoot(root) {
  root?.traverse((obj) => {
    const g = obj.geometry
    if (g?.isBufferGeometry) _lodBackup.delete(g)
  })
}
