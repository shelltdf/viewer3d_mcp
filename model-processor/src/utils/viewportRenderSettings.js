import * as THREE from 'three'

/**
 * @param {import('three').WebGLRenderer | null} renderer
 * @param {'classic' | 'pbr' | 'raytrace'} pipeline
 * @param {boolean} hdrOn
 */
export function applyRendererToneAndPipeline(renderer, pipeline, hdrOn) {
  if (!renderer) return
  const usePbr = pipeline === 'pbr' || pipeline === 'raytrace'
  renderer.physicallyCorrectLights = usePbr
  renderer.outputColorSpace = THREE.SRGBColorSpace

  if (hdrOn) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = pipeline === 'raytrace' ? 1.05 : 1
  } else if (pipeline === 'classic') {
    renderer.toneMapping = THREE.NoToneMapping
    renderer.toneMappingExposure = 1
  } else {
    renderer.toneMapping = THREE.LinearToneMapping
    renderer.toneMappingExposure = 1
  }
}

/**
 * @param {import('three').Scene[]} scenes
 * @param {import('three').Object3D | null} sourceRoot
 * @param {import('three').Object3D | null} resultRoot
 * @param {import('three').WebGLRenderer[]} renderers
 * @param {'off' | 'on'} mode
 */
export function applyViewportShadows(scenes, sourceRoot, resultRoot, renderers, mode) {
  const on = mode === 'on'
  for (const r of renderers) {
    if (!r) continue
    r.shadowMap.enabled = on
    r.shadowMap.type = THREE.PCFSoftShadowMap
  }
  for (const scene of scenes) {
    if (!scene) continue
    for (const c of scene.children) {
      if (c.isDirectionalLight) {
        c.castShadow = on
        if (on) {
          c.shadow.mapSize.set(2048, 2048)
          c.shadow.bias = -0.00025
          const cam = c.shadow.camera
          cam.near = 0.5
          cam.far = 120
          cam.left = -24
          cam.right = 24
          cam.top = 24
          cam.bottom = -24
          cam.updateProjectionMatrix()
        }
      }
    }
  }
  for (const root of [sourceRoot, resultRoot]) {
    if (!root) continue
    root.traverse((obj) => {
      if (obj.isMesh || obj.isSkinnedMesh) {
        obj.castShadow = on
        obj.receiveShadow = on
      }
    })
  }
}
