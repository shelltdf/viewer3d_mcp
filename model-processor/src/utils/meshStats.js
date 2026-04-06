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
