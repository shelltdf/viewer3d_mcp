import * as THREE from 'three'
import {
  SkeletonHelper,
  ShaderChunk,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
} from 'three'
import { filterAttributeKeysForVertexDebugShader, vertexAttrDisplayName } from './vertexAttrNaming.js'
import { MATERIAL_MAP_KEYS } from './analyzeDuplicateResources.js'

export { vertexAttrDisplayName }
/** 贴图下拉「单独槽预览」选项（与材质槽名一致） */
export { MATERIAL_MAP_KEYS as TEXTURE_PREVIEW_SLOT_KEYS }

/** @type {import('three').MeshBasicMaterial | null} */
let _meshPointsHideMaterial = null

function getMeshPointsHideMaterial() {
  if (!_meshPointsHideMaterial) {
    _meshPointsHideMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      depthWrite: false,
      depthTest: false,
      colorWrite: false,
    })
    _meshPointsHideMaterial.userData.__workbenchMeshPointsHide = true
  }
  return _meshPointsHideMaterial
}

function isWorkbenchMeshPointsHideMaterial(m) {
  return !!(m && m.userData?.__workbenchMeshPointsHide)
}

/**
 * 仅用于显示某一贴图槽（`map` / `normalMap` …）；无贴图时占位深灰。
 * @param {import('three').Material | null} mat
 * @param {string} slotKey
 */
function buildSingleSlotPreviewMaterial(mat, slotKey) {
  if (!mat) return mat
  const tex = mat[slotKey]
  if (!tex?.isTexture) {
    return new THREE.MeshBasicMaterial({ color: 0x1e2229, side: THREE.DoubleSide, toneMapped: false })
  }
  if (slotKey === 'envMap') {
    return new THREE.MeshBasicMaterial({ envMap: tex, side: THREE.DoubleSide, toneMapped: false })
  }
  return new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide, toneMapped: false })
}

/**
 * @param {import('three').Object3D | null} root
 */
export function collectVertexAttributeNamesForDebug(root) {
  return filterAttributeKeysForVertexDebugShader(collectVertexAttributeNames(root))
}

/**
 * @typedef {{
 *   geometryMode: string,
 *   lightingMode: string,
 *   textureMode: string,
 *   materialMode: string,
 *   skeletonMode: string,
 *   vertexAttrMode?: string
 * }} ViewportViewState
 */

/**
 * @param {import('three').Object3D | null} root
 * @returns {string[]}
 */
export function collectVertexAttributeNames(root) {
  const set = new Set()
  if (!root) return []
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return
    const g = o.geometry
    if (!g?.attributes) return
    for (const k of Object.keys(g.attributes)) set.add(k)
  })
  return [...set].sort()
}

const VERTEX_ATTR_DBG_FRAG = `
varying vec3 vDbg;
void main() {
	gl_FragColor = vec4( vDbg, 1.0 );
}
`

/**
 * @param {string} name
 */
function toRgbGlsl(name) {
  const lower = name.toLowerCase()
  if (lower === 'position' || lower === 'pos')
    return 'vec3 c = fract( raw * 0.0625 + 0.5 );'
  return 'vec3 c = clamp( raw * 0.5 + 0.5, 0.0, 1.0 );'
}

/**
 * @param {string} name
 * @param {number} itemSize
 */
function builtinRawAssignNonSkinned(name, itemSize) {
  if (name === 'position') return 'vec3 raw = position;'
  if (name === 'normal') return 'vec3 raw = normal;'
  if (name === 'tangent') return 'vec3 raw = tangent.xyz;'
  if (name === 'uv' || name === 'uv2' || name === 'uv3') return `vec3 raw = vec3( ${name}, 0.0 );`
  if (name === 'color') return itemSize >= 4 ? 'vec3 raw = color.xyz;' : 'vec3 raw = color;'
  if (name === 'COLOR_0') return itemSize >= 4 ? 'vec3 raw = COLOR_0.xyz;' : 'vec3 raw = COLOR_0;'
  return ''
}

/**
 * @param {string} name
 * @param {number} itemSize
 */
function customDeclAndRaw(name, itemSize) {
  if (itemSize === 1)
    return { decl: `attribute float ${name};`, raw: `vec3 raw = vec3( ${name}, ${name}, ${name} );` }
  if (itemSize === 2)
    return { decl: `attribute vec2 ${name};`, raw: `vec3 raw = vec3( ${name}.xy, 0.0 );` }
  if (itemSize === 3) return { decl: `attribute vec3 ${name};`, raw: `vec3 raw = ${name};` }
  return { decl: `attribute vec4 ${name};`, raw: `vec3 raw = ${name}.xyz;` }
}

/**
 * @param {import('three').BufferGeometry} geometry
 * @param {string} name
 * @param {number} itemSize
 */
function buildSkinnedVertexAttrMaterial(geometry, name, itemSize) {
  /** ShaderMaterial 无 `vertexTangents` 字段；用 `defines` 触发前缀里的 `attribute vec4 tangent`。 */
  const defines =
    name === 'tangent' && !!geometry.getAttribute('tangent') ? { USE_TANGENT: '' } : {}

  /** @type {Record<string, string>} */
  const skinBuiltin = {
    position: 'vec3 raw = transformed;',
    normal: 'vec3 raw = transformedNormal;',
    tangent: 'vec3 raw = transformedTangent;',
    uv: 'vec3 raw = vec3( uv, 0.0 );',
    uv2: 'vec3 raw = vec3( uv2, 0.0 );',
    uv3: 'vec3 raw = vec3( uv3, 0.0 );',
    skinIndex: 'vec3 raw = skinIndex.xyz;',
    skinWeight: 'vec3 raw = skinWeight.xyz;',
  }

  let extraPars = 'varying vec3 vDbg;\n'
  let rawLine = ''

  if (name === 'color')
    rawLine = itemSize >= 4 ? 'vec3 raw = color.xyz;' : 'vec3 raw = color;'
  else if (name === 'COLOR_0')
    rawLine = itemSize >= 4 ? 'vec3 raw = COLOR_0.xyz;' : 'vec3 raw = COLOR_0;'
  else if (skinBuiltin[name]) rawLine = skinBuiltin[name]
  else {
    const { decl, raw } = customDeclAndRaw(name, itemSize)
    extraPars += decl + '\n'
    rawLine = raw
  }

  const beforeProject = `${rawLine}
${toRgbGlsl(name)}
vDbg = c;
`

  let vert = ShaderChunk.meshbasic_vert
  vert = vert.replace(
    '#include <skinning_pars_vertex>',
    `#include <skinning_pars_vertex>\n${extraPars}`,
  )
  vert = vert.replace('#include <project_vertex>', `${beforeProject}\n#include <project_vertex>`)

  const hasMorphPos = !!(geometry.morphAttributes && geometry.morphAttributes.position)
  const hasMorphNrm = !!(geometry.morphAttributes && geometry.morphAttributes.normal)

  return new ShaderMaterial({
    defines,
    uniforms: UniformsUtils.clone(UniformsUtils.merge([UniformsLib.common])),
    vertexShader: vert,
    fragmentShader: VERTEX_ATTR_DBG_FRAG,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
    lights: false,
    skinning: true,
    morphTargets: hasMorphPos,
    morphNormals: hasMorphNrm,
  })
}

/**
 * @param {import('three').BufferGeometry} geometry
 * @param {string} mode off | meshNormal | attr:<bufferName>
 * @param {import('three').Object3D | null} [mesh] 用于 SkinnedMesh 时走骨骼蒙皮顶点着色器
 * @returns {import('three').Material}
 */
export function buildVertexAttrDebugMaterial(geometry, mode, mesh = null) {
  if (!geometry?.isBufferGeometry) {
    return new THREE.MeshBasicMaterial({ color: 0x444444, side: THREE.DoubleSide })
  }
  if (!mode || mode === 'off') {
    return new THREE.MeshBasicMaterial({ color: 0x444444, side: THREE.DoubleSide })
  }
  if (mode === 'meshNormal') {
    const m = new THREE.MeshNormalMaterial({ flatShading: false, side: THREE.DoubleSide })
    m.skinning = !!mesh?.isSkinnedMesh
    return m
  }
  if (!mode.startsWith('attr:')) {
    return new THREE.MeshBasicMaterial({ color: 0x444444, side: THREE.DoubleSide })
  }
  const name = mode.slice(5)
  const attr = geometry.getAttribute(name)
  if (!attr) {
    return new THREE.MeshBasicMaterial({ color: 0x2a2a30, side: THREE.DoubleSide })
  }
  if ((name === 'color' || name === 'COLOR_0') && attr.itemSize >= 3) {
    const m = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      toneMapped: false,
    })
    m.skinning = !!mesh?.isSkinnedMesh
    return m
  }

  const itemSize = attr.itemSize
  if (mesh?.isSkinnedMesh) return buildSkinnedVertexAttrMaterial(geometry, name, itemSize)

  const builtinAssign = builtinRawAssignNonSkinned(name, itemSize)
  let vert
  if (builtinAssign) {
    vert = `
varying vec3 vDbg;
void main() {
	${builtinAssign}
	${toRgbGlsl(name)}
	vDbg = c;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`
  } else {
    const { decl, raw } = customDeclAndRaw(name, itemSize)
    vert = `
${decl}
varying vec3 vDbg;
void main() {
	${raw}
	${toRgbGlsl(name)}
	vDbg = c;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`
  }

  const defines = name === 'tangent' && !!geometry.getAttribute('tangent') ? { USE_TANGENT: '' } : {}

  return new ShaderMaterial({
    defines,
    vertexShader: vert,
    fragmentShader: VERTEX_ATTR_DBG_FRAG,
    side: THREE.DoubleSide,
    toneMapped: false,
    fog: false,
    lights: false,
  })
}

const saved = new WeakMap()

let uvDebugTex = null
function getUvDebugTexture() {
  if (uvDebugTex) return uvDebugTex
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const ctx = c.getContext('2d')
  if (ctx) {
    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        ctx.fillStyle = (i + j) % 2 ? '#e07070' : '#7070e0'
        ctx.fillRect(i * 32, j * 32, 32, 32)
      }
    }
  }
  uvDebugTex = new THREE.CanvasTexture(c)
  uvDebugTex.wrapS = THREE.RepeatWrapping
  uvDebugTex.wrapT = THREE.RepeatWrapping
  uvDebugTex.colorSpace = THREE.SRGBColorSpace
  return uvDebugTex
}

/**
 * @param {import('three').Scene | null} scene
 * @param {'studio' | 'soft' | 'flat'} mode
 */
export function applySceneLighting(scene, mode) {
  if (!scene?.isScene) return
  /** @type {import('three').AmbientLight | null} */
  let amb = null
  /** @type {import('three').DirectionalLight | null} */
  let dir = null
  for (const c of scene.children) {
    if (c.isAmbientLight) amb = c
    if (c.isDirectionalLight) dir = c
  }
  if (mode === 'studio') {
    if (amb) amb.intensity = 0.55
    if (dir) dir.intensity = 0.95
  } else if (mode === 'soft') {
    if (amb) amb.intensity = 0.78
    if (dir) dir.intensity = 0.42
  } else if (mode === 'flat') {
    if (amb) amb.intensity = 1.15
    if (dir) dir.intensity = 0.06
  }
}

function saveOriginal(mesh) {
  if (!saved.has(mesh)) {
    saved.set(mesh, { material: mesh.material, geometry: mesh.geometry, visible: mesh.visible })
  }
}

function restoreMaterials(root) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return
    if (o.userData?._vertexPoints) {
      const pts = o.userData._vertexPoints
      o.remove(pts)
      pts.material?.dispose?.()
      delete o.userData._vertexPoints
    }
    const st = saved.get(o)
    if (st) {
      if (typeof st.visible === 'boolean') o.visible = st.visible
      const disposeList = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of disposeList) {
        if (
          m &&
          m !== st.material &&
          typeof m.dispose === 'function' &&
          !isWorkbenchMeshPointsHideMaterial(m)
        ) {
          try {
            m.dispose()
          } catch {
            /* ignore */
          }
        }
      }
      o.material = st.material
      saved.delete(o)
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material]
    for (const m of mats) {
      if (m && 'wireframe' in m) m.wireframe = false
    }
  })
}

/**
 * @param {{ skeletonHelpers: import('three').Object3D[] }} ctx
 */
export function clearSkeletonHelpers(ctx) {
  if (!ctx?.skeletonHelpers) return
  for (const h of ctx.skeletonHelpers) {
    try {
      h.parent?.remove(h)
      if (typeof h.dispose === 'function') h.dispose()
    } catch {
      /* ignore */
    }
  }
  ctx.skeletonHelpers.length = 0
}

/**
 * @param {import('three').Object3D | null} root
 * @param {ViewportViewState} state
 * @param {{ skeletonHelpers: import('three').Object3D[] }} ctx
 * @param {import('three').Scene | null} scene 用于调整平行光/环境光（与 root 所属场景一致）
 */
export function applyViewportViewState(root, state, ctx, scene) {
  if (!root) return
  clearSkeletonHelpers(ctx)
  restoreMaterials(root)

  const geometryMode = state.geometryMode || 'solid'
  const lightingMode = state.lightingMode || 'studio'
  const textureMode = state.textureMode || 'full'
  const materialMode = state.materialMode || 'original'
  const skeletonMode = state.skeletonMode || 'off'
  const vertexAttrMode = state.vertexAttrMode || 'off'

  applySceneLighting(scene, lightingMode)

  // 点云：对 Mesh 使用其顶点缓冲绘制 Points；父级不可见会连子级 Points 一起不渲染，故保留 Mesh 可见并换成「不写色深」的占位材质。
  if (geometryMode === 'points') {
    const hideMat = getMeshPointsHideMaterial()
    root.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return
      const g = o.geometry
      if (!g?.attributes?.position) return
      saveOriginal(o)
      o.visible = true
      const wasArray = Array.isArray(o.material)
      const mats = wasArray ? o.material : [o.material]
      o.material = wasArray ? mats.map(() => hideMat) : hideMat
      const pts = new THREE.Points(
        g,
        new THREE.PointsMaterial({
          color: 0x7ec8ff,
          size: 4,
          sizeAttenuation: false,
          depthTest: true,
          transparent: true,
          opacity: 0.97,
        }),
      )
      pts.frustumCulled = false
      pts.renderOrder = 1
      o.add(pts)
      o.userData._vertexPoints = pts
    })
  }

  if (geometryMode !== 'points') {
    if (vertexAttrMode !== 'off') {
      root.traverse((o) => {
        if (!o.isMesh && !o.isSkinnedMesh) return
        const g = o.geometry
        if (!g?.attributes?.position) return
        saveOriginal(o)
        o.material = buildVertexAttrDebugMaterial(g, vertexAttrMode, o)
      })
    } else if (materialMode === 'normal') {
      root.traverse((o) => {
        if (!o.isMesh && !o.isSkinnedMesh) return
        saveOriginal(o)
        o.material = new THREE.MeshNormalMaterial({
          flatShading: false,
          side: THREE.DoubleSide,
        })
      })
    } else if (materialMode === 'uv') {
      root.traverse((o) => {
        if (!o.isMesh && !o.isSkinnedMesh) return
        saveOriginal(o)
        o.material = new THREE.MeshBasicMaterial({
          map: getUvDebugTexture(),
          side: THREE.DoubleSide,
        })
      })
    } else if (textureMode === 'albedoFlat') {
      root.traverse((o) => {
        if (!o.isMesh && !o.isSkinnedMesh) return
        saveOriginal(o)
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        const next = mats.map((m) => {
          if (!m) return m
          const mat = new THREE.MeshBasicMaterial()
          if (m.map) {
            mat.map = m.map
            mat.map.needsUpdate = true
          } else if (m.color) {
            mat.color.copy(m.color)
          } else {
            mat.color.setHex(0x888888)
          }
          mat.toneMapped = false
          mat.transparent = !!m.transparent
          mat.opacity = m.opacity ?? 1
          mat.side = m.side ?? THREE.FrontSide
          return mat
        })
        o.material = Array.isArray(o.material) ? next : next[0]
      })
    } else if (textureMode === 'hideMaps') {
      const TEX_KEYS = [
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
      root.traverse((o) => {
        if (!o.isMesh && !o.isSkinnedMesh) return
        saveOriginal(o)
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        const next = mats.map((m) => {
          if (!m) return m
          const c = m.clone()
          for (const k of TEX_KEYS) {
            if (k in c) c[k] = null
          }
          c.needsUpdate = true
          return c
        })
        o.material = Array.isArray(o.material) ? next : next[0]
      })
    } else if (textureMode.startsWith('slot:')) {
      const slotKey = textureMode.slice(5)
      if (MATERIAL_MAP_KEYS.includes(slotKey)) {
        root.traverse((o) => {
          if (!o.isMesh && !o.isSkinnedMesh) return
          saveOriginal(o)
          const wasArray = Array.isArray(o.material)
          const mats = wasArray ? o.material : [o.material]
          const next = mats.map((m) => buildSingleSlotPreviewMaterial(m, slotKey))
          o.material = wasArray ? next : next[0]
        })
      }
    }
  }

  if (geometryMode === 'wireframe') {
    root.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) {
          if (m && 'wireframe' in m) m.wireframe = true
        }
      }
    })
  }

  if (skeletonMode === 'bones' || skeletonMode === 'weights') {
    root.traverse((o) => {
      if (o.isSkinnedMesh && o.skeleton) {
        try {
          const helper = new SkeletonHelper(o)
          helper.material.color.setHex(skeletonMode === 'weights' ? 0xff8844 : 0x6bcfff)
          if ('linewidth' in helper.material) helper.material.linewidth = 2
          ctx.skeletonHelpers.push(helper)
          o.parent?.add(helper)
        } catch {
          /* ignore */
        }
      }
    })
  }
}

/** @deprecated 使用 applyViewportViewState */
export function applyDisplayMode(root, mode, ctx) {
  const mapLegacy = {
    shaded: {
      geometryMode: 'solid',
      lightingMode: 'studio',
      textureMode: 'full',
      materialMode: 'original',
      skeletonMode: 'off',
      vertexAttrMode: 'off',
    },
    wireframe: {
      geometryMode: 'wireframe',
      lightingMode: 'studio',
      textureMode: 'full',
      materialMode: 'original',
      skeletonMode: 'off',
      vertexAttrMode: 'off',
    },
    albedo: {
      geometryMode: 'solid',
      lightingMode: 'studio',
      textureMode: 'albedoFlat',
      materialMode: 'original',
      skeletonMode: 'off',
      vertexAttrMode: 'off',
    },
    normals: {
      geometryMode: 'solid',
      lightingMode: 'studio',
      textureMode: 'full',
      materialMode: 'normal',
      skeletonMode: 'off',
      vertexAttrMode: 'off',
    },
    vertices: {
      geometryMode: 'points',
      lightingMode: 'studio',
      textureMode: 'full',
      materialMode: 'original',
      skeletonMode: 'off',
      vertexAttrMode: 'off',
    },
    skeleton: {
      geometryMode: 'solid',
      lightingMode: 'studio',
      textureMode: 'full',
      materialMode: 'original',
      skeletonMode: 'bones',
      vertexAttrMode: 'off',
    },
  }
  const st = mapLegacy[mode] || mapLegacy.shaded
  applyViewportViewState(root, st, ctx, null)
}
