import * as THREE from 'three'

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
 * 使用法线贴图时：关掉 flatShading（按面法线与切线空间法线混用易产生折线状不连续光照）；
 * 有切线缓冲时开启 vertexTangents；约定切线空间法线。
 * @param {import('three').Mesh | import('three').SkinnedMesh} mesh
 */
export function syncStandardMaterialsForNormalMap(mesh) {
  const g = mesh?.geometry
  if (!g?.isBufferGeometry) return
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const hasTangent = !!g.getAttribute('tangent')
  for (const m of mats) {
    if (!m || typeof m !== 'object' || !m.normalMap) continue
    const supports = !!(
      m.isMeshStandardMaterial ||
      m.isMeshPhysicalMaterial ||
      m.isMeshPhongMaterial ||
      m.isMeshLambertMaterial ||
      m.isMeshToonMaterial
    )
    if (!supports) continue
    let dirty = false
    if (m.flatShading === true) {
      m.flatShading = false
      dirty = true
    }
    if (m.normalMapType == null) {
      m.normalMapType = THREE.TangentSpaceNormalMap
      dirty = true
    }
    if (hasTangent && m.vertexTangents !== true) {
      m.vertexTangents = true
      dirty = true
    }
    if (dirty) m.needsUpdate = true
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
