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
import { buildRichOutline } from '../utils/outline.js'
import { computeMeshStats, applyLodDrawRange } from '../utils/meshStats.js'
import { findObject3DByUuid, findMaterialByUuid, findTextureByUuid } from '../utils/selectionResolve.js'
import { attachCompressedTextureHandlers } from '../utils/attachTextureHandlers.js'
import { estimateSceneMemory } from '../utils/memoryEstimate.js'
import { aggregateMeshInfoUnderNode } from '../utils/meshAggregate.js'
import { collectUniqueTexturesForScene } from '../utils/collectSceneTextures.js'
import { getMeshMaterialsMemoryTable } from '../utils/meshMaterialInfo.js'
import {
  analyzeDuplicateResources,
  mergeTextureGroup,
  mergeMaterialGroup,
  mergeMeshInstances,
} from '../utils/analyzeDuplicateResources.js'
import { buildSceneResourceGraph } from '../utils/sceneResourceGraph.js'
import { applyViewportViewState, clearSkeletonHelpers } from '../utils/displayModeHelpers.js'

const props = defineProps({
  /** 是否显示「处理前」视口格子 */
  showSource: { type: Boolean, default: true },
  /** 是否显示「处理后」视口格子；二者可单独或同时开启 */
  showResult: { type: Boolean, default: true },
})

const emit = defineEmits([
  'source-loaded',
  'result-updated',
  'viewer-error',
  'status',
  'outline-updated',
  'memory-stats',
])

const lodSource = ref(1)
const lodResult = ref(1)
const statsSource = ref({ meshes: 0, triangles: 0, vertices: 0 })
const statsResult = ref({ meshes: 0, triangles: 0, vertices: 0 })

const linkCameras = ref(true)
const viewHudSource = ref({ cpu: 0, vram: 0, geo: 0, tex: 0 })
const viewHudResult = ref({ cpu: 0, vram: 0, geo: 0, tex: 0 })

function defaultViewState() {
  return {
    geometryMode: 'solid',
    lightingMode: 'studio',
    textureMode: 'full',
    materialMode: 'original',
    skeletonMode: 'off',
  }
}

/** 处理前 / 处理后各自独立的显示状态（与 Three 场景无响应式绑定，修改后由 watch 应用） */
const viewStateSource = ref(defaultViewState())
const viewStateResult = ref(defaultViewState())
const hudExpanded = ref(true)
const displayCtxA = { skeletonHelpers: [] }
const displayCtxB = { skeletonHelpers: [] }
let memEmitTick = 0
let gpuPeakEst = 0

function fmtBytes(n) {
  if (n == null || Number.isNaN(n)) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

/** @type {import('three').AnimationClip[]} */
let sourceClips = []
/** @type {import('three').AnimationClip[]} */
let resultClips = []

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

const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('/draco/')
dracoLoader.preload()

/** @type {GLTFLoader | null} */
let gltfLoader = null
/** @type {THREE.LoadingManager | null} */
let sharedLoadingManager = null

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

function reapplyViewSource() {
  applyViewportViewState(sourceRoot, viewStateSource.value, displayCtxA, sceneA)
}

function reapplyViewResult() {
  applyViewportViewState(resultRoot, viewStateResult.value, displayCtxB, sceneB)
}

function reapplyBothViews() {
  reapplyViewSource()
  reapplyViewResult()
}

function refreshOutline(panel) {
  const root = panel === 'source' ? sourceRoot : resultRoot
  const clips = panel === 'source' ? sourceClips : resultClips
  if (!root) return
  emit('outline-updated', {
    panel,
    outline: buildRichOutline(root, { clips }),
    animations: clips.length,
    clips,
  })
}

function clearSource() {
  clearSkeletonHelpers(displayCtxA)
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
  clearSkeletonHelpers(displayCtxB)
  if (mixerB) {
    mixerB.stopAllAction()
    mixerB = undefined
  }
  if (resultRoot) {
    sceneB.remove(resultRoot)
    disposeObject3D(resultRoot)
    resultRoot = undefined
  }
  statsResult.value = { meshes: 0, triangles: 0, vertices: 0 }
}

function applyObject3DToSource(object) {
  gpuPeakEst = 0
  clearSource()
  sourceClips = []
  resultClips = []
  lodSource.value = 1
  sourceRoot = object
  sourceRoot.traverse((obj) => {
    if (obj.isMesh || obj.isSkinnedMesh || obj.isPoints) obj.frustumCulled = false
  })
  sceneA.add(sourceRoot)
  fitCameraToObject(cameraA, controlsA, sourceRoot)
  applyLodDrawRange(sourceRoot, lodSource.value)
  reapplyBothViews()
  emit('source-loaded', {
    outline: buildRichOutline(sourceRoot, { clips: [] }),
    animations: 0,
    clips: [],
  })
  syncResultFromSource({ skipStatus: true })
}

function applyGltfToSource(gltf) {
  gpuPeakEst = 0
  clearSource()
  sourceClips = gltf.animations ? [...gltf.animations] : []
  resultClips = []
  lodSource.value = 1
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
  applyLodDrawRange(sourceRoot, lodSource.value)
  reapplyBothViews()
  emit('source-loaded', {
    outline: buildRichOutline(sourceRoot, { clips: sourceClips }),
    animations: gltf.animations?.length || 0,
    clips: sourceClips,
  })
  syncResultFromSource({ skipStatus: true })
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
  emit('status', `已加载 OBJ：${url}；已自动深度克隆至「处理后」`)
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
  emit('status', '已加载 .obj（无 MTL）；已自动深度克隆至「处理后」')
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
  const base = materials ? '已加载 OBJ + MTL（含贴图）' : '已加载 OBJ（无 mtllib）'
  emit('status', `${base}；已自动深度克隆至「处理后」`)
  setTimeout(revokeAll, 1200)
}

/**
 * @param {{ skipStatus?: boolean }} [opts] skipStatus：不写入状态栏（用于加载流程末尾统一提示）
 */
function syncResultFromSource(opts = {}) {
  if (!sourceRoot) {
    emit('viewer-error', '请先加载源模型')
    return
  }
  clearResult()
  lodResult.value = 1
  resultClips = [...sourceClips]
  try {
    resultRoot = cloneSkinned(sourceRoot)
    resultRoot.traverse((obj) => {
      if (obj.isMesh || obj.isSkinnedMesh || obj.isPoints) obj.frustumCulled = false
    })
    sceneB.add(resultRoot)
    fitCameraToObject(cameraB, controlsB, resultRoot)
    applyLodDrawRange(resultRoot, lodResult.value)
    if (resultClips.length) {
      mixerB = new THREE.AnimationMixer(resultRoot)
      for (const clip of resultClips) {
        mixerB.clipAction(clip).play()
      }
    }
    reapplyBothViews()
    emit('result-updated', {
      outline: buildRichOutline(resultRoot, { clips: resultClips }),
      animations: resultClips.length,
      clips: resultClips,
    })
    if (!opts.skipStatus) emit('status', '已生成处理后预览（网格克隆）')
  } catch (e) {
    emit('viewer-error', e?.message || String(e))
  }
}

function resolveOutlineItem(panel, item) {
  if (!item) return { kind: 'empty' }
  if (item.refType === 'none' || item.category === 'section') {
    return { kind: 'section', label: item.label }
  }
  const root = panel === 'source' ? sourceRoot : resultRoot
  const clips = panel === 'source' ? sourceClips : resultClips
  if (!root) return { kind: 'empty' }
  if (item.refType === 'object3d') {
    const object = findObject3DByUuid(root, item.refId)
    if (!object) return { kind: 'empty' }
    const meshInfo = aggregateMeshInfoUnderNode(object)
    let meshMaterialInfo = null
    if (object.isMesh || object.isSkinnedMesh) {
      meshMaterialInfo = getMeshMaterialsMemoryTable(object)
    }
    return { kind: 'object3d', object, meshInfo, meshMaterialInfo }
  }
  if (item.refType === 'material') {
    const material = findMaterialByUuid(root, item.refId)
    return material ? { kind: 'material', material } : { kind: 'empty' }
  }
  if (item.refType === 'texture') {
    const texture = findTextureByUuid(root, item.refId)
    return texture ? { kind: 'texture', texture } : { kind: 'empty' }
  }
  if (item.refType === 'clip') {
    const clip = clips[item.refId]
    return clip ? { kind: 'clip', clip } : { kind: 'empty' }
  }
  return { kind: 'empty' }
}

watch(lodResult, (v) => {
  if (resultRoot) applyLodDrawRange(resultRoot, v)
})

watch(
  () => [props.showSource, props.showResult],
  () => nextTick(() => onResize()),
)

watch(
  viewStateSource,
  () => {
    reapplyViewSource()
  },
  { deep: true },
)

watch(
  viewStateResult,
  () => {
    reapplyViewResult()
  },
  { deep: true },
)

async function loadUrl(url) {
  try {
    if (!gltfLoader) {
      emit('viewer-error', '视口未就绪，请稍后重试')
      return
    }
    const pathOnly = url.split('?')[0].split('#')[0].toLowerCase()
    if (pathOnly.endsWith('.obj')) {
      await loadObjFromUrl(url)
      return
    }
    const gltf = await gltfLoader.loadAsync(url)
    applyGltfToSource(gltf)
    emit('status', `已加载：${url}；已自动深度克隆至「处理后」`)
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
  if (!gltfLoader) {
    emit('viewer-error', '视口未就绪，请稍后重试')
    return
  }
  const objectUrl = URL.createObjectURL(file)
  try {
    const gltf = await gltfLoader.loadAsync(objectUrl)
    applyGltfToSource(gltf)
    emit('status', `已加载：${file.name}；已自动深度克隆至「处理后」`)
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
  attachCompressedTextureHandlers(manager, rendererA)
  manager.setURLModifier(urlModifierFromFileMap(map))
  const localLoader = new GLTFLoader(manager)
  localLoader.setDRACOLoader(dracoLoader)
  try {
    const gltf = await localLoader.loadAsync(map.get(gltfFile.name))
    applyGltfToSource(gltf)
    emit('status', `已加载：${gltfFile.name}；已自动深度克隆至「处理后」`)
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

function refreshViewHud(root, renderer, targetRef) {
  if (!root) {
    targetRef.value = { cpu: 0, vram: 0, geo: 0, tex: 0 }
    return
  }
  const est = estimateSceneMemory(root)
  const geo = est.breakdown.find((b) => b.id === 'geo')?.bytes || 0
  const tex = est.breakdown.find((b) => b.id === 'tex')?.bytes || 0
  const vramEst = geo + tex
  const info = renderer?.info?.memory
  targetRef.value = {
    cpu: est.total,
    vram: vramEst,
    geo,
    tex,
    geometries: info?.geometries ?? 0,
    textures: info?.textures ?? 0,
  }
}

function animate() {
  animationId = requestAnimationFrame(animate)
  const delta = clock.getDelta()
  if (mixerA) mixerA.update(delta)
  if (mixerB) mixerB.update(delta)
  controlsA?.update()
  controlsB?.update()
  if (sourceRoot) statsSource.value = computeMeshStats(sourceRoot)
  if (resultRoot) statsResult.value = computeMeshStats(resultRoot)
  refreshViewHud(sourceRoot, rendererA, viewHudSource)
  refreshViewHud(resultRoot, rendererB, viewHudResult)
  memEmitTick++
  if (memEmitTick >= 48) {
    memEmitTick = 0
    const js =
      typeof performance !== 'undefined' && performance.memory
        ? {
            used: performance.memory.usedJSHeapSize,
            limit: performance.memory.jsHeapSizeLimit,
          }
        : null
    const s = viewHudSource.value
    const r = viewHudResult.value
    const gpuEst = (s.vram || 0) + (r.vram || 0)
    gpuPeakEst = Math.max(gpuPeakEst, gpuEst)
    emit('memory-stats', {
      js,
      gpuEst,
      gpuPeakEst,
      textures: (s.textures || 0) + (r.textures || 0),
      source: {
        vram: s.vram || 0,
        cpu: s.cpu || 0,
        geo: s.geo || 0,
        tex: s.tex || 0,
        geometries: s.geometries ?? 0,
        textures: s.textures ?? 0,
      },
      result: {
        vram: r.vram || 0,
        cpu: r.cpu || 0,
        geo: r.geo || 0,
        tex: r.tex || 0,
        geometries: r.geometries ?? 0,
        textures: r.textures ?? 0,
      },
    })
  }
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

  sharedLoadingManager = new THREE.LoadingManager()
  attachCompressedTextureHandlers(sharedLoadingManager, rendererA)
  gltfLoader = new GLTFLoader(sharedLoadingManager)
  gltfLoader.setDRACOLoader(dracoLoader)

  let cameraSyncing = false
  function syncCamBFromA() {
    if (!linkCameras.value || cameraSyncing || !cameraA || !cameraB) return
    cameraSyncing = true
    cameraB.position.copy(cameraA.position)
    cameraB.quaternion.copy(cameraA.quaternion)
    controlsB.target.copy(controlsA.target)
    controlsB.update()
    cameraSyncing = false
  }
  function syncCamAFromB() {
    if (!linkCameras.value || cameraSyncing || !cameraA || !cameraB) return
    cameraSyncing = true
    cameraA.position.copy(cameraB.position)
    cameraA.quaternion.copy(cameraB.quaternion)
    controlsA.target.copy(controlsB.target)
    controlsA.update()
    cameraSyncing = false
  }
  controlsA.addEventListener('change', syncCamBFromA)
  controlsB.addEventListener('change', syncCamAFromB)

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

function getMemoryEstimate(which) {
  const root = which === 'source' ? sourceRoot : resultRoot
  const est = estimateSceneMemory(root)
  const textureMosaic = collectUniqueTexturesForScene(root)
  return { ...est, textureMosaic }
}

function getDuplicateAnalysis(which) {
  const root = which === 'source' ? sourceRoot : resultRoot
  return analyzeDuplicateResources(root)
}

function getResourceGraph(which) {
  const root = which === 'source' ? sourceRoot : resultRoot
  return buildSceneResourceGraph(root)
}

function applyDuplicateMerges(payload) {
  const empty = { textureMerged: 0, materialMerged: 0, nodesRemoved: 0, groupsApplied: 0 }
  const { ops } = payload
  /** 处理前只读：合并与工具仅作用于「处理后」独立场景 */
  const root = resultRoot
  if (!root || !ops?.length) return empty
  let textureMerged = 0
  let materialMerged = 0
  let nodesRemoved = 0
  for (const op of ops) {
    if (op.kind === 'texture') {
      const r = mergeTextureGroup(root, op.textures, op.keepUuid)
      textureMerged += r.merged
    } else if (op.kind === 'material') {
      const r = mergeMaterialGroup(root, op.materials, op.keepUuid)
      materialMerged += r.merged
    } else if (op.kind === 'object' || op.kind === 'mesh') {
      const r = mergeMeshInstances(op.keepUuid, op.items)
      nodesRemoved += r.removed
    }
  }
  refreshOutline('result')
  return { textureMerged, materialMerged, nodesRemoved, groupsApplied: ops.length }
}

defineExpose({
  loadUrl,
  loadFiles,
  syncResultFromSource,
  clearResult,
  resolveOutlineItem,
  getMemoryEstimate,
  getDuplicateAnalysis,
  getResourceGraph,
  applyDuplicateMerges,
  linkCameras,
  resetCameras() {
    if (sourceRoot) fitCameraToObject(cameraA, controlsA, sourceRoot)
    if (resultRoot) fitCameraToObject(cameraB, controlsB, resultRoot)
  },
})
</script>

<template>
  <div
    class="dual-viewport"
    :class="{
      'layout-only-source': showSource && !showResult,
      'layout-only-result': !showSource && showResult,
    }"
  >
    <div v-show="showSource" class="vp-stack vp-stack-source">
      <div class="vp-label-row">
        <div class="vp-label">处理前（只读快照 · 与处理后无引用关系）</div>
        <div class="vp-toolbar" title="仅影响左侧视口显示，不改源数据">
          <select v-model="viewStateSource.geometryMode" class="vt-sel">
            <option value="solid">实体</option>
            <option value="wireframe">线框</option>
            <option value="points">点云</option>
          </select>
          <select v-model="viewStateSource.lightingMode" class="vt-sel">
            <option value="studio">光照·影棚</option>
            <option value="soft">光照·柔和</option>
            <option value="flat">光照·平铺</option>
          </select>
          <select v-model="viewStateSource.textureMode" class="vt-sel">
            <option value="full">贴图·采样</option>
            <option value="albedoFlat">贴图·无光照</option>
            <option value="hideMaps">贴图·隐藏</option>
          </select>
          <select v-model="viewStateSource.materialMode" class="vt-sel">
            <option value="original">材质·原始</option>
            <option value="normal">材质·法线</option>
            <option value="uv">材质·UV 格</option>
          </select>
          <select v-model="viewStateSource.skeletonMode" class="vt-sel">
            <option value="off">骨骼·关</option>
            <option value="bones">骨骼·骨架</option>
            <option value="weights">骨骼·权重示意</option>
          </select>
        </div>
      </div>
      <div class="vp-canvas-wrap">
        <div ref="sourceEl" class="vp-canvas" />
        <div class="vp-mem-corner vp-mem-corner--src" title="本格粗估：CPU 总占用与显存相关字节">
          <span class="mem-corner-label">存储估</span>
          <span class="mem-corner-main"
            >{{ fmtBytes(viewHudSource.cpu) }} · VRAM≈{{ fmtBytes(viewHudSource.vram) }}</span
          >
          <span class="mem-corner-sub"
            >Geo {{ fmtBytes(viewHudSource.geo) }} · Tex {{ fmtBytes(viewHudSource.tex) }} · GL
            {{ viewHudSource.geometries }}/{{ viewHudSource.textures }}</span
          >
        </div>
        <button
          type="button"
          class="hud-toggle"
          :title="hudExpanded ? '折叠信息面板' : '展开信息面板'"
          @click="hudExpanded = !hudExpanded"
        >
          {{ hudExpanded ? '▼ 信息' : '▲ 信息' }}
        </button>
        <div v-if="hudExpanded" class="vp-hud">
          <div class="hud-stats">
            三角面 {{ statsSource.triangles.toLocaleString() }} · 顶点 {{ statsSource.vertices.toLocaleString() }} · Mesh
            {{ statsSource.meshes }}
          </div>
          <label class="hud-link">
            <input v-model="linkCameras" type="checkbox" />
            联动观察
          </label>
          <div class="hud-readonly-note">源网格 LOD 固定 100%（只读）</div>
        </div>
        <div v-else class="vp-hud vp-hud-compact">
          <span class="hud-mini-line">△ {{ statsSource.triangles.toLocaleString() }}（详情见左上角存储估）</span>
        </div>
      </div>
    </div>
    <div v-show="showResult" class="vp-stack vp-stack-result">
      <div class="vp-label-row">
        <div class="vp-label">处理后（工具与合并仅作用本侧 · 深度克隆）</div>
        <div class="vp-toolbar" title="仅影响右侧视口显示">
          <select v-model="viewStateResult.geometryMode" class="vt-sel">
            <option value="solid">实体</option>
            <option value="wireframe">线框</option>
            <option value="points">点云</option>
          </select>
          <select v-model="viewStateResult.lightingMode" class="vt-sel">
            <option value="studio">光照·影棚</option>
            <option value="soft">光照·柔和</option>
            <option value="flat">光照·平铺</option>
          </select>
          <select v-model="viewStateResult.textureMode" class="vt-sel">
            <option value="full">贴图·采样</option>
            <option value="albedoFlat">贴图·无光照</option>
            <option value="hideMaps">贴图·隐藏</option>
          </select>
          <select v-model="viewStateResult.materialMode" class="vt-sel">
            <option value="original">材质·原始</option>
            <option value="normal">材质·法线</option>
            <option value="uv">材质·UV 格</option>
          </select>
          <select v-model="viewStateResult.skeletonMode" class="vt-sel">
            <option value="off">骨骼·关</option>
            <option value="bones">骨骼·骨架</option>
            <option value="weights">骨骼·权重示意</option>
          </select>
        </div>
      </div>
      <div class="vp-canvas-wrap">
        <div ref="resultEl" class="vp-canvas" />
        <div class="vp-mem-corner vp-mem-corner--dst" title="本格粗估：CPU 总占用与显存相关字节">
          <span class="mem-corner-label">存储估</span>
          <span class="mem-corner-main"
            >{{ fmtBytes(viewHudResult.cpu) }} · VRAM≈{{ fmtBytes(viewHudResult.vram) }}</span
          >
          <span class="mem-corner-sub"
            >Geo {{ fmtBytes(viewHudResult.geo) }} · Tex {{ fmtBytes(viewHudResult.tex) }} · GL
            {{ viewHudResult.geometries }}/{{ viewHudResult.textures }}</span
          >
        </div>
        <button
          type="button"
          class="hud-toggle"
          :title="hudExpanded ? '折叠信息面板' : '展开信息面板'"
          @click="hudExpanded = !hudExpanded"
        >
          {{ hudExpanded ? '▼ 信息' : '▲ 信息' }}
        </button>
        <div v-if="hudExpanded" class="vp-hud">
          <div class="hud-stats">
            三角面 {{ statsResult.triangles.toLocaleString() }} · 顶点 {{ statsResult.vertices.toLocaleString() }} · Mesh
            {{ statsResult.meshes }}
          </div>
          <label class="hud-link">
            <input v-model="linkCameras" type="checkbox" />
            联动观察
          </label>
          <label class="hud-lod">
            <span>LOD</span>
            <input v-model.number="lodResult" type="range" min="0.02" max="1" step="0.02" />
            <span class="hud-lod-val">{{ (lodResult * 100).toFixed(0) }}%</span>
          </label>
        </div>
        <div v-else class="vp-hud vp-hud-compact">
          <span class="hud-mini-line">△ {{ statsResult.triangles.toLocaleString() }}（详情见左上角存储估）</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dual-viewport {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  gap: 4px;
}
.dual-viewport.layout-only-source .vp-stack-source,
.dual-viewport.layout-only-result .vp-stack-result {
  flex: 1 1 auto;
  min-height: 160px;
}
.vp-label-row {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 5px 8px;
  background: linear-gradient(#333945, #2a3038);
  border-bottom: 1px solid #1f242c;
}
.vp-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}
.vt-sel {
  min-width: 92px;
  max-width: 118px;
  padding: 3px 5px;
  border: 1px solid #4a5160;
  border-radius: 3px;
  background: #1b2029;
  color: #e6ebf3;
  font-size: 10px;
}
.vp-stack-source .vp-label {
  background: transparent;
  border: none;
  padding: 0;
  color: #7ec4e8;
}
.vp-stack-result .vp-label {
  background: transparent;
  border: none;
  padding: 0;
  color: #e8c07e;
}
.hud-readonly-note {
  flex: 1 1 100%;
  font-size: 9px;
  color: #6b8cae;
}
.hud-toggle {
  position: absolute;
  top: 44px;
  right: 8px;
  z-index: 4;
  padding: 4px 8px;
  font-size: 10px;
  color: #b8c8e0;
  background: rgba(15, 17, 21, 0.85);
  border: 1px solid #3a4558;
  border-radius: 4px;
  cursor: pointer;
  pointer-events: auto;
}
.hud-toggle:hover {
  border-color: #5a6a82;
  color: #e8eaed;
}
.vp-hud-compact {
  padding: 4px 8px !important;
  min-height: auto;
}
.hud-mini-line {
  font-size: 10px;
  color: #9fdfb8;
  font-variant-numeric: tabular-nums;
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
  flex: 1 1 auto;
  min-width: 0;
  font-size: 11px;
  font-weight: 600;
}
.vp-stack-source {
  border-color: #3a5f78;
}
.vp-stack-result {
  border-color: #785f3a;
}
.vp-canvas-wrap {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
  display: flex;
  flex-direction: column;
}
.vp-mem-corner {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 3;
  max-width: min(340px, calc(100% - 96px));
  padding: 5px 8px;
  font-size: 10px;
  line-height: 1.35;
  color: #d8e8f4;
  background: rgba(12, 14, 18, 0.86);
  border: 1px solid #3d4a5c;
  border-radius: 4px;
  pointer-events: none;
  font-variant-numeric: tabular-nums;
  box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35);
}
.vp-mem-corner--src {
  border-color: #4a7a9e;
  color: #c8e4f8;
}
.vp-mem-corner--dst {
  border-color: #9a7a4a;
  color: #f8e4c8;
}
.mem-corner-label {
  display: block;
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.06em;
  color: #8eb8d8;
  margin-bottom: 2px;
}
.vp-mem-corner--dst .mem-corner-label {
  color: #d8b88e;
}
.mem-corner-main {
  display: block;
  font-weight: 600;
}
.mem-corner-sub {
  display: block;
  font-size: 9px;
  color: #8e97a6;
  margin-top: 2px;
}
.vp-canvas {
  flex: 1 1 auto;
  min-height: 0;
  position: relative;
}
.vp-hud {
  position: absolute;
  left: 8px;
  right: 8px;
  bottom: 8px;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 6px 8px;
  font-size: 10px;
  color: #d0d8e6;
  background: rgba(15, 17, 21, 0.72);
  border: 1px solid #3a4558;
  border-radius: 4px;
  pointer-events: auto;
  z-index: 2;
}
.hud-stats {
  flex: 1 1 100%;
  min-width: 0;
  font-variant-numeric: tabular-nums;
}
.hud-link {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: 0 0 auto;
  margin: 0;
  font-size: 10px;
  color: #b8c8e0;
  cursor: pointer;
}
.hud-lod {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  margin: 0;
  cursor: pointer;
}
.hud-lod input[type='range'] {
  width: 88px;
  vertical-align: middle;
}
.hud-lod-val {
  min-width: 34px;
  color: #a8d4ff;
  font-variant-numeric: tabular-nums;
}
.vp-canvas :deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
}
</style>
