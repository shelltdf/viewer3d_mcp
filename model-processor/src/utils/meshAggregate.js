import { computeMeshStats } from './meshStats.js'

/**
 * 汇总某节点子树内所有 Mesh 的统计与列表。
 * @param {import('three').Object3D} obj
 */
export function aggregateMeshInfoUnderNode(obj) {
  if (!obj) return { meshes: [], totals: { meshes: 0, triangles: 0, vertices: 0 } }

  const meshes = []
  obj.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return
    const g = o.geometry
    let tris = 0
    let verts = 0
    if (g) {
      const index = g.index
      const pos = g.attributes?.position
      if (index) tris = Math.floor(index.count / 3)
      else if (pos) tris = Math.floor(pos.count / 3)
      if (pos) verts = pos.count
    }
    meshes.push({
      name: o.name || o.type,
      uuid: o.uuid,
      triangles: tris,
      vertices: verts,
      type: o.type,
    })
  })

  const totals = computeMeshStats(obj)
  return { meshes, totals }
}
