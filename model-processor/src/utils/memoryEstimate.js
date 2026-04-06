/** 假定 GPU/CPU 缓冲区按块对齐（保守估计） */
const ALIGN = 16

function alignUp(n, a = ALIGN) {
  if (!n || n <= 0) return 0
  return Math.ceil(n / a) * a
}

function bufferByteLength(attr) {
  if (!attr?.array) return 0
  return alignUp(attr.array.byteLength || attr.array.length * (attr.array.BYTES_PER_ELEMENT || 1))
}

/**
 * @param {import('three').BufferGeometry} geo
 */
export function estimateGeometryBytes(geo) {
  if (!geo?.isBufferGeometry) return 0
  let n = 0
  if (geo.index) n += bufferByteLength(geo.index)
  const attrs = geo.attributes
  if (attrs)
    for (const k of Object.keys(attrs)) {
      n += bufferByteLength(attrs[k])
    }
  return n
}

/**
 * 贴图：按尺寸 × 格式粗估显存（含 mipmap 约 +33%）；压缩纹理按 mip 尺寸估算。
 * @param {import('three').Texture} tex
 */
export function estimateTextureBytes(tex) {
  if (!tex?.isTexture) return 0
  const img = tex.image
  let w = 0
  let h = 0
  if (img) {
    if (img.width && img.height) {
      w = img.width
      h = img.height
    } else if (img.data && img.width) {
      w = img.width
      h = img.height
    }
  }
  if (!w || !h) {
    if (tex.image?.width) {
      w = tex.image.width
      h = tex.image.height
    }
  }
  if (!w || !h) return alignUp(4096)

  const isCompressed = tex.isCompressedTexture === true

  let bytesPerTexel = 4
  if (isCompressed) {
    bytesPerTexel = 0.5
  } else if (tex.type === 1015 || tex.type === 1016) {
    bytesPerTexel = 8
  }

  let face = w * h * bytesPerTexel
  const mipFactor = tex.generateMipmaps !== false ? 1.33 : 1
  let total = face * mipFactor
  if (tex.isCubeTexture || tex.isCompressedCubeTexture) total *= 6
  return alignUp(total)
}

/**
 * @param {import('three').Object3D | null} root
 */
export function estimateSceneMemory(root) {
  let geometryBytes = 0
  let textureBytes = 0
  let materialBytes = 0
  let meshCount = 0
  const textureUuids = new Set()

  root?.traverse((obj) => {
    if (obj.isMesh || obj.isSkinnedMesh) {
      meshCount += 1
      const g = obj.geometry
      if (g) geometryBytes += estimateGeometryBytes(g)
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      for (const m of mats) {
        if (!m) continue
        materialBytes += alignUp(256)
        const keys = [
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
        for (const k of keys) {
          const t = m[k]
          if (t?.isTexture && !textureUuids.has(t.uuid)) {
            textureUuids.add(t.uuid)
            textureBytes += estimateTextureBytes(t)
          }
        }
      }
    }
  })

  const breakdown = [
    { id: 'geo', label: '几何缓冲区', bytes: geometryBytes },
    { id: 'tex', label: '贴图（估）', bytes: textureBytes },
    { id: 'mat', label: '材质/杂项', bytes: materialBytes },
  ]

  const total = breakdown.reduce((s, x) => s + x.bytes, 0)
  return {
    total,
    meshCount,
    textureCount: textureUuids.size,
    breakdown,
    note:
      '此为浏览器解压后常驻显存/上传缓冲的粗算：分辨率×通道字节×（可选 mipmap 约×1.33），与磁盘 .jpg/.png/.basis 等压缩文件体积无关（5MB 文件解码成 4K RGBA 可能数十 MB）。含对齐余量；HalfFloat/Float 等按 8 字节/纹素估算。实际以 GPU 驱动分配为准。',
  }
}
