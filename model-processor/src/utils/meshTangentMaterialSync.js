/**
 * 几何上存在 `tangent` 缓冲时，MeshStandard / Physical 等需 `vertexTangents=true`，
 * 否则部分环境下程序链接或绘制异常，表现为网格消失。
 * @param {import('three').Mesh | import('three').SkinnedMesh} mesh
 */
export function syncMaterialsVertexTangentsFromGeometry(mesh) {
  const g = mesh?.geometry
  if (!g?.getAttribute?.('tangent')) return
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  for (const m of mats) {
    if (!m || typeof m !== 'object') continue
    // ShaderMaterial / RawShaderMaterial 等无官方 `vertexTangents`，写入会告警且无效
    const supports = !!(
      m.isMeshStandardMaterial ||
      m.isMeshPhysicalMaterial ||
      m.isMeshPhongMaterial ||
      m.isMeshLambertMaterial ||
      m.isMeshToonMaterial
    )
    if (!supports) continue
    if (m.vertexTangents !== true) {
      m.vertexTangents = true
      m.needsUpdate = true
    }
  }
}

/**
 * @param {import('three').BufferGeometry | null | undefined} geo
 */
export function refreshGeometryBounds(geo) {
  if (!geo?.isBufferGeometry) return
  try {
    geo.computeBoundingSphere()
    geo.computeBoundingBox?.()
  } catch {
    /* 无效顶点时可能失败，避免连带拖垮 UI */
  }
}
