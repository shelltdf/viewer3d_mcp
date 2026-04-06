const SCENE_SEC = 'sec-scene'
const MAT_SEC = 'sec-materials'
const TEX_SEC = 'sec-textures'
const ANIM_SEC = 'sec-animations'

function collectTexturesFromMaterial(mat, texSeen) {
  if (!mat) return
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
    const t = mat[k]
    if (t && t.isTexture && !texSeen.has(t.uuid)) texSeen.set(t.uuid, t)
  }
}

/**
 * 场景树 + 材质 + 贴图 + 动画 扁平大纲（用于 outliner）。
 * @param {import('three').Object3D | null} root
 * @param {{ clips?: import('three').AnimationClip[] }} opts
 */
export function buildRichOutline(root, { clips = [] } = {}) {
  const items = []

  items.push({
    uuid: SCENE_SEC,
    parentUuid: '',
    depth: 0,
    label: '场景 (0)',
    hasChildren: true,
    category: 'section',
    refType: 'none',
  })

  let sceneObjectCount = 0
  const walkScene = (obj, parentUuid) => {
    sceneObjectCount += 1
    const label = obj.name ? `${obj.name} (${obj.type})` : obj.type
    const parentItem = items.find((x) => x.uuid === parentUuid)
    const depth = parentItem ? parentItem.depth + 1 : 1
    items.push({
      uuid: obj.uuid,
      parentUuid,
      depth,
      label,
      hasChildren: !!obj.children?.length,
      category: 'scene',
      refType: 'object3d',
      refId: obj.uuid,
    })
    for (const c of obj.children) walkScene(c, obj.uuid)
  }

  if (root) walkScene(root, SCENE_SEC)
  const secScene = items.find((i) => i.uuid === SCENE_SEC)
  if (secScene) {
    secScene.label = `场景 (${sceneObjectCount})`
    secScene.hasChildren = sceneObjectCount > 0
  }

  const matSeen = new Map()
  const texSeen = new Map()
  root?.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m) continue
      if (!matSeen.has(m.uuid)) matSeen.set(m.uuid, m)
      collectTexturesFromMaterial(m, texSeen)
    }
  })

  items.push({
    uuid: MAT_SEC,
    parentUuid: '',
    depth: 0,
    label: `材质 (${matSeen.size})`,
    hasChildren: matSeen.size > 0,
    category: 'section',
    refType: 'none',
  })
  for (const [uuid, mat] of matSeen) {
    items.push({
      uuid: `mat:${uuid}`,
      parentUuid: MAT_SEC,
      depth: 1,
      label: mat.name ? `${mat.name} (${mat.type})` : mat.type || uuid.slice(0, 8),
      hasChildren: false,
      category: 'material',
      refType: 'material',
      refId: uuid,
    })
  }

  items.push({
    uuid: TEX_SEC,
    parentUuid: '',
    depth: 0,
    label: `贴图 (${texSeen.size})`,
    hasChildren: texSeen.size > 0,
    category: 'section',
    refType: 'none',
  })
  for (const [uuid, tex] of texSeen) {
    const img = tex.image
    const nameHint =
      tex.name ||
      (img && img.src && typeof img.src === 'string' ? img.src.split('/').pop() : '') ||
      uuid.slice(0, 8)
    items.push({
      uuid: `tex:${uuid}`,
      parentUuid: TEX_SEC,
      depth: 1,
      label: `贴图 · ${nameHint}`,
      hasChildren: false,
      category: 'texture',
      refType: 'texture',
      refId: uuid,
    })
  }

  items.push({
    uuid: ANIM_SEC,
    parentUuid: '',
    depth: 0,
    label: `动画 (${clips.length})`,
    hasChildren: clips.length > 0,
    category: 'section',
    refType: 'none',
  })
  clips.forEach((clip, i) => {
    items.push({
      uuid: `anim:${i}`,
      parentUuid: ANIM_SEC,
      depth: 1,
      label: clip.name || `AnimationClip ${i}`,
      hasChildren: false,
      category: 'animation',
      refType: 'clip',
      refId: i,
    })
  })

  return items
}

/** @deprecated 使用 buildRichOutline */
export function buildOutlineItems(root) {
  return buildRichOutline(root, { clips: [] })
}
