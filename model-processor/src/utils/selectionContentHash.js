import { geometryContentKey, materialMergeKey } from './analyzeDuplicateResources.js'
import { computeTextureContentHashParts, textureContentIdentityKey } from './textureContentHash.js'
import { getTextureSamplingKey } from './textureMemory.js'
import { contentHashDualFromString, fnv1a32String } from './hashString.js'

export { contentHashDualFromString, fnv1a32String } from './hashString.js'

function fnv1a32TypedArray(arr) {
  if (!arr?.buffer) return '0'
  const u8 = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength)
  let h = 2166136261 >>> 0
  for (let i = 0; i < u8.length; i++) {
    h ^= u8[i]
    h = Math.imul(h, 16777619) >>> 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * 仅几何 + 材质「内容」键（不含对象名、UUID）。
 * @param {import('three').Object3D} obj
 */
export function getObject3DContentHashDisplay(obj) {
  if (!obj) return '—'
  if ((obj.isMesh || obj.isSkinnedMesh) && obj.geometry?.isBufferGeometry) {
    const gk = geometryContentKey(obj.geometry)
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    const mk = mats.map((m) => (m ? materialMergeKey(m) : 'null')).join('||')
    return contentHashDualFromString(`${gk}@@${mk}`)
  }
  const e = obj.matrix.elements.map((x) => Math.round(x * 1e6) / 1e6).join(',')
  const sig = `${obj.type}|vis:${obj.visible ? 1 : 0}|ly:${obj.layers?.mask ?? 0}|fc:${obj.frustumCulled ? 1 : 0}|ro:${obj.renderOrder}|m:${e}`
  return contentHashDualFromString(sig)
}

/**
 * 材质：与去重逻辑一致的 materialMergeKey（已排除 name/uuid）。
 * @param {import('three').Material} m
 */
export function getMaterialContentHashDisplay(m) {
  if (!m) return '—'
  return contentHashDualFromString(materialMergeKey(m))
}

/**
 * 贴图：像素/块数据 + 采样等属性（不含 name/uuid）；读不到像素则身份键 + 采样摘要。
 * @param {import('three').Texture} t
 */
export function getTextureContentHashDisplay(t) {
  if (!t) return '—'
  const samp = getTextureSamplingKey(t)
  const px = computeTextureContentHashParts(t)
  if (px) {
    const inner = `PIX:${px.h32a.toString(16)}~${px.h32b.toString(16)}|S:${samp}`
    return contentHashDualFromString(inner)
  }
  let ident = textureContentIdentityKey(t)
  if (ident.length > 180) {
    ident = `FILE@${fnv1a32String(ident)}·${fnv1a32String(`${ident}#2`)}`
  }
  return contentHashDualFromString(`${ident}|S:${samp}`)
}

/**
 * 动画片段：时长、混合模式、各轨道类型与关键帧 times/values（不含 clip/track 名称）。
 * @param {import('three').AnimationClip} clip
 */
export function getClipContentHashDisplay(clip) {
  if (!clip) return '—'
  const tr = clip.tracks || []
  const parts = [`d:${clip.duration}`, `bm:${clip.blendMode ?? ''}`, `tc:${tr.length}`]
  for (let i = 0; i < tr.length; i++) {
    const t = tr[i]
    const interp = typeof t.getInterpolation === 'function' ? t.getInterpolation() : ''
    parts.push(`${i}:${t.constructor.name}|${interp}|tn:${t.times?.length ?? 0}|vn:${t.values?.length ?? 0}`)
    if (t.times?.length) parts.push(`th:${fnv1a32TypedArray(t.times)}`)
    if (t.values?.length) parts.push(`vh:${fnv1a32TypedArray(t.values)}`)
  }
  return contentHashDualFromString(parts.join('|'))
}
