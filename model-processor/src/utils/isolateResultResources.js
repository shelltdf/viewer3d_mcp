import * as THREE from 'three'

/** @type {string[]} */
const TEX_KEYS = [
  'map',
  'lightMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'roughnessMap',
  'metalnessMap',
  'alphaMap',
  'envMap',
  'specularMap',
  'gradientMap',
  'clearcoatNormalMap',
  'sheenColorMap',
  'sheenRoughnessMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'transmissionMap',
  'thicknessMap',
  'anisotropyMap',
  'specularIntensityMap',
  'specularColorMap',
]

/**
 * 将「处理后」分支上的材质与贴图从源树脱钩，避免两侧引用同一 Material/Texture 实例时，
 * 编辑处理后会镜像反映在处理前的检查器与视口中。
 *
 * @param {import('three').Object3D | null} root
 */
/**
 * 为分支内每个 Mesh / SkinnedMesh 使用独立 `BufferGeometry` 副本。
 * `SkeletonUtils.clone` 可能仍与源树共用几何；共用会导致 `applyLodDrawRange` 的
 * `setDrawRange` 与 `_lodBackup(WeakMap)` 在处理前/后互相干扰。
 *
 * @param {import('three').Object3D | null} root
 */
export function deepCloneMeshGeometries(root) {
  if (!root) return
  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    const g = obj.geometry
    if (!g?.isBufferGeometry) return
    obj.geometry = g.clone()
  })
}

export function isolateResultBranchResources(root) {
  if (!root) return
  /** @type {Map<string, import('three').Texture>} */
  const texCloneBySourceUuid = new Map()

  function cloneTextureForBranch(t) {
    if (!t?.isTexture) return t
    if (texCloneBySourceUuid.has(t.uuid)) {
      return texCloneBySourceUuid.get(t.uuid)
    }
    const c = t.clone()
    c.needsUpdate = true
    texCloneBySourceUuid.set(t.uuid, c)
    return c
  }

  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    const next = mats.map((m) => {
      if (!m) return m
      const mc = m.clone()
      for (const k of TEX_KEYS) {
        if (mc[k]?.isTexture) mc[k] = cloneTextureForBranch(mc[k])
      }
      mc.needsUpdate = true
      return mc
    })
    obj.material = Array.isArray(obj.material) ? next : next[0]
  })
}
