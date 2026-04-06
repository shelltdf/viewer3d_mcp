<script setup>
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import * as THREE from 'three'
import { FileLoader, LoaderUtils } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { buildOutlineItems } from '../utils/outline.js'

const emit = defineEmits(['source-loaded', 'result-updated', 'viewer-error', 'status'])

const sourceEl = ref(null)
const resultEl = ref(null)

let rendererA
let rendererB
let sceneA
let sceneB
let cameraA
let cameraB
let controlsA
let controlsB
let animationId = 0
let mixerA
let mixerB
const clock = new THREE.Clock()

const loader = new GLTFLoader()
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('/draco/')
dracoLoader.preload()
loader.setDRACOLoader(dracoLoader)

let sourceRoot = null
let resultRoot = null

function fitCameraToObject(camera, controls, object) {
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const center = sphere.center
  const radius = Math.max(sphere.radius, 1e-6)
  const dist = radius / Math.sin(((camera.fov / 2) * Math.PI) / 180)
  const offset = dist * 1.35
  const dir = new THREE.Vector3(1.2, 1.0, 1.4).normalize()
  camera.position.copy(center.clone().add(dir.multiplyScalar(offset)))
  camera.near = Math.max(offset / 500, 0.01)
  camera.far = offset * 500
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  camera.lookAt(center)
  controls.update()
}

function disposeObject3D(root) {
  if (!root) return
  root.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose()
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
      mats.forEach((m) => {
        if (m.map) m.map.dispose()
        m.dispose()
      })
    }
  })
}

function clearSource() {
  if (mixerA) {
    mixerA.stopAllAction()
    mixerA = undefined
  }
  if (sourceRoot) {
    sceneA.remove(sourceRoot)
    disposeObject3D(sourceRoot)
    sourceRoot = undefined
  }
}

function clearResult() {
  if (mixerB) {
    mixerB.stopAllAction()
    mixerB = undefined
  }
  if (resultRoot) {
    sceneB.remove(resultRoot)
    disposeObject3D(resultRoot)
    resultRoot = undefined
  }
}

function applyObject3DToSource(object) {
  clearSource()
  sourceRoot = object
  sourceRoot.traverse((obj) => {
    if (obj.isMesh || obj.isSkinnedMesh || obj.isPoints) obj.frustumCulled = false
  })
  sceneA.add(sourceRoot)
  fitCameraToObject(cameraA, controlsA, sourceRoot)
  emit('source-loaded', {
    outline: buildOutlineItems(sourceRoot),
    animations: 0,
  })
}

function applyGltfToSource(gltf) {
  clearSource()
  sourceRoot = gltf.scene
  sourceRoot.traverse((obj) => {
    if (obj.isMesh || obj.isSkinnedMesh || obj.isPoints) obj.frustumCulled = false
  })
  sceneA.add(sourceRoot)
  if (gltf.animations?.length) {
    mixerA = new THREE.AnimationMixer(sourceRoot)
    for (const clip of gltf.animations) {
      mixerA.clipAction(clip).play()
    }
  }
  fitCameraToObject(cameraA, controlsA, sourceRoot)
  emit('source-loaded', {
    outline: buildOutlineItems(sourceRoot),
    animations: gltf.animations?.length || 0,
  })
}

function urlModifierFromFileMap(map) {
  return (url) => {
    const normalized = url.replace(/\\/g, '/')
    const noQuery = normalized.split('?')[0].split('#')[0]
    const basename = noQuery.split('/').pop()
    const decodedBase = basename ? decodeURIComponent(basename) : basename
    return (
      map.get(url) ||
      map.get(normalized) ||
      map.get(noQuery) ||
      (basename && map.get(basename)) ||
      (decodedBase && map.get(decodedBase)) ||
      url
    )
  }
}

/**
 * 远程 .obj：先拉取文本，按 mtllib 用 MTLLoader 加载同目录 .mtl，再解析几何。
 */
async function loadObjFromUrl(url) {
  const base = LoaderUtils.extractUrlBase(url)
  const text = await new FileLoader().loadAsync(url)
  const mtlMatch = text.match(/^mtllib\s+(.+)$/m)
  let materials = null
  if (mtlMatch) {
    const mtlName = mtlMatch[1].trim().split(/\s+/)[0]
    const manager = new THREE.LoadingManager()
    const idle = new Promise((resolve) => {
      manager.onLoad = resolve
    })
    const mtlLoader = new MTLLoader(manager)
    mtlLoader.setPath(base)
    mtlLoader.setResourcePath(base)
    materials = await mtlLoader.loadAsync(mtlName)
    materials.preload()
    await idle
  }
  const objLoader = new OBJLoader()
  if (materials) objLoader.setMaterials(materials)
  const object = objLoader.parse(text)
  applyObject3DToSource(object)
  emit('status', `已加载 OBJ：${url}`)
}

/** 单个本地 .obj，无 mtllib，或需用户多选带 MTL 的文件集。 */
async function loadObjSingleBlob(file) {
  const text = await file.text()
  const mtlMatch = text.match(/^mtllib\s+(.+)$/m)
  if (mtlMatch) {
    const hint = '该 .obj 引用了 mtllib，请一次性多选 .obj、.mtl 以及 MTL 中引用的贴图。'
    emit('viewer-error', hint)
    throw new Error(hint)
  }
  const objLoader = new OBJLoader()
  const object = objLoader.parse(text)
  applyObject3DToSource(object)
  emit('status', '已加载 .obj（无 MTL）')
}

/**
 * 多选：.obj + .mtl + 贴图，通过 LoadingManager 将相对路径映射到各 blob URL。
 */
async function loadObjFromFileList(files) {
  const map = new Map()
  const blobUrls = []
  for (const f of files) {
    const u = URL.createObjectURL(f)
    map.set(f.name, u)
    blobUrls.push(u)
  }
  const revokeAll = () => {
    for (const u of blobUrls) URL.revokeObjectURL(u)
  }

  const objFile = files.find((f) => f.name.toLowerCase().endsWith('.obj'))
  if (!objFile) {
    revokeAll()
    throw new Error('未找到 .obj 文件')
  }

  const objText = await objFile.text()
  const mtlMatch = objText.match(/^mtllib\s+(.+)$/m)
  let materials = null

  if (mtlMatch) {
    const mtlName = mtlMatch[1].trim().split(/\s+/)[0]
    const mtlFile = files.find(
      (f) => f.name === mtlName || f.name.toLowerCase() === mtlName.toLowerCase(),
    )
    if (!mtlFile) {
      revokeAll()
      throw new Error(
        `未在已选文件中找到 mtllib：${mtlName}。请将 .mtl 与贴图一并多选。`,
      )
    }
    const manager = new THREE.LoadingManager()
    const idle = new Promise((resolve) => {
      manager.onLoad = resolve
    })
    manager.setURLModifier(urlModifierFromFileMap(map))
    const mtlLoader = new MTLLoader(manager)
    mtlLoader.setPath('')
    mtlLoader.setResourcePath('')
    materials = await mtlLoader.loadAsync(map.get(mtlFile.name))
    materials.preload()
    await idle
  }

  const objLoader = new OBJLoader()
  if (materials) objLoader.setMaterials(materials)
  const object = objLoader.parse(objText)
  applyObject3DToSource(object)
  emit('status', materials ? '已加载 OBJ + MTL（含贴图）' : '已加载 OBJ（无 mtllib）')
  setTimeout(revokeAll, 1200)
}

function syncResultFromSource() {
  if (!sourceRoot) {
    emit('viewer-error', '请先加载源模型')
    return
  }
  clearResult()
  try {
    resultRoot = cloneSkinned(sourceRoot)
    resultRoot.traverse((obj) => {
      if (obj.isMesh || obj.isSkinnedMesh || obj.isPoints) obj.frustumCulled = false
    })
    sceneB.add(resultRoot)
    fitCameraToObject(cameraB, controlsB, resultRoot)
    emit('result-updated', { outline: buildOutlineItems(resultRoot) })
    emit('status', '已生成优化后预览（网格克隆）')
  } catch (e) {
    emit('viewer-error', e?.message || String(e))
  }
}

async function loadUrl(url) {
  try {
    const pathOnly = url.split('?')[0].split('#')[0].toLowerCase()
    if (pathOnly.endsWith('.obj')) {
      await loadObjFromUrl(url)
      return
    }
    const gltf = await loader.loadAsync(url)
    applyGltfToSource(gltf)
    emit('status', `已加载：${url}`)
  } catch (e) {
    const msg = e?.message || String(e)
    emit('viewer-error', msg)
    throw e
  }
}

async function loadFile(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.obj')) {
    try {
      await loadObjSingleBlob(file)
    } catch (e) {
      const msg = e?.message || String(e)
      emit('viewer-error', msg)
      throw e
    }
    return
  }
  const objectUrl = URL.createObjectURL(file)
  try {
    const gltf = await loader.loadAsync(objectUrl)
    applyGltfToSource(gltf)
  } catch (e) {
    const msg = e?.message || String(e)
    emit('viewer-error', msg)
    throw e
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function loadFiles(fileList) {
  const files = Array.from(fileList || [])
  if (!files.length) throw new Error('未选择文件')

  const hasObj = files.some((f) => f.name.toLowerCase().endsWith('.obj'))
  if (hasObj) {
    try {
      await loadObjFromFileList(files)
    } catch (e) {
      const msg = e?.message || String(e)
      emit('viewer-error', msg)
      throw e
    }
    return
  }

  if (files.length === 1 && files[0].name.toLowerCase().endsWith('.glb')) {
    await loadFile(files[0])
    return
  }
  const map = new Map()
  for (const f of files) {
    map.set(f.name, URL.createObjectURL(f))
  }
  const gltfFile =
    files.find((f) => f.name.toLowerCase().endsWith('.gltf')) ||
    files.find((f) => f.name.toLowerCase().endsWith('.glb'))
  if (!gltfFile) {
    for (const u of map.values()) URL.revokeObjectURL(u)
    throw new Error('请至少选择一个 .gltf 或 .glb 文件')
  }
  const manager = new THREE.LoadingManager()
  manager.setURLModifier(urlModifierFromFileMap(map))
  const localLoader = new GLTFLoader(manager)
  localLoader.setDRACOLoader(dracoLoader)
  try {
    const gltf = await localLoader.loadAsync(map.get(gltfFile.name))
    applyGltfToSource(gltf)
  } catch (e) {
    const raw = e?.message || String(e)
    const msg =
      /Failed to load buffer|Failed to load texture|404|Not Found/i.test(raw)
        ? '本地 .gltf 缺少依赖文件。请一次性多选 .gltf + .bin + 贴图，或改用 .glb。'
        : raw
    emit('viewer-error', msg)
    throw new Error(msg)
  } finally {
    for (const u of map.values()) URL.revokeObjectURL(u)
  }
}

function animate() {
  animationId = requestAnimationFrame(animate)
  const delta = clock.getDelta()
  if (mixerA) mixerA.update(delta)
  if (mixerB) mixerB.update(delta)
  controlsA?.update()
  controlsB?.update()
  if (rendererA && sceneA && cameraA) rendererA.render(sceneA, cameraA)
  if (rendererB && sceneB && cameraB) rendererB.render(sceneB, cameraB)
}

function onResize() {
  const elA = sourceEl.value
  const elB = resultEl.value
  if (!elA || !elB || !rendererA || !rendererB) return
  const wA = elA.clientWidth
  const hA = elA.clientHeight
  const wB = elB.clientWidth
  const hB = elB.clientHeight
  if (wA && hA) {
    cameraA.aspect = wA / hA
    cameraA.updateProjectionMatrix()
    rendererA.setSize(wA, hA, false)
  }
  if (wB && hB) {
    cameraB.aspect = wB / hB
    cameraB.updateProjectionMatrix()
    rendererB.setSize(wB, hB, false)
  }
}

function initViewport(container, backgroundHex) {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(backgroundHex)
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000)
  camera.position.set(2, 1.5, 3)
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(renderer.domElement)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.05
  const amb = new THREE.AmbientLight(0xffffff, 0.55)
  scene.add(amb)
  const dir = new THREE.DirectionalLight(0xffffff, 0.95)
  dir.position.set(4, 10, 6)
  scene.add(dir)
  const grid = new THREE.GridHelper(20, 20, 0x444444, 0x333333)
  scene.add(grid)
  return { scene, camera, renderer, controls }
}

function mount() {
  if (rendererA) return
  const elA = sourceEl.value
  const elB = resultEl.value
  if (!elA || !elB) return
  const a = initViewport(elA, 0x1a1d24)
  const b = initViewport(elB, 0x151820)
  sceneA = a.scene
  cameraA = a.camera
  rendererA = a.renderer
  controlsA = a.controls
  sceneB = b.scene
  cameraB = b.camera
  rendererB = b.renderer
  controlsB = b.controls
  window.addEventListener('resize', onResize)
  onResize()
  animate()
}

onMounted(async () => {
  await nextTick()
  mount()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  cancelAnimationFrame(animationId)
  clearSource()
  clearResult()
  controlsA?.dispose()
  controlsB?.dispose()
  if (rendererA?.domElement?.parentNode) {
    rendererA.domElement.parentNode.removeChild(rendererA.domElement)
  }
  if (rendererB?.domElement?.parentNode) {
    rendererB.domElement.parentNode.removeChild(rendererB.domElement)
  }
  rendererA?.dispose()
  rendererB?.dispose()
  rendererA = undefined
  rendererB = undefined
})

watch([sourceEl, resultEl], async () => {
  await nextTick()
  if (sourceEl.value && resultEl.value && !rendererA) mount()
})

defineExpose({
  loadUrl,
  loadFiles,
  syncResultFromSource,
  clearResult,
  resetCameras() {
    if (sourceRoot) fitCameraToObject(cameraA, controlsA, sourceRoot)
    if (resultRoot) fitCameraToObject(cameraB, controlsB, resultRoot)
  },
})
</script>

<template>
  <div class="dual-viewport">
    <div class="vp-stack">
      <div class="vp-label">优化前（源）</div>
      <div ref="sourceEl" class="vp-canvas" />
    </div>
    <div class="vp-stack">
      <div class="vp-label">优化后（目标）</div>
      <div ref="resultEl" class="vp-canvas" />
    </div>
  </div>
</template>

<style scoped>
.dual-viewport {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  gap: 4px;
}
.vp-stack {
  flex: 1 1 50%;
  min-height: 120px;
  display: flex;
  flex-direction: column;
  border: 1px solid #2f3540;
  border-radius: 4px;
  overflow: hidden;
  background: #0f1115;
}
.vp-label {
  flex: 0 0 auto;
  padding: 4px 8px;
  font-size: 11px;
  color: #b8c0d0;
  background: linear-gradient(#333945, #2a3038);
  border-bottom: 1px solid #1f242c;
}
.vp-canvas {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
}
.vp-canvas :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
</style>
