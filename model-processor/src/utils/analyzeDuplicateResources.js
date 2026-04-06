const MAP_KEYS = [
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
 * 贴图分组键：优先同一 image 对象；否则用尺寸+名称+格式粗分组（可合并为共享贴图对象）。
 * @param {import('three').Texture} t
 */
export function textureMergeKey(t) {
  if (!t?.isTexture) return `invalid:${t?.uuid || '?'}`
  const img = t.image
  if (img && typeof img === 'object') {
    if (img.width && img.height) {
      const id =
        img.uuid ||
        (typeof img.src === 'string' ? img.src : '') ||
        (typeof img.currentSrc === 'string' ? img.currentSrc : '') ||
        ''
      return `img:${img.width}x${img.height}:${id || 'ref:' + (img.constructor?.name || 'Image')}`
    }
  }
  const w = img?.width ?? 0
  const h = img?.height ?? 0
  return `tex:${w}x${h}:${t.name || ''}:${t.format ?? ''}:${t.uuid?.slice?.(0, 8) ?? ''}`
}

/**
 * 材质可合并：类型与关键标量/颜色一致，且各槽位贴图 uuid 一致。
 * @param {import('three').Material} m
 */
export function materialMergeKey(m) {
  if (!m) return 'null'
  const pick = (k) => {
    const v = m[k]
    if (v == null) return null
    if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v
    if (v?.isColor) return v.getHexString?.() ?? String(v)
    if (v?.isVector2) return `${v.x},${v.y}`
    if (v?.isVector3) return `${v.x},${v.y},${v.z}`
    return null
  }
  const texIds = {}
  for (const k of MAP_KEYS) {
    const tex = m[k]
    texIds[k] = tex?.isTexture ? tex.uuid : ''
  }
  const keys = [
    m.type,
    pick('opacity'),
    pick('transparent'),
    pick('side'),
    pick('depthTest'),
    pick('depthWrite'),
    pick('metalness'),
    pick('roughness'),
    pick('color'),
    pick('emissive'),
    JSON.stringify(texIds),
  ]
  return keys.join('|')
}

/**
 * @param {import('three').Object3D | null} root
 * @returns {{
 *   textureGroups: Array<{ id: string, reason: string, items: Array<{ uuid: string, label: string, slot?: string, meshName?: string }>, textures: import('three').Texture[] }>,
 *   materialGroups: Array<{ id: string, reason: string, items: Array<{ uuid: string, label: string }>, materials: import('three').Material[] }>,
 *   meshGroups: Array<{ id: string, reason: string, items: Array<{ uuid: string, label: string, object: import('three').Object3D }>, geometryUuid: string }>,
 * }}
 */
export function analyzeDuplicateResources(root) {
  const textureBuckets = new Map()
  const materialBuckets = new Map()
  const geometryBuckets = new Map()

  root?.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return

    const geo = obj.geometry
    if (geo) {
      const gid = geo.uuid
      if (!geometryBuckets.has(gid)) geometryBuckets.set(gid, [])
      geometryBuckets.get(gid).push({
        uuid: obj.uuid,
        label: obj.name || obj.type || obj.uuid.slice(0, 8),
        object: obj,
      })
    }

    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    mats.forEach((mat, slotIndex) => {
      if (!mat) return
      const mk = materialMergeKey(mat)
      if (!materialBuckets.has(mk)) materialBuckets.set(mk, [])
      materialBuckets.get(mk).push({
        uuid: mat.uuid,
        label: mat.name || mat.type || mat.uuid.slice(0, 8),
        material: mat,
        meshName: obj.name,
        slot: Array.isArray(obj.material) ? `slot ${slotIndex}` : 'material',
      })

      for (const k of MAP_KEYS) {
        const tex = mat[k]
        if (!tex?.isTexture) continue
        const tk = textureMergeKey(tex)
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
    if (arr.length < 2) continue
    const textures = [...new Map(arr.map((x) => [x.texture.uuid, x.texture])).values()]
    if (textures.length < 2) continue
    const id = `tex-${ti++}`
    textureGroups.push({
      id,
      reason:
        '多个 Texture 对象引用相同或等价的图像数据/尺寸，可合并为单一贴图并统一材质引用，减少 GPU 绑定与序列化冗余。',
      items: arr.map((x) => ({
        uuid: x.uuid,
        label: x.label,
        slot: x.slot,
        meshName: x.meshName,
      })),
      textures,
    })
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
      reason: '材质参数与各贴图槽 uuid 一致，可合并为同一 Material 实例并复用。',
      items: [...uniq.values()].map((x) => ({
        uuid: x.uuid,
        label: `${x.label}（${x.meshName || 'mesh'} · ${x.slot}）`,
      })),
      materials,
    })
  }

  const meshGroups = []
  let gi = 0
  for (const [geoUuid, items] of geometryBuckets) {
    if (items.length < 2) continue
    const id = `mesh-${gi++}`
    meshGroups.push({
      id,
      geometryUuid: geoUuid,
      reason:
        '多个 Mesh 共享同一 BufferGeometry（相同 geometry.uuid）。可删除多余节点仅保留一个，或后续做 GPU Instancing（合并绘制调用）。',
      items: items.map((x) => ({
        uuid: x.uuid,
        label: x.label,
        object: x.object,
      })),
    })
  }

  return { textureGroups, materialGroups, meshGroups }
}

/**
 * @param {import('three').Object3D} root
 * @param {import('three').Texture[]} textures
 * @param {string} keepUuid
 */
export function mergeTextureGroup(root, textures, keepUuid) {
  const keep = textures.find((t) => t.uuid === keepUuid) || textures[0]
  const remove = textures.filter((t) => t.uuid !== keep.uuid)
  if (!remove.length) return { merged: 0 }

  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m) continue
      let changed = false
      for (const k of MAP_KEYS) {
        const tex = m[k]
        if (tex && remove.some((t) => t.uuid === tex.uuid)) {
          m[k] = keep
          changed = true
        }
      }
      if (changed) m.needsUpdate = true
    }
  })

  for (const t of remove) {
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
 */
export function mergeMaterialGroup(root, materials, keepUuid) {
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

  for (const m of remove) {
    try {
      m.dispose()
    } catch {
      /* ignore */
    }
  }
  return { merged: remove.length }
}

/**
 * 删除除 keep 外的重复 Mesh 节点（共享几何）。不 dispose 几何；材质仅当无引用时由调用方后续处理。
 * @param {string} keepUuid
 * @param {Array<{ object: import('three').Object3D }>} items
 */
export function mergeMeshInstances(keepUuid, items) {
  const keep = items.find((x) => x.object.uuid === keepUuid)?.object || items[0].object
  const remove = items.filter((x) => x.object.uuid !== keep.uuid).map((x) => x.object)
  for (const obj of remove) {
    obj.parent?.remove(obj)
    /** 不 dispose 材质：可能与保留 Mesh 共享；几何与保留 Mesh 相同，亦不 dispose */
  }
  return { removed: remove.length }
}
