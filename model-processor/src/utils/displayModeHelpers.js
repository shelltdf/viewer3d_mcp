import * as THREE from 'three'
import { SkeletonHelper } from 'three'

/** @typedef {'shaded' | 'wireframe' | 'albedo' | 'normals' | 'vertices' | 'skeleton'} DisplayMode */

const saved = new WeakMap()

/**
 * @param {import('three').Object3D | null} root
 * @param {DisplayMode} mode
 * @param {{ skeletonHelpers: import('three').Object3D[] }} ctx
 */
export function applyDisplayMode(root, mode, ctx) {
  if (!root) return
  clearSkeletonHelpers(ctx)
  restoreMaterials(root)

  if (mode === 'shaded') {
    root.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) {
          if (m && 'wireframe' in m) m.wireframe = false
        }
      }
    })
    return
  }

  if (mode === 'wireframe') {
    root.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        for (const m of mats) {
          if (m && 'wireframe' in m) m.wireframe = true
        }
      }
    })
    return
  }

  if (mode === 'albedo') {
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
    return
  }

  if (mode === 'normals') {
    root.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return
      saveOriginal(o)
      o.material = new THREE.MeshNormalMaterial({
        flatShading: false,
        side: THREE.DoubleSide,
      })
    })
    return
  }

  if (mode === 'vertices') {
    root.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return
      const g = o.geometry
      if (!g?.attributes?.position) return
      const pts = new THREE.Points(
        g,
        new THREE.PointsMaterial({
          color: 0x7ec8ff,
          size: 0.02,
          sizeAttenuation: true,
          depthTest: true,
          transparent: true,
          opacity: 0.9,
        }),
      )
      pts.renderOrder = 1
      o.add(pts)
      o.userData._vertexPoints = pts
    })
    return
  }

  if (mode === 'skeleton') {
    root.traverse((o) => {
      if (o.isSkinnedMesh && o.skeleton) {
        try {
          const helper = new SkeletonHelper(o)
          helper.material.linewidth = 2
          ctx.skeletonHelpers.push(helper)
          o.parent?.add(helper)
        } catch {
          /* ignore */
        }
      }
    })
  }
}

function saveOriginal(mesh) {
  if (!saved.has(mesh)) {
    saved.set(mesh, { material: mesh.material, geometry: mesh.geometry })
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
    if (st?.material) {
      const disposeList = Array.isArray(o.material) ? o.material : [o.material]
      for (const m of disposeList) {
        if (m && m !== st.material && typeof m.dispose === 'function') m.dispose()
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
