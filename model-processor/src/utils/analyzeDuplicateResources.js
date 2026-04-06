import { textureContentIdentityKey, refineTextureDuplicateClusters } from './textureContentHash.js'
import { contentHashDualFromString } from './hashString.js'

/** 材质上参与去重/收集的贴图槽位（与 MTLLoader / glTF 常用槽一致） */
export const MATERIAL_MAP_KEYS = [
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

/** 浮点顶点属性比对公差：effectiveTol = ABS + REL * max(1, |v|) 后量化 */
export const MESH_GEOMETRY_ABS_EPS = 1e-5
export const MESH_GEOMETRY_REL_EPS = 1e-5

function tolQuant(v) {
  const t = MESH_GEOMETRY_ABS_EPS + MESH_GEOMETRY_REL_EPS * Math.max(1, Math.abs(v))
  return Math.round(v / t)
}

function fnv1a32Buffer(buffer, byteOffset, byteLength) {
  const u8 = new Uint8Array(buffer, byteOffset, byteLength)
  let h = 2166136261 >>> 0
  for (let i = 0; i < u8.length; i++) {
    h ^= u8[i]
    h = Math.imul(h, 16777619) >>> 0
  }
  return h >>> 0
}

/** 整数索引等：精确哈希 */
function attrPartExact(attr) {
  if (!attr?.array) return 'null'
  const arr = attr.array
  const hash = fnv1a32Buffer(arr.buffer, arr.byteOffset, arr.byteLength)
  return `${attr.itemSize}:${attr.normalized ? 1 : 0}:${attr.count}:${hash.toString(16)}`
}

/** Float32/64：公差量化后再哈希，避免细微浮点差导致无法识别重复 */
function attrTolerancePart(attr) {
  if (!attr?.array) return 'null'
  const arr = attr.array
  const ctor = arr.constructor
  if (ctor === Float32Array || ctor === Float64Array) {
    let h = 2166136261 >>> 0
    for (let i = 0; i < arr.length; i++) {
      const q = tolQuant(arr[i])
      h ^= q & 0xff
      h = Math.imul(h, 16777619) >>> 0
      h ^= (q >>> 8) & 0xff
      h = Math.imul(h, 16777619) >>> 0
      h ^= (q >>> 16) & 0xff
      h = Math.imul(h, 16777619) >>> 0
      h ^= (q >>> 24) & 0xff
      h = Math.imul(h, 16777619) >>> 0
    }
    return `${attr.itemSize}:${attr.normalized ? 1 : 0}:${attr.count}:${h.toString(16)}`
  }
  return attrPartExact(attr)
}

/**
 * 几何内容指纹（公差版）：与 UUID/名称无关。
 * @param {import('three').BufferGeometry | null | undefined} geo
 */
export function geometryContentKey(geo) {
  if (!geo?.isBufferGeometry) return 'invalid'
  const parts = []
  if (geo.index) parts.push(`ix:${attrPartExact(geo.index)}`)
  const names = Object.keys(geo.attributes).sort()
  for (const n of names) {
    parts.push(`a:${n}:${attrTolerancePart(geo.attributes[n])}`)
  }
  if (geo.morphAttributes && Object.keys(geo.morphAttributes).length) {
    for (const name of Object.keys(geo.morphAttributes).sort()) {
      const arr = geo.morphAttributes[name]
      for (let i = 0; i < arr.length; i++) {
        parts.push(`m:${name}:${i}:${attrTolerancePart(arr[i])}`)
      }
    }
  }
  if (geo.groups?.length) {
    parts.push(`g:${geo.groups.map((x) => `${x.start}/${x.count}/${x.materialIndex ?? 0}`).join(';')}`)
  }
  const dr = geo.drawRange
  if (dr && (dr.start !== 0 || dr.count !== Infinity)) {
    parts.push(`dr:${dr.start},${dr.count}`)
  }
  return parts.join('|')
}

function fingerprint32(str) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/**
 * 材质可合并：参数一致（浮点保留 6 位）+ 各槽贴图「内容身份键」（像素/块哈希或同源 URL，与采样无关）。
 * @param {import('three').Material} m
 */
export function materialMergeKey(m) {
  if (!m) return 'null'
  const skip = new Set(['uuid', 'name', 'id', 'version', 'userData'])
  const entries = []
  for (const k of Object.keys(m).sort()) {
    if (skip.has(k)) continue
    const v = m[k]
    if (typeof v === 'function') continue
    if (k === 'program') continue
    if (v?.isTexture) {
      entries.push([k, v ? textureContentIdentityKey(v) : ''])
      continue
    }
    if (typeof v === 'number') {
      const nv = Number.isInteger(v) ? v : Math.round(v * 1e6) / 1e6
      entries.push([k, nv])
      continue
    }
    if (v == null || typeof v === 'boolean' || typeof v === 'string') {
      entries.push([k, v])
      continue
    }
    if (v?.isColor) {
      const hx =
        typeof v.getHexString === 'function'
          ? v.getHexString()
          : Number(v.getHex?.() ?? 0).toString(16).padStart(6, '0')
      entries.push([k, `#${hx}`])
    } else if (v?.isVector2)
      entries.push([k, `v2:${Math.round(v.x * 1e6) / 1e6},${Math.round(v.y * 1e6) / 1e6}`])
    else if (v?.isVector3)
      entries.push([
        k,
        `v3:${Math.round(v.x * 1e6) / 1e6},${Math.round(v.y * 1e6) / 1e6},${Math.round(v.z * 1e6) / 1e6}`,
      ])
    else if (v?.isVector4)
      entries.push([
        k,
        `v4:${Math.round(v.x * 1e6) / 1e6},${Math.round(v.y * 1e6) / 1e6},${Math.round(v.z * 1e6) / 1e6},${Math.round(v.w * 1e6) / 1e6}`,
      ])
    else if (v?.isMatrix3) entries.push([k, `m3:${v.elements.join(',')}`])
    else if (v?.isMatrix4) entries.push([k, `m4:${v.elements.join(',')}`])
  }
  return `${m.type}|${JSON.stringify(entries)}`
}

/**
 * 与属性面板 `getObject3DContentHashDisplay` 使用同一规则（须保持同步）。
 * @param {import('three').Object3D} obj
 */
function object3dInspectorHashKey(obj) {
  if (!obj) return ''
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
 * @param {import('three').Object3D | null} root
 */
export function analyzeDuplicateResources(root) {
  const textureBuckets = new Map()
  const materialBuckets = new Map()
  const objectHashBuckets = new Map()
  /** 场景内 Mesh 实际引用的唯一 Texture / Material（按 UUID），用于向用户解释「有 N 张贴图但仍无可合并分组」。 */
  const uniqueTextureUuids = new Set()
  const uniqueMaterialUuids = new Set()
  let meshDrawableCount = 0

  root?.traverse((obj) => {
    const hk = object3dInspectorHashKey(obj)
    if (!hk) return
    if (!objectHashBuckets.has(hk)) objectHashBuckets.set(hk, [])
    objectHashBuckets.get(hk).push({
      uuid: obj.uuid,
      label: obj.name || obj.type || obj.uuid.slice(0, 8),
      object: obj,
    })

    if ((!obj.isMesh && !obj.isSkinnedMesh) || !obj.geometry) return

    meshDrawableCount += 1
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    mats.forEach((mat, slotIndex) => {
      if (!mat) return
      uniqueMaterialUuids.add(mat.uuid)
      const mk = materialMergeKey(mat)
      if (!materialBuckets.has(mk)) materialBuckets.set(mk, [])
      materialBuckets.get(mk).push({
        uuid: mat.uuid,
        label: mat.name || mat.type || mat.uuid.slice(0, 8),
        material: mat,
        meshName: obj.name,
        slot: Array.isArray(obj.material) ? `slot ${slotIndex}` : 'material',
      })

      for (const k of MATERIAL_MAP_KEYS) {
        const tex = mat[k]
        if (!tex?.isTexture) continue
        uniqueTextureUuids.add(tex.uuid)
        const tk = textureContentIdentityKey(tex)
        if (!textureBuckets.has(tk)) textureBuckets.set(tk, [])
        textureBuckets.get(tk).push({
          uuid: tex.uuid,
          label: `${k}: ${tex.name || tex.uuid.slice(0, 8)}`,
          slot: k,
          meshName: obj.name,
          texture: tex,
        })
      }
    })
  })

  const textureGroups = []
  let ti = 0
  for (const [, arr] of textureBuckets) {
    const texturesFromBucket = [...new Map(arr.map((x) => [x.texture.uuid, x.texture])).values()]
    if (texturesFromBucket.length < 2) continue

    const clusters = refineTextureDuplicateClusters(texturesFromBucket)
    for (const refined of clusters) {
      if (!refined || refined.textures.length < 2) continue

      const keepSet = new Set(refined.textures.map((t) => t.uuid))
      const items = arr.filter((x) => keepSet.has(x.texture.uuid))
      const textures = refined.textures

      const id = `tex-${ti++}`
      const pixelVerified = refined.pixelVerified
      textureGroups.push({
        id,
        pixelVerified,
        reason: pixelVerified
          ? '像素/压缩块数据：内容哈希一致且已做逐字节核对；分组与名称、UUID、采样器状态无关。可合并为单一 Texture。'
          : '同源 URL 或未读到像素时仅按资源键聚合；若可合并请确认无误（未做逐字节核对）。',
        items: items.map((x) => ({
          uuid: x.uuid,
          label: x.label,
          slot: x.slot,
          meshName: x.meshName,
        })),
        textures,
      })
    }
  }

  const materialGroups = []
  let mi = 0
  for (const [, arr] of materialBuckets) {
    const uniq = new Map()
    for (const row of arr) {
      if (!uniq.has(row.material.uuid)) uniq.set(row.material.uuid, row)
    }
    const materials = [...uniq.values()].map((r) => r.material)
    if (materials.length < 2) continue
    const id = `mat-${mi++}`
    materialGroups.push({
      id,
      reason:
        '材质参数一致（浮点六位对齐）、各槽贴图「内容身份」一致（像素哈希/同源 URL）；与材质名、UUID、贴图采样设置无关。',
      items: [...uniq.values()].map((x) => ({
        uuid: x.uuid,
        label: `${x.label}（${x.meshName || 'mesh'} · ${x.slot}）`,
      })),
      materials,
    })
  }

  const objectGroups = []
  let gi = 0
  for (const [hk, items] of objectHashBuckets) {
    if (items.length < 2) continue
    const id = `obj-${gi++}`
    objectGroups.push({
      id,
      displayHash: hk,
      fingerprint: fingerprint32(hk.replace(/\s/g, '')),
      reason:
        '与右侧属性面板「哈希值」规则一致：Mesh 为几何（公差指纹）+ 材质内容键；其它节点为变换与可见性等标志。合并将移除多余节点（含其子树）；请先确认结构等价。',
      items: items.map((x) => ({
        uuid: x.uuid,
        label: x.label,
        object: x.object,
      })),
    })
  }

  return {
    textureGroups,
    materialGroups,
    meshGroups: objectGroups,
    objectGroups,
    sceneResourceCounts: {
      meshes: meshDrawableCount,
      uniqueTextures: uniqueTextureUuids.size,
      uniqueMaterials: uniqueMaterialUuids.size,
    },
  }
}

function textureReferencedByRoot(r, tex) {
  let found = false
  r?.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m) continue
      for (const k of MATERIAL_MAP_KEYS) {
        if (m[k] === tex) found = true
      }
    }
  })
  return found
}

function materialReferencedByRoot(r, mat) {
  let found = false
  r?.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (m === mat) found = true
    }
  })
  return found
}

/**
 * @param {import('three').Object3D} root
 * @param {import('three').Texture[]} textures
 * @param {string} keepUuid
 * @param {import('three').Object3D[]} [otherRoots] 例如「处理前」场景：深度克隆后仍可能与「处理后」共享贴图对象，禁对此根仍引用者 dispose，避免误伤对照侧
 */
export function mergeTextureGroup(root, textures, keepUuid, otherRoots = []) {
  const keep = textures.find((t) => t.uuid === keepUuid) || textures[0]
  const remove = textures.filter((t) => t.uuid !== keep.uuid)
  if (!remove.length) return { merged: 0 }

  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m) continue
      let changed = false
      for (const k of MATERIAL_MAP_KEYS) {
        const tex = m[k]
        if (tex && remove.some((t) => t.uuid === tex.uuid)) {
          m[k] = keep
          changed = true
        }
      }
      if (changed) m.needsUpdate = true
    }
  })

  const preserve = Array.isArray(otherRoots) ? otherRoots.filter(Boolean) : []
  for (const t of remove) {
    const stillUsedElsewhere = preserve.some((r) => textureReferencedByRoot(r, t))
    if (stillUsedElsewhere) continue
    try {
      t.dispose()
    } catch {
      /* ignore */
    }
  }
  return { merged: remove.length }
}

/**
 * @param {import('three').Object3D} root
 * @param {import('three').Material[]} materials
 * @param {string} keepUuid
 * @param {import('three').Object3D[]} [otherRoots] 同上，避免共享 Material 时在另一侧仍使用却被 dispose
 */
export function mergeMaterialGroup(root, materials, keepUuid, otherRoots = []) {
  const keep = materials.find((m) => m.uuid === keepUuid) || materials[0]
  const remove = materials.filter((m) => m.uuid !== keep.uuid)
  if (!remove.length) return { merged: 0 }

  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    let changed = false
    const next = mats.map((m) => {
      const r = remove.find((x) => x.uuid === m?.uuid)
      if (r) {
        changed = true
        return keep
      }
      return m
    })
    if (changed) obj.material = Array.isArray(obj.material) ? next : next[0]
  })

  const preserve = Array.isArray(otherRoots) ? otherRoots.filter(Boolean) : []
  for (const m of remove) {
    const stillUsedElsewhere = preserve.some((r) => materialReferencedByRoot(r, m))
    if (stillUsedElsewhere) continue
    try {
      m.dispose()
    } catch {
      /* ignore */
    }
  }
  return { merged: remove.length }
}

/**
 * @param {string} keepUuid
 * @param {Array<{ object: import('three').Object3D }>} items
 */
export function mergeMeshInstances(keepUuid, items) {
  const keep = items.find((x) => x.object.uuid === keepUuid)?.object || items[0].object
  const remove = items.filter((x) => x.object.uuid !== keep.uuid).map((x) => x.object)
  for (const obj of remove) {
    obj.parent?.remove(obj)
  }
  return { removed: remove.length }
}
