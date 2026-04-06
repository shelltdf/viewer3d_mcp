import { estimateGeometryBytes } from './memoryEstimate.js'
import { getTextureMemoryBreakdown } from './textureMemory.js'

function matTexturesMemory(m) {
  if (!m) return { gpu: 0, raw: 0, bc7: 0 }
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
  let gpu = 0
  let raw = 0
  let bc7 = 0
  const seen = new Set()
  for (const k of keys) {
    const t = m[k]
    if (!t?.isTexture || seen.has(t.uuid)) continue
    seen.add(t.uuid)
    const b = getTextureMemoryBreakdown(t)
    gpu += b.gpuCurrent
    raw += b.rawRGBA
    bc7 += b.compressedBC7Like
  }
  return { gpu, raw, bc7 }
}

/**
 * @param {import('three').Mesh | import('three').SkinnedMesh} mesh
 */
export function getMeshMaterialsMemoryTable(mesh) {
  if (!mesh?.material) return { geometryBytes: 0, materials: [] }
  const geoBytes = mesh.geometry ? estimateGeometryBytes(mesh.geometry) : 0
  const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const materials = mats.map((m, i) => {
    if (!m)
      return {
        slot: i,
        name: '—',
        type: '—',
        uuid: '',
        texGpu: 0,
        texRaw: 0,
        texBc7: 0,
      }
    const tm = matTexturesMemory(m)
    return {
      slot: i,
      name: m.name || m.type || `材质 ${i}`,
      type: m.type,
      uuid: m.uuid,
      texGpu: tm.gpu,
      texRaw: tm.raw,
      texBc7: tm.bc7,
    }
  })
  return { geometryBytes: geoBytes, materials }
}
