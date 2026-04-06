/**
 * @param {import('three').Object3D | null} root
 * @param {string} uuid
 */
export function findObject3DByUuid(root, uuid) {
  if (!root || !uuid) return null
  let found = null
  root.traverse((o) => {
    if (o.uuid === uuid) found = o
  })
  return found
}

/**
 * @param {import('three').Object3D | null} root
 * @param {string} materialUuid
 */
export function findMaterialByUuid(root, materialUuid) {
  if (!root || !materialUuid) return null
  let found = null
  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (m && m.uuid === materialUuid) found = m
    }
  })
  return found
}

/**
 * @param {import('three').Object3D | null} root
 * @param {string} textureUuid
 */
export function findTextureByUuid(root, textureUuid) {
  if (!root || !textureUuid) return null
  let found = null
  root.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m) continue
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
        if (t && t.isTexture && t.uuid === textureUuid) found = t
      }
    }
  })
  return found
}
