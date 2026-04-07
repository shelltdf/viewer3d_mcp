import * as THREE from 'three'

/** @typedef {keyof import('three').MeshStandardMaterial} MapKey */

/** 与属性面板贴图槽一致 */
const COPY_TEXTURE_KEYS = [
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
]

/**
 * @param {import('three').Material} src
 * @param {import('three').Material} dst
 */
export function copySharedMaterialProperties(src, dst) {
  if (!src || !dst) return
  dst.name = src.name
  dst.side = src.side
  dst.transparent = src.transparent
  dst.opacity = src.opacity
  dst.alphaTest = src.alphaTest
  dst.depthTest = src.depthTest
  dst.depthWrite = src.depthWrite
  dst.blending = src.blending
  if ('vertexColors' in dst && 'vertexColors' in src) dst.vertexColors = src.vertexColors
  if ('wireframe' in dst && 'wireframe' in src) dst.wireframe = src.wireframe
  if ('fog' in dst && 'fog' in src) dst.fog = src.fog

  for (const k of COPY_TEXTURE_KEYS) {
    if (k in dst && src[k]?.isTexture) dst[k] = src[k]
  }

  if (dst.color && src.color) dst.color.copy(src.color)
  if ('emissive' in dst && src.emissive) dst.emissive.copy(src.emissive)
  if ('emissiveIntensity' in dst && typeof src.emissiveIntensity === 'number') {
    dst.emissiveIntensity = src.emissiveIntensity
  }
  if ('specular' in dst && src.specular) dst.specular.copy(src.specular)
  if (typeof src.shininess === 'number' && 'shininess' in dst) dst.shininess = src.shininess
  if (typeof src.roughness === 'number' && 'roughness' in dst) dst.roughness = src.roughness
  if (typeof src.metalness === 'number' && 'metalness' in dst) dst.metalness = src.metalness
  if (src.normalScale && 'normalScale' in dst) dst.normalScale.copy(src.normalScale)
  if (typeof src.bumpScale === 'number' && 'bumpScale' in dst) dst.bumpScale = src.bumpScale
  if (typeof src.displacementScale === 'number' && 'displacementScale' in dst) {
    dst.displacementScale = src.displacementScale
  }
  if (typeof src.displacementBias === 'number' && 'displacementBias' in dst) {
    dst.displacementBias = src.displacementBias
  }
  if (typeof src.envMapIntensity === 'number' && 'envMapIntensity' in dst) {
    dst.envMapIntensity = src.envMapIntensity
  }
  if (typeof src.lightMapIntensity === 'number' && 'lightMapIntensity' in dst) {
    dst.lightMapIntensity = src.lightMapIntensity
  }
  if (typeof src.aoMapIntensity === 'number' && 'aoMapIntensity' in dst) {
    dst.aoMapIntensity = src.aoMapIntensity
  }
  if (typeof src.flatShading === 'boolean' && 'flatShading' in dst) dst.flatShading = src.flatShading

  dst.userData = src.userData && typeof src.userData === 'object' ? { ...src.userData } : {}
  dst.needsUpdate = true
}

/**
 * @param {string} typeName THREE 类名，如 MeshStandardMaterial
 * @param {import('three').Material | null} [copyFrom]
 * @returns {import('three').Material | null}
 */
export function createMaterialByTypeName(typeName, copyFrom = null) {
  const Ctor = /** @type {new () => import('three').Material} */ (THREE[typeName])
  if (typeof Ctor !== 'function') return null
  const m = new Ctor()
  if (copyFrom) copySharedMaterialProperties(copyFrom, m)
  return m
}

/** 用户可切换到的网格材质类名（与 three 导出一致） */
export const MESH_MATERIAL_TYPE_OPTIONS = [
  { value: 'MeshBasicMaterial', labelKey: 'matTypeBasic' },
  { value: 'MeshLambertMaterial', labelKey: 'matTypeLambert' },
  { value: 'MeshPhongMaterial', labelKey: 'matTypePhong' },
  { value: 'MeshStandardMaterial', labelKey: 'matTypeStandard' },
  { value: 'MeshPhysicalMaterial', labelKey: 'matTypePhysical' },
  { value: 'MeshToonMaterial', labelKey: 'matTypeToon' },
  { value: 'MeshNormalMaterial', labelKey: 'matTypeNormal' },
  { value: 'MeshMatcapMaterial', labelKey: 'matTypeMatcap' },
  { value: 'MeshDepthMaterial', labelKey: 'matTypeDepth' },
  { value: 'MeshDistanceMaterial', labelKey: 'matTypeDistance' },
]
