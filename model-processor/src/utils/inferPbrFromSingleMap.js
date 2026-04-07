import * as THREE from 'three'
import { applyTextureColorSpaceForMaterialSlot } from './materialTextureSlots.js'
import {
  syncMaterialsVertexTangentsFromGeometry,
  syncStandardMaterialsForNormalMap,
} from './meshTangentMaterialSync.js'

const INF_TAG = '_pbrInferred'

/**
 * @param {import('three').Texture} tex
 */
function textureImageReady(tex) {
  const img = tex.image
  if (img == null) return false
  if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
    return img.width > 0 && img.height > 0
  }
  if (typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement) {
    return img.width > 0 && img.height > 0
  }
  if (typeof HTMLVideoElement !== 'undefined' && img instanceof HTMLVideoElement) {
    return img.readyState >= 2
  }
  if (typeof HTMLImageElement !== 'undefined' && img instanceof HTMLImageElement) {
    return img.complete && img.naturalWidth > 0
  }
  return true
}

/**
 * @param {import('three').Texture} src
 * @param {import('three').Texture} dst
 */
function copyTextureRepeatParams(dst, src) {
  dst.wrapS = src.wrapS
  dst.wrapT = src.wrapT
  dst.repeat.copy(src.repeat)
  dst.offset.copy(src.offset)
  dst.rotation = src.rotation
  dst.center.copy(src.center)
  dst.generateMipmaps = src.generateMipmaps !== false
  dst.minFilter = src.minFilter
  dst.magFilter = src.magFilter
  dst.anisotropy = src.anisotropy
}

/**
 * @param {import('three').Material} mat
 * @param {string} slot
 */
function disposeInferredSlot(mat, slot) {
  const t = mat[slot]
  if (t?.isTexture && t.userData?.[INF_TAG]) {
    t.dispose()
    mat[slot] = null
  }
}

/**
 * @param {import('three').Texture} tex
 */
function markInferred(tex) {
  tex.userData[INF_TAG] = true
}

function luminanceByte(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

/**
 * @param {HTMLCanvasElement} src
 * @param {number} maxDim
 * @returns {HTMLCanvasElement}
 */
function downscaleCanvas(src, maxDim) {
  const w = src.width
  const h = src.height
  if (w <= maxDim && h <= maxDim) return src
  const scale = maxDim / Math.max(w, h)
  const nw = Math.max(1, Math.round(w * scale))
  const nh = Math.max(1, Math.round(h * scale))
  const out = document.createElement('canvas')
  out.width = nw
  out.height = nh
  const ctx = out.getContext('2d')
  if (!ctx) return src
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src, 0, 0, nw, nh)
  return out
}

/**
 * @param {import('three').Texture} tex
 * @param {number} maxDim
 * @returns {HTMLCanvasElement | null}
 */
export function textureToReadableCanvas(tex, maxDim) {
  if (!tex?.isTexture || !textureImageReady(tex)) return null
  const img = tex.image
  if (!img) return null
  const w = img.width || img.videoWidth || img.displayWidth
  const h = img.height || img.videoHeight || img.displayHeight
  if (!w || !h) return null
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  try {
    // 勿在此处用 2D 变换「预翻转」：CanvasTexture 会再按 flipY 上传，与 map 一致时应保持与图像源相同行序，由 Three 与 map 相同的 flipY 处理。
    ctx.drawImage(img, 0, 0, w, h)
  } catch {
    return null
  }
  return downscaleCanvas(c, maxDim)
}

/**
 * 由反照率亮度推测粗糙度：暗部略糙、亮部略光。
 * @param {HTMLCanvasElement} albedoCanvas
 */
function buildRoughnessCanvas(albedoCanvas) {
  const w = albedoCanvas.width
  const h = albedoCanvas.height
  const ctx = albedoCanvas.getContext('2d')
  if (!ctx) return albedoCanvas
  const src = ctx.getImageData(0, 0, w, h)
  const d = src.data
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const octx = out.getContext('2d')
  if (!octx) return albedoCanvas
  const img = octx.createImageData(w, h)
  const od = img.data
  for (let i = 0; i < d.length; i += 4) {
    const L = luminanceByte(d[i], d[i + 1], d[i + 2]) / 255
    const rough = 0.32 + (1 - L) * 0.58
    const v = Math.round(Math.min(255, Math.max(0, rough * 255)))
    od[i] = v
    od[i + 1] = v
    od[i + 2] = v
    od[i + 3] = 255
  }
  octx.putImageData(img, 0, 0)
  return out
}

/**
 * 由亮度作简单 Sobel 高度场生成切线空间法线（近似）。
 * @param {HTMLCanvasElement} albedoCanvas
 */
function buildNormalCanvasFromAlbedo(albedoCanvas) {
  const w = albedoCanvas.width
  const h = albedoCanvas.height
  const ctx = albedoCanvas.getContext('2d')
  if (!ctx) return albedoCanvas
  const src = ctx.getImageData(0, 0, w, h)
  const d = src.data

  function heightAt(x, y) {
    const ix = Math.max(0, Math.min(w - 1, x))
    const iy = Math.max(0, Math.min(h - 1, y))
    const p = (iy * w + ix) * 4
    return luminanceByte(d[p], d[p + 1], d[p + 2]) / 255
  }

  const strength = 3.5
  const out = document.createElement('canvas')
  out.width = w
  out.height = h
  const octx = out.getContext('2d')
  if (!octx) return albedoCanvas
  const img = octx.createImageData(w, h)
  const od = img.data

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (heightAt(x + 1, y) - heightAt(x - 1, y)) * strength
      const dy = (heightAt(x, y + 1) - heightAt(x, y - 1)) * strength
      let nx = -dx
      let ny = -dy
      let nz = 1
      const len = Math.hypot(nx, ny, nz) || 1
      nx /= len
      ny /= len
      nz /= len
      const j = (y * w + x) * 4
      od[j] = Math.round((nx * 0.5 + 0.5) * 255)
      od[j + 1] = Math.round((ny * 0.5 + 0.5) * 255)
      od[j + 2] = Math.round((nz * 0.5 + 0.5) * 255)
      od[j + 3] = 255
    }
  }
  octx.putImageData(img, 0, 0)
  return out
}

/**
 * @param {import('three').Material} m
 */
function isPbrCapable(m) {
  return !!(m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial))
}

/**
 * `computeTangents` 需要索引；OBJ 等非索引三角列表补顺序索引 0..n-1。
 * @param {import('three').BufferGeometry} geo
 */
function ensureTriangleListIndex(geo) {
  if (geo.getIndex()) return
  const pos = geo.getAttribute('position')
  const uv = geo.getAttribute('uv')
  if (!pos || !uv || pos.count !== uv.count) return
  if (pos.count % 3 !== 0) return
  const n = pos.count
  const idx = new Uint32Array(n)
  for (let i = 0; i < n; i++) idx[i] = i
  geo.setIndex(new THREE.BufferAttribute(idx, 1))
}

/**
 * OBJ/MTL 等常为 Phong/Lambert/Basic：带 map 时转为 Standard 再补 PBR 贴图。
 * @param {import('three').Material | null | undefined} m
 * @returns {import('three').Material | null | undefined}
 */
function convertToStandardForPbr(m) {
  if (!m || isPbrCapable(m)) return m
  if (!m.map?.isTexture) return m

  if (
    m.isMeshPhongMaterial ||
    m.isMeshLambertMaterial ||
    m.isMeshBasicMaterial ||
    m.isMeshToonMaterial
  ) {
    const std = new THREE.MeshStandardMaterial()
    std.name = m.name
    std.map = m.map
    std.lightMap = m.lightMap
    std.lightMapIntensity = m.lightMapIntensity ?? 1
    std.aoMap = m.aoMap
    std.aoMapIntensity = m.aoMapIntensity ?? 1
    if (m.emissive) std.emissive.copy(m.emissive)
    std.emissiveMap = m.emissiveMap ?? null
    std.emissiveIntensity = m.emissiveIntensity ?? 1
    std.bumpMap = m.bumpMap ?? null
    std.bumpScale = m.bumpScale ?? 1
    std.normalMap = m.normalMap ?? null
    std.normalMapType = m.normalMapType ?? THREE.TangentSpaceNormalMap
    std.normalScale = m.normalScale?.clone?.() ?? new THREE.Vector2(1, 1)
    std.displacementMap = m.displacementMap ?? null
    std.displacementScale = m.displacementScale ?? 1
    std.displacementBias = m.displacementBias ?? 0
    std.alphaMap = m.alphaMap ?? null
    std.envMap = m.envMap ?? null
    std.envMapIntensity = m.envMapIntensity ?? 1
    std.color = m.color?.clone?.() ?? new THREE.Color(0xffffff)
    std.side = m.side
    std.transparent = m.transparent
    std.opacity = m.opacity
    std.alphaTest = m.alphaTest ?? 0
    std.depthTest = m.depthTest
    std.depthWrite = m.depthWrite
    std.vertexColors = !!m.vertexColors
    std.fog = m.fog
    std.wireframe = !!m.wireframe

    if (m.isMeshPhongMaterial) {
      const sh = Math.max(0, Math.min(1000, m.shininess ?? 30))
      std.roughness = Math.min(1, Math.max(0.04, 1 - Math.log10(1 + sh) / 3))
      const spec = m.specular
      const avg = spec ? (spec.r + spec.g + spec.b) / 3 : 0
      std.metalness = Math.min(0.45, avg * 0.25)
    } else {
      std.roughness = 0.88
      std.metalness = 0
    }

    m.dispose()
    return std
  }

  return m
}

/**
 * 对场景内 MeshStandard / Physical：用已有 `map` 仅**补充缺失**的 roughness / metalness / normal 贴图（Canvas 生成）。
 * @param {import('three').Object3D} root
 * @param {{ fromSingle?: boolean, maxTextureSize?: number }} opts
 * @returns {{
 *   materialsTouched: number,
 *   materialsConverted: number,
 *   roughnessAdded: number,
 *   normalAdded: number,
 *   geometriesTangents: number,
 *   skipped: string[],
 * }}
 */
export function supplementPbrFromSingleMap(root, opts = {}) {
  const fromSingle = opts.fromSingle !== false
  const maxTextureSize = Math.min(4096, Math.max(256, Number(opts.maxTextureSize) || 2048))

  const stats = {
    materialsTouched: 0,
    materialsConverted: 0,
    roughnessAdded: 0,
    normalAdded: 0,
    geometriesTangents: 0,
    skipped: /** @type {string[]} */ ([]),
  }

  if (!fromSingle || !root) return stats

  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    const geo = obj.geometry
    if (!geo?.isBufferGeometry) return
    const meshLabel = obj.name || obj.uuid?.slice(0, 8) || 'mesh'

    let mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (let mi = 0; mi < mats.length; mi++) {
      const nm = convertToStandardForPbr(mats[mi])
      if (nm !== mats[mi]) {
        mats[mi] = nm
        stats.materialsConverted++
        if (Array.isArray(obj.material)) obj.material[mi] = nm
        else obj.material = nm
      }
    }
    mats = Array.isArray(obj.material) ? obj.material : [obj.material]

    let willAddNormal = false
    for (const m of mats) {
      if (!isPbrCapable(m) || !m.map) continue
      if (m.normalMap) continue
      if (geo.getAttribute('uv')) willAddNormal = true
    }

    let tangentsOk = false
    if (willAddNormal) {
      try {
        if (!geo.getAttribute('normal')) geo.computeVertexNormals()
        ensureTriangleListIndex(geo)
        geo.computeTangents()
        tangentsOk = true
        stats.geometriesTangents++
      } catch (e) {
        stats.skipped.push(`${meshLabel}: 切线 ${e?.message || String(e)}`)
      }
    }

    const canvasByTexUuid = new Map()

    for (let mi = 0; mi < mats.length; mi++) {
      const m = mats[mi]
      if (!isPbrCapable(m)) {
        stats.skipped.push(
          `${meshLabel}[${mi}]: 材质类型 ${m?.type || '?'}（仅 Standard / Physical 或由 Phong/Lambert/Basic/Toon 带 map 转换）`,
        )
        continue
      }
      const map = m.map
      if (!map?.isTexture) {
        stats.skipped.push(`${meshLabel}[${mi}]: 无 map`)
        continue
      }

      let canvas = canvasByTexUuid.get(map.uuid)
      if (!canvas) {
        canvas = textureToReadableCanvas(map, maxTextureSize)
        if (canvas) canvasByTexUuid.set(map.uuid, canvas)
      }
      if (!canvas) {
        stats.skipped.push(`${meshLabel}[${mi}]: map 不可绘制（未就绪或压缩/非常规源）`)
        continue
      }

      let changed = false

      if (m.roughnessMap?.userData?.[INF_TAG]) disposeInferredSlot(m, 'roughnessMap')
      if (!m.roughnessMap) {
        const rc = buildRoughnessCanvas(canvas)
        const tex = new THREE.CanvasTexture(rc)
        copyTextureRepeatParams(tex, map)
        tex.flipY = map.flipY
        tex.colorSpace = THREE.NoColorSpace
        markInferred(tex)
        applyTextureColorSpaceForMaterialSlot(tex, 'roughnessMap')
        tex.needsUpdate = true
        m.roughnessMap = tex
        m.roughness = 1
        stats.roughnessAdded++
        changed = true
      }

      if (m.normalMap?.userData?.[INF_TAG]) disposeInferredSlot(m, 'normalMap')
      if (!m.normalMap && tangentsOk) {
        const nc = buildNormalCanvasFromAlbedo(canvas)
        const ntex = new THREE.CanvasTexture(nc)
        copyTextureRepeatParams(ntex, map)
        ntex.flipY = map.flipY
        ntex.colorSpace = THREE.NoColorSpace
        markInferred(ntex)
        applyTextureColorSpaceForMaterialSlot(ntex, 'normalMap')
        ntex.needsUpdate = true
        m.normalMap = ntex
        m.normalMapType = THREE.TangentSpaceNormalMap
        stats.normalAdded++
        changed = true
      }

      if (changed) {
        m.needsUpdate = true
        stats.materialsTouched++
      }
    }

    if (tangentsOk) {
      syncStandardMaterialsForNormalMap(obj)
      syncMaterialsVertexTangentsFromGeometry(obj)
    }
  })

  return stats
}
