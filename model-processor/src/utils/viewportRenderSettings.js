import * as THREE from 'three'

/**
 * 色调映射 / 「HDR」风格：与后期 `OutputPass` 读取的 `renderer.toneMapping` 一致。
 * @param {import('three').WebGLRenderer | null} renderer
 * @param {'classic' | 'pbr' | 'raytrace'} pipeline
 * @param {string} toneMappingId `none` | `linear` | `aces` | `reinhard` | `cineon` | `agx` | `neutral`（兼容旧 `off`→none）
 */
export function applyRendererToneAndPipeline(renderer, pipeline, toneMappingId) {
  if (!renderer) return
  const usePbr = pipeline === 'pbr' || pipeline === 'raytrace'
  renderer.physicallyCorrectLights = usePbr
  renderer.outputColorSpace = THREE.SRGBColorSpace

  const exp = pipeline === 'raytrace' ? 1.05 : 1
  renderer.toneMappingExposure = exp

  const id = toneMappingId === 'off' ? 'none' : toneMappingId || 'aces'

  const map = {
    none: THREE.NoToneMapping,
    linear: THREE.LinearToneMapping,
    aces: THREE.ACESFilmicToneMapping,
    reinhard: THREE.ReinhardToneMapping,
    cineon: THREE.CineonToneMapping,
    agx: THREE.AgXToneMapping,
    neutral: THREE.NeutralToneMapping,
  }
  renderer.toneMapping = map[id] ?? THREE.ACESFilmicToneMapping
}

function applyShadowToSceneLightAndMeshes(scene, root, on) {
  if (scene) {
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
  if (root) {
    root.traverse((obj) => {
      if (obj.isMesh || obj.isSkinnedMesh) {
        obj.castShadow = on
        obj.receiveShadow = on
      }
    })
  }
}

/**
 * @param {import('three').Scene[]} scenes
 * @param {import('three').Object3D | null} sourceRoot
 * @param {import('three').Object3D | null} resultRoot
 * @param {import('three').WebGLRenderer[]} renderers
 * @param {'off' | 'on'} mode
 * @deprecated 双视口请用 applyDualViewportShadows
 */
export function applyViewportShadows(scenes, sourceRoot, resultRoot, renderers, mode) {
  const on = mode === 'on'
  for (const r of renderers) {
    if (!r) continue
    r.shadowMap.enabled = on
    r.shadowMap.type = THREE.PCFSoftShadowMap
  }
  for (const scene of scenes) {
    applyShadowToSceneLightAndMeshes(scene, null, on)
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

/**
 * 左右视口独立阴影开关（各自 Scene、Renderer、根节点）。
 */
export function applyDualViewportShadows(
  sceneA,
  rootA,
  rendererA,
  shadowA,
  sceneB,
  rootB,
  rendererB,
  shadowB,
) {
  const onA = shadowA === 'on'
  const onB = shadowB === 'on'
  if (rendererA) {
    rendererA.shadowMap.enabled = onA
    rendererA.shadowMap.type = THREE.PCFSoftShadowMap
  }
  if (rendererB) {
    rendererB.shadowMap.enabled = onB
    rendererB.shadowMap.type = THREE.PCFSoftShadowMap
  }
  applyShadowToSceneLightAndMeshes(sceneA, rootA, onA)
  applyShadowToSceneLightAndMeshes(sceneB, rootB, onB)
}
