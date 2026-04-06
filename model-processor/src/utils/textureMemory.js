import { estimateTextureBytes } from './memoryEstimate.js'

const ALIGN = 16

function alignUp(n) {
  if (!n || n <= 0) return 0
  return Math.ceil(n / ALIGN) * ALIGN
}

export function getTextureSize(tex) {
  const img = tex?.image
  let w = 0
  let h = 0
  if (img?.width && img?.height) {
    w = img.width
    h = img.height
  }
  return { w, h }
}

/** 未压缩 RGBA8 + mips 粗估（CPU/上传前） */
export function estimateTextureRawRGBABytes(tex) {
  const { w, h } = getTextureSize(tex)
  if (!w || !h) return alignUp(4096)
  const face = w * h * 4
  const mipFactor = tex?.generateMipmaps !== false ? 1.33 : 1
  let t = face * mipFactor
  if (tex?.isCubeTexture) t *= 6
  return alignUp(t)
}

/** 当前 GPU 侧贴图占用（与 memoryEstimate 一致） */
export function estimateTextureGpuBytes(tex) {
  return estimateTextureBytes(tex)
}

/** BC7 / ASTC 4x4 等块压缩粗估：约 1 byte / texel */
export function estimateTextureBC7LikeBytes(tex) {
  const { w, h } = getTextureSize(tex)
  if (!w || !h) return alignUp(2048)
  const mipFactor = tex?.generateMipmaps !== false ? 1.33 : 1
  let t = w * h * 1 * mipFactor
  if (tex?.isCubeTexture) t *= 6
  return alignUp(t)
}

/** DXT5 / BC3：约 1 byte / texel */
export function estimateTextureDXTBytes(tex) {
  return estimateTextureBC7LikeBytes(tex)
}

export function getTextureMemoryBreakdown(tex) {
  const raw = estimateTextureRawRGBABytes(tex)
  const gpu = estimateTextureGpuBytes(tex)
  const bc7 = estimateTextureBC7LikeBytes(tex)
  return {
    rawRGBA: raw,
    gpuCurrent: gpu,
    compressedBC7Like: bc7,
    isCompressed: tex?.isCompressedTexture === true,
  }
}
