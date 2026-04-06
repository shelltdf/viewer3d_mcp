import { estimateTextureBytes } from './memoryEstimate.js'

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
 * @param {import('three').Object3D | null} root
 * @returns {{ uuid: string, label: string, bytes: number }[]}
 */
export function collectUniqueTexturesForScene(root) {
  const seen = new Map()
  root?.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    for (const m of mats) {
      if (!m) continue
      for (const k of MAP_KEYS) {
        const t = m[k]
        if (t?.isTexture && !seen.has(t.uuid)) {
          const label =
            t.name ||
            (t.image && t.image.src && typeof t.image.src === 'string'
              ? t.image.src.split('/').pop()
              : k) ||
            t.uuid.slice(0, 8)
          seen.set(t.uuid, {
            uuid: t.uuid,
            label: `${k}: ${label}`,
            bytes: estimateTextureBytes(t),
            texture: t,
            slot: k,
          })
        }
      }
    }
  })
  return Array.from(seen.values()).sort((a, b) => b.bytes - a.bytes)
}
