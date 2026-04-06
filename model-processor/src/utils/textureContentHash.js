import { estimateTextureBytes as estimateTextureGpuBytes } from './memoryEstimate.js'
import { getTextureSize } from './textureMemory.js'

function fnv1a32Bytes(u8) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < u8.length; i++) {
    h ^= u8[i]
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** 第二段 32 位，降低碰撞概率 */
function fnv1a32BytesB(u8) {
  let h = 97531 >>> 0
  for (let i = 0; i < u8.length; i++) {
    h ^= u8[i]
    h = Math.imul(h, 2246822519) >>> 0
  }
  return h >>> 0
}

export function buffersByteEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

/**
 * 尝试读取贴图像素/块数据为连续字节（ level0 ）；失败返回 null。
 * @param {import('three').Texture} tex
 * @returns {Uint8Array | null}
 */
export function tryGetTextureRawByteView(tex) {
  if (!tex?.isTexture) return null

  if (tex.isCompressedTexture && tex.mipmaps?.length) {
    const parts = []
    for (const mip of tex.mipmaps) {
      const d = mip?.data
      if (!d) continue
      const u8 = d instanceof Uint8Array ? d : new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
      parts.push(u8)
    }
    if (!parts.length) return null
    const total = parts.reduce((s, p) => s + p.length, 0)
    const out = new Uint8Array(total)
    let o = 0
    for (const p of parts) {
      out.set(p, o)
      o += p.length
    }
    return out
  }

  const img = tex.image
  if (!img) return null

  if (img.data != null && img.width > 0 && img.height > 0) {
    const d = img.data
    if (d.buffer) return new Uint8Array(d.buffer, d.byteOffset, d.byteLength)
    return null
  }

  if (tex.isCubeTexture && Array.isArray(img)) {
    try {
      const c = document.createElement('canvas')
      const ctx = c.getContext('2d')
      if (!ctx) return null
      const chunks = []
      for (const face of img) {
        if (!face || !face.width || !face.height) return null
        c.width = face.width
        c.height = face.height
        ctx.drawImage(face, 0, 0)
        const im = ctx.getImageData(0, 0, face.width, face.height)
        chunks.push(new Uint8Array(im.data.buffer))
      }
      const total = chunks.reduce((s, p) => s + p.length, 0)
      const out = new Uint8Array(total)
      let o = 0
      for (const p of chunks) {
        out.set(p, o)
        o += p.length
      }
      return out
    } catch {
      return null
    }
  }

  if (img.width > 0 && img.height > 0) {
    try {
      const c = document.createElement('canvas')
      c.width = img.width
      c.height = img.height
      const ctx = c.getContext('2d')
      if (!ctx) return null
      ctx.drawImage(img, 0, 0)
      const im = ctx.getImageData(0, 0, img.width, img.height)
      return new Uint8Array(im.data.buffer)
    } catch {
      return null
    }
  }

  return null
}

/**
 * @returns {{ h32a: number, h32b: number } | null}
 */
export function computeTextureContentHashParts(tex) {
  const u8 = tryGetTextureRawByteView(tex)
  if (!u8 || !u8.length) return null
  return { h32a: fnv1a32Bytes(u8), h32b: fnv1a32BytesB(u8) }
}

/**
 * HTMLImageElement 等上的资源 URL（用于 MTL 多 newmtl 引用同一 JPG 时的稳定分桶）。
 * @param {import('three').Texture} tex
 */
export function getTextureImageSrc(tex) {
  if (!tex?.isTexture) return ''
  const img = tex.image
  if (!img) return ''
  if (typeof img.src === 'string' && img.src) return img.src
  if (typeof img.currentSrc === 'string' && img.currentSrc) return img.currentSrc
  return ''
}

/**
 * HTTP(S) 去掉 hash；blob/data 原样，避免无意义分裂。
 * @param {string} src
 */
export function normalizeTextureImageSrc(src) {
  const s = (src || '').trim()
  if (!s) return ''
  if (s.startsWith('blob:') || s.startsWith('data:')) return s
  try {
    const base = typeof window !== 'undefined' && window.location?.href ? window.location.href : 'http://localhost/'
    const u = new URL(s, base)
    return `${u.origin}${u.pathname}${u.search}`
  } catch {
    return s
  }
}

/**
 * 与名称/采样无关的内容身份键。
 * - 有 image src 时优先 **FILE:**（不含宽高），避免 MTLLoader 多实例在解码前后 PIX/SRC/w×h 变化导致无法与材质合并对齐；
 * - 无 src（DataTexture、压缩块源等）仍用像素哈希或弱键。
 * @param {import('three').Texture} tex
 */
export function textureContentIdentityKey(tex) {
  if (!tex?.isTexture) return 'invalid'
  const { w, h } = getTextureSize(tex)
  const fmt = tex.format
  const typ = tex.type
  const cube = tex.isCubeTexture ? 1 : 0
  const cmp = tex.isCompressedTexture ? 1 : 0

  const srcRaw = getTextureImageSrc(tex)
  const srcNorm = srcRaw ? normalizeTextureImageSrc(srcRaw) : ''
  if (srcNorm) {
    return `FILE:${srcNorm}|f:${fmt}|t:${typ}|c:${cube}|k:${cmp}`
  }

  const hp = computeTextureContentHashParts(tex)
  if (hp) {
    return `PIX:${hp.h32a.toString(16)}~${hp.h32b.toString(16)}|${w}x${h}|f:${fmt}|t:${typ}|c:${cube}|k:${cmp}`
  }

  return `WEAK:${w}x${h}|f:${fmt}|t:${typ}|gpu:${estimateTextureGpuBytes(tex)}|c:${cube}|k:${cmp}`
}

/**
 * 桶内确认：输出「可合并」子簇数组（同一桶内可能有多组互不等价的纹理）。
 * - FILE：同一规范化 URL 先入桶；能读像素时校一致则为已核对，否则整桶弱信任；
 * - 桶内像素哈希片段均存在且一致：视为已核对；
 * - 否则多轮 memcmp，**每一轮**输出一个大小≥2 的簇；
 * - 仍无簇时：桶内本就同一 identity key，退化为弱信任整桶。
 * @param {import('three').Texture[]} textures
 * @returns {Array<{ textures: import('three').Texture[], pixelVerified: boolean }>}
 */
export function refineTextureDuplicateClusters(textures) {
  const uniq = [...new Map(textures.map((t) => [t.uuid, t])).values()]
  if (uniq.length < 2) return []

  const k0 = textureContentIdentityKey(uniq[0])

  if (k0.startsWith('FILE:')) {
    const hp0 = computeTextureContentHashParts(uniq[0])
    if (!hp0) {
      return [{ textures: uniq, pixelVerified: false }]
    }
    const allSameHp = uniq.every((t) => {
      const hp = computeTextureContentHashParts(t)
      return hp && hp.h32a === hp0.h32a && hp.h32b === hp0.h32b
    })
    if (allSameHp) return [{ textures: uniq, pixelVerified: true }]
    // URL 相同但像素可读且不一致：交给下方 memcmp 拆簇
  } else if (k0.startsWith('PIX:')) {
    const hp0 = computeTextureContentHashParts(uniq[0])
    if (hp0) {
      const allSameHp = uniq.every((t) => {
        const hp = computeTextureContentHashParts(t)
        return hp && hp.h32a === hp0.h32a && hp.h32b === hp0.h32b
      })
      if (allSameHp) return [{ textures: uniq, pixelVerified: true }]
    }
  }

  const out = []
  let pool = [...uniq]
  while (pool.length >= 2) {
    let refTex = null
    let refB = null
    for (const t of pool) {
      const b = tryGetTextureRawByteView(t)
      if (b && b.length) {
        refTex = t
        refB = b
        break
      }
    }
    if (!refB || !refTex) break

    const cluster = [refTex]
    const rest = []
    for (const t of pool) {
      if (t === refTex) continue
      const b = tryGetTextureRawByteView(t)
      if (b && buffersByteEqual(refB, b)) cluster.push(t)
      else rest.push(t)
    }

    if (cluster.length >= 2) out.push({ textures: cluster, pixelVerified: true })
    pool = rest
  }

  if (out.length) return out

  const sameIdentity = uniq.every((t) => textureContentIdentityKey(t) === k0)
  if (sameIdentity) return [{ textures: uniq, pixelVerified: false }]

  return []
}

/**
 * @deprecated 使用 refineTextureDuplicateClusters；保留兼容，返回最大单簇或 null
 */
export function refineTextureDuplicatesByPixels(textures) {
  const clusters = refineTextureDuplicateClusters(textures)
  if (!clusters.length) return null
  return clusters.reduce((a, c) => (c.textures.length > (a?.textures.length ?? 0) ? c : a), null)
}
