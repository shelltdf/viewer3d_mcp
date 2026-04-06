import * as THREE from 'three'
import { SkeletonHelper } from 'three'

/** @typedef {{ geometryMode: string, lightingMode: string, textureMode: string, materialMode: string, skeletonMode: string }} ViewportViewState */

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
        if (m && m !== st.material && typeof m.dispose === 'function') {
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

  applySceneLighting(scene, lightingMode)

  if (geometryMode === 'points') {
    root.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return
      const g = o.geometry
      if (!g?.attributes?.position) return
      saveOriginal(o)
      o.visible = false
      const pts = new THREE.Points(
        g,
        new THREE.PointsMaterial({
          color: 0x7ec8ff,
          size: 0.025,
          sizeAttenuation: true,
          depthTest: true,
          transparent: true,
          opacity: 0.92,
        }),
      )
      pts.renderOrder = 1
      o.add(pts)
      o.userData._vertexPoints = pts
    })
  }

  if (geometryMode !== 'points') {
    if (materialMode === 'normal') {
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
    },
    wireframe: {
      geometryMode: 'wireframe',
      lightingMode: 'studio',
      textureMode: 'full',
      materialMode: 'original',
      skeletonMode: 'off',
    },
    albedo: {
      geometryMode: 'solid',
      lightingMode: 'studio',
      textureMode: 'albedoFlat',
      materialMode: 'original',
      skeletonMode: 'off',
    },
    normals: {
      geometryMode: 'solid',
      lightingMode: 'studio',
      textureMode: 'full',
      materialMode: 'normal',
      skeletonMode: 'off',
    },
    vertices: {
      geometryMode: 'points',
      lightingMode: 'studio',
      textureMode: 'full',
      materialMode: 'original',
      skeletonMode: 'off',
    },
    skeleton: {
      geometryMode: 'solid',
      lightingMode: 'studio',
      textureMode: 'full',
      materialMode: 'original',
      skeletonMode: 'bones',
    },
  }
  const st = mapLegacy[mode] || mapLegacy.shaded
  applyViewportViewState(root, st, ctx, null)
}
