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

function mipFactorForTex(tex) {
  return tex?.generateMipmaps !== false ? 1.33 : 1
}

/**
 * 贴图「采样状态」稳定键（与名称、UUID 无关）。
 * @param {import('three').Texture} tex
 */
export function getTextureSamplingKey(tex) {
  if (!tex?.isTexture) return 'invalid'
  const r = tex.repeat
  const o = tex.offset
  const c = tex.center
  const parts = [
    `wrap:${tex.wrapS},${tex.wrapT}`,
    `mag:${tex.magFilter}`,
    `min:${tex.minFilter}`,
    `aniso:${tex.anisotropy ?? 1}`,
    `fmt:${tex.format}`,
    `type:${tex.type}`,
    `cs:${tex.colorSpace || ''}`,
    `fy:${tex.flipY ? 1 : 0}`,
    `mip:${tex.generateMipmaps !== false ? 1 : 0}`,
    `ua:${tex.unpackAlignment ?? 4}`,
    `rep:${r?.x ?? 1},${r?.y ?? 1}`,
    `off:${o?.x ?? 0},${o?.y ?? 0}`,
    `rot:${tex.rotation ?? 0}`,
    `cen:${c?.x ?? 0},${c?.y ?? 0}`,
    `cmp:${tex.isCompressedTexture ? 1 : 0}`,
    `cube:${tex.isCubeTexture ? 1 : 0}`,
  ]
  if (typeof tex.premultiplyAlpha === 'boolean') parts.push(`pma:${tex.premultiplyAlpha ? 1 : 0}`)
  return parts.join('|')
}

/**
 * 贴图资源等价键：显存粗估 + 分辨率 + 采样状态（忽略名称/UUID）。
 * @param {import('three').Texture} tex
 */
export function textureResourceMergeKey(tex) {
  if (!tex?.isTexture) return `invalid`
  const { w, h } = getTextureSize(tex)
  const gpu = estimateTextureGpuBytes(tex)
  const samp = getTextureSamplingKey(tex)
  return `gpu:${gpu}|wh:${w}x${h}|${samp}`
}

const FILTER_LABELS = {
  1003: 'Nearest',
  1004: 'NearestMipmapNearest',
  1005: 'NearestMipmapLinear',
  1006: 'Linear',
  1007: 'LinearMipmapNearest',
  1008: 'LinearMipmapLinear',
}

const WRAP_LABELS = {
  1000: 'Repeat',
  1001: 'ClampToEdge',
  1002: 'MirroredRepeat',
}

/**
 * 采样信息：用于属性面板展示
 * @param {import('three').Texture} tex
 * @returns {{ rows: { label: string, value: string }[] }}
 */
export function getTextureSamplingRows(tex) {
  if (!tex?.isTexture) return { rows: [] }
  const mf = FILTER_LABELS[tex.magFilter] ?? String(tex.magFilter)
  const nf = FILTER_LABELS[tex.minFilter] ?? String(tex.minFilter)
  const ws = WRAP_LABELS[tex.wrapS] ?? String(tex.wrapS)
  const wt = WRAP_LABELS[tex.wrapT] ?? String(tex.wrapT)
  const r = tex.repeat
  const o = tex.offset
  return {
    rows: [
      { label: 'wrapS / wrapT', value: `${ws} / ${wt}` },
      { label: 'magFilter / minFilter', value: `${mf} / ${nf}` },
      { label: 'anisotropy', value: String(tex.anisotropy ?? 1) },
      { label: 'format / type', value: `${tex.format} / ${tex.type}` },
      { label: 'colorSpace', value: String(tex.colorSpace || '—') },
      { label: 'flipY / generateMipmaps', value: `${tex.flipY ? 'true' : 'false'} / ${tex.generateMipmaps !== false ? 'true' : 'false'}` },
      { label: 'repeat (uv)', value: `${r?.x ?? 1}, ${r?.y ?? 1}` },
      { label: 'offset / rotation', value: `${o?.x ?? 0}, ${o?.y ?? 0} · rot ${tex.rotation ?? 0}` },
      { label: 'unpackAlignment', value: String(tex.unpackAlignment ?? 4) },
    ],
  }
}

/**
 * 常用格式：分别粗估「文件/传输」「内存（解码/暂存）」「显存（采样）」。
 * @param {import('three').Texture} tex
 * @returns {{ label: string, fileBytes: number, ramBytes: number, vramBytes: number, note: string }[]}
 */
export function getTextureCompressionFormatTable(tex) {
  const { w, h } = getTextureSize(tex)
  if (!w || !h) return []
  const mip = mipFactorForTex(tex)
  const faces = tex?.isCubeTexture || tex?.isCompressedCubeTexture ? 6 : 1
  const texels = w * h * faces

  const rgbaFull = alignUp(texels * 4 * mip)

  /** @type {{ label: string, fileBytes: number, ramBytes: number, vramBytes: number, note: string }[]} */
  const rows = []

  rows.push({
    label: 'RGBA8 全程未压缩',
    fileBytes: rgbaFull,
    ramBytes: rgbaFull,
    vramBytes: rgbaFull,
    note: '文件=内存=显卡直存时的上界示意',
  })

  const block1 = alignUp(texels * 1 * mip)
  const block05 = alignUp(texels * 0.5 * mip)

  rows.push({
    label: 'BC7 / ASTC 4×4（典型颜色）',
    fileBytes: block1,
    ramBytes: alignUp(texels * 4 * mip * 0.35),
    vramBytes: block1,
    note: '磁盘常为块数据；内存为驱动/转码暂存粗估；显存为块纹理解码后占用',
  })

  rows.push({
    label: 'DDS DXT5 / BC3',
    fileBytes: block1,
    ramBytes: alignUp(texels * 4 * mip * 0.35),
    vramBytes: block1,
    note: '与 BC7 同量级显存；文件体积常为块大小',
  })

  rows.push({
    label: 'DDS DXT1 / BC1',
    fileBytes: block05,
    ramBytes: alignUp(texels * 4 * mip * 0.3),
    vramBytes: block05,
    note: '无平滑 Alpha 时文件更小',
  })

  rows.push({
    label: 'ASTC 8×8',
    fileBytes: alignUp(texels * 0.25 * mip),
    ramBytes: alignUp(texels * 4 * mip * 0.28),
    vramBytes: alignUp(texels * 0.25 * mip),
    note: '移动端低码率；显存仍按 ASTC 解压线宽估算',
  })

  rows.push({
    label: 'ETC2 RGB / EAC RGBA',
    fileBytes: block05,
    ramBytes: alignUp(texels * 4 * mip * 0.32),
    vramBytes: block1,
    note: 'GLES 常用；显存粗估按块格式',
  })

  rows.push({
    label: 'Basis Universal / KTX2（UASTC + supercmp）',
    fileBytes: alignUp(texels * 0.16 * mip),
    ramBytes: alignUp(texels * 4 * mip * 0.55),
    vramBytes: block1,
    note: '文件/.bin 极小；内存需解压/转码 staging；显存多为转 BC7/ASTC 后与 DDS 同类块占用',
  })

  rows.push({
    label: 'PVRTC 4bpp（示意）',
    fileBytes: block05,
    ramBytes: alignUp(texels * 4 * mip * 0.3),
    vramBytes: block05,
    note: '需满足方形等约束；此处仅占位',
  })

  return rows
}
