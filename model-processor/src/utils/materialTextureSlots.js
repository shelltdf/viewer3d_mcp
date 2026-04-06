import * as THREE from 'three'

/** 颜色/反照率类贴图：sRGB */
const SRGB_SLOTS = new Set([
  'map',
  'emissiveMap',
  'specularMap',
  'sheenColorMap',
  'gradientMap',
])

/** 非颜色数据：线性/无色彩空间（法线、粗糙度、金属度、遮挡等） */
const DATA_SLOTS = new Set([
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'aoMap',
  'bumpMap',
  'displacementMap',
  'alphaMap',
  'lightMap',
  'clearcoatNormalMap',
  'clearcoatRoughnessMap',
  'clearcoatMap',
  'iridescenceMap',
  'iridescenceThicknessMap',
  'transmissionMap',
  'thicknessMap',
  'anisotropyMap',
  'specularIntensityMap',
  'specularColorMap',
])

/**
 * 按槽位设置导入贴图的 colorSpace，避免法线等被当成 sRGB 解码导致光照「断裂、不连续」。
 * @param {import('three').Texture | null | undefined} texture
 * @param {string} slotKey PropertyInspector / MeshStandard 槽名
 */
export function applyTextureColorSpaceForMaterialSlot(texture, slotKey) {
  if (!texture || !slotKey) return
  if (DATA_SLOTS.has(slotKey)) {
    texture.colorSpace = THREE.NoColorSpace
  } else if (SRGB_SLOTS.has(slotKey)) {
    texture.colorSpace = THREE.SRGBColorSpace
  } else {
    texture.colorSpace = THREE.SRGBColorSpace
  }
  texture.needsUpdate = true
}
