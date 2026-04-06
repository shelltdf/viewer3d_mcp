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
import {
  computeMeshStats,
  computeSceneResourceCounts,
  applyLodDrawRange,
  invalidateLodCacheForRoot,
} from '../utils/meshStats.js'
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
import {
  applyViewportViewState,
  clearSkeletonHelpers,
  collectVertexAttributeNamesForDebug,
  vertexAttrDisplayName,
  TEXTURE_PREVIEW_SLOT_KEYS,
} from '../utils/displayModeHelpers.js'
import { deepCloneMeshGeometries, isolateResultBranchResources } from '../utils/isolateResultResources.js'
import { applyRendererToneAndPipeline, applyDualViewportShadows } from '../utils/viewportRenderSettings.js'
import {
  syncMaterialsVertexTangentsFromGeometry,
  syncStandardMaterialsForNormalMap,
} from '../utils/meshTangentMaterialSync.js'
import {
  meshoptSimplifierReady,
  isMeshoptSimplifySupported,
  applyMeshoptSimplifyToGeometry,
} from '../utils/meshoptSimplifyGeometry.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import {
  applySsaoWorldScale,
  patchSsaoCameraUniforms,
  createAxisGizmoContext,
  renderCornerAxisGizmo,
} from '../utils/viewportPostFx.js'

const props = defineProps({
  /** 是否显示「处理前」视口格子 */
  showSource: { type: Boolean, default: true },
  /** 是否显示「处理后」视口格子；二者可单独或同时开启 */
  showResult: { type: Boolean, default: true },
  /** 由工作台切换：隐藏左右 Dock 并放大中央视口；双视口时左右等分，单视口时单格铺满 */
  viewportMaximized: { type: Boolean, default: false },
  /** 在每侧场景根物体下追加圆形辅助地面（便于观察平行光阴影） */
  helperGround: { type: Boolean, default: false },
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
const viewHudSource = ref({
  cpu: 0,
  vram: 0,
  geo: 0,
  tex: 0,
  meshes: 0,
  triangles: 0,
  vertices: 0,
  materials: 0,
  texturesScene: 0,
})
const viewHudResult = ref({
  cpu: 0,
  vram: 0,
  geo: 0,
  tex: 0,
  meshes: 0,
  triangles: 0,
  vertices: 0,
  materials: 0,
  texturesScene: 0,
})

function defaultViewState() {
  return {
    geometryMode: 'solid',
    lightingMode: 'studio',
    textureMode: 'full',
    materialMode: 'original',
    skeletonMode: 'off',
    vertexAttrMode: 'off',
  }
}

/** 处理前 / 处理后各自独立的显示状态（与 Three 场景无响应式绑定，修改后由 watch 应用） */
const viewStateSource = ref(defaultViewState())
const viewStateResult = ref(defaultViewState())
const hudExpandedSource = ref(true)
const hudExpandedResult = ref(true)
/** 左右视口各自的渲染策略（管线 / 阴影 / HDR / SSAO 互不联动） */
const renderSettingsSource = ref({
  pipeline: 'pbr',
  shadow: 'off',
  toneMapping: 'aces',
  ssao: 'off',
})
const renderSettingsResult = ref({
  pipeline: 'pbr',
  shadow: 'off',
  toneMapping: 'aces',
  ssao: 'off',
})
const vertexAttrNamesSource = ref([])
const vertexAttrNamesResult = ref([])

function refreshVertexAttrNameLists() {
  vertexAttrNamesSource.value = collectVertexAttributeNamesForDebug(sourceRoot)
  vertexAttrNamesResult.value = collectVertexAttributeNamesForDebug(resultRoot)
}

/** 处理后网格改索引 / 切线等之后：重算 LOD draw range 并重应用右侧视口材质，避免「整模消失」或属性面板解析失败 */
function afterResultGeometryMutation() {
  if (!resultRoot) return
  try {
    invalidateLodCacheForRoot(resultRoot)
    applyLodDrawRange(resultRoot, lodResult.value)
    reapplyViewResult()
  } catch (err) {
    emit('viewer-error', err?.message || String(err))
  }
}

watch(vertexAttrNamesSource, (names) => {
  const m = viewStateSource.value.vertexAttrMode
  if (typeof m === 'string' && m.startsWith('attr:')) {
    const k = m.slice(5)
    if (k && !names.includes(k)) viewStateSource.value.vertexAttrMode = 'off'
  }
})
watch(vertexAttrNamesResult, (names) => {
  const m = viewStateResult.value.vertexAttrMode
  if (typeof m === 'string' && m.startsWith('attr:')) {
    const k = m.slice(5)
    if (k && !names.includes(k)) viewStateResult.value.vertexAttrMode = 'off'
  }
})
const displayCtxA = { skeletonHelpers: [] }
const displayCtxB = { skeletonHelpers: [] }
let memEmitTick = 0
let gpuPeakEst = 0
/** @type {EffectComposer | null} */
let composerA = null
/** @type {EffectComposer | null} */
let composerB = null
/** @type {SSAOPass | null} */
let ssaoPassA = null
/** @type {SSAOPass | null} */
let ssaoPassB = null
/** 右上角 XYZ(RGB) 轴辅助 */
/** @type {ReturnType<typeof createAxisGizmoContext> | null} */
let gizmoCtxA = null
/** @type {ReturnType<typeof createAxisGizmoContext> | null} */
let gizmoCtxB = null

function retuneSsaoWorldScales() {
  applySsaoWorldScale(ssaoPassA, sourceRoot)
  applySsaoWorldScale(ssaoPassB, resultRoot)
}

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
/** 用于 ResizeObserver：flex 布局变化时未必触发 window.resize */
const sourceCanvasWrapRef = ref(null)
const resultCanvasWrapRef = ref(null)
/** 打开模型：先清空再拉取；与 LoadingManager 进度联动 */
const loadProgress = ref({ active: false, ratio: 0, message: '' })
/** @type {ResizeObserver | null} */
let resizeObserverA = null
/** @type {ResizeObserver | null} */
let resizeObserverB = null

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

function disposePostProcess() {
  try {
    ssaoPassA?.dispose()
  } catch {
    /* ignore */
  }
  try {
    ssaoPassB?.dispose()
  } catch {
    /* ignore */
  }
  try {
    composerA?.dispose()
  } catch {
    /* ignore */
  }
  try {
    composerB?.dispose()
  } catch {
    /* ignore */
  }
  ssaoPassA = null
  ssaoPassB = null
  composerA = null
  composerB = null
}

function rebuildPostProcess() {
  disposePostProcess()
  const rsA = renderSettingsSource.value
  const rsB = renderSettingsResult.value
  if (!rendererA || !rendererB || !sceneA || !sceneB || !cameraA || !cameraB) return
  const elA = sourceEl.value
  const elB = resultEl.value
  const wA = elA?.clientWidth || 0
  const hA = elA?.clientHeight || 0
  const wB = elB?.clientWidth || 0
  const hB = elB?.clientHeight || 0
  const prA = rendererA.getPixelRatio()
  const prB = rendererB.getPixelRatio()

  if ((rsA.ssao === 'on' || rsA.ssao === 'only') && wA && hA) {
    composerA = new EffectComposer(rendererA)
    composerA.addPass(new RenderPass(sceneA, cameraA))
    ssaoPassA = new SSAOPass(sceneA, cameraA, wA, hA)
    ssaoPassA.output = rsA.ssao === 'only' ? SSAOPass.OUTPUT.SSAO : SSAOPass.OUTPUT.Default
    composerA.addPass(ssaoPassA)
    composerA.addPass(new OutputPass())
    applySsaoWorldScale(ssaoPassA, sourceRoot)
    composerA.setPixelRatio(prA)
    composerA.setSize(wA, hA)
  }

  if ((rsB.ssao === 'on' || rsB.ssao === 'only') && wB && hB) {
    composerB = new EffectComposer(rendererB)
    composerB.addPass(new RenderPass(sceneB, cameraB))
    ssaoPassB = new SSAOPass(sceneB, cameraB, wB, hB)
    ssaoPassB.output = rsB.ssao === 'only' ? SSAOPass.OUTPUT.SSAO : SSAOPass.OUTPUT.Default
    composerB.addPass(ssaoPassB)
    composerB.addPass(new OutputPass())
    applySsaoWorldScale(ssaoPassB, resultRoot)
    composerB.setPixelRatio(prB)
    composerB.setSize(wB, hB)
  }
}

function updateHelperGroundShadowFlags() {
  const setRecv = (scene, on) => {
    if (!scene) return
    for (const c of scene.children) {
      if (c.userData?.__workbenchHelperGround) c.receiveShadow = on
    }
  }
  setRecv(sceneA, renderSettingsSource.value.shadow === 'on')
  setRecv(sceneB, renderSettingsResult.value.shadow === 'on')
}

function removeWorkbenchHelperGrounds(scene) {
  if (!scene) return
  const rm = []
  for (const c of scene.children) {
    if (c.userData?.__workbenchHelperGround) rm.push(c)
  }
  for (const c of rm) {
    scene.remove(c)
    c.geometry?.dispose?.()
    const mats = Array.isArray(c.material) ? c.material : [c.material]
    for (const m of mats) m?.dispose?.()
  }
}

/**
 * @param {import('three').Object3D | null} root
 * @param {boolean} shadowOn
 */
function createHelperGroundMesh(root, shadowOn) {
  if (!root) return null
  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) return null
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const horizontal = Math.max(size.x, size.z, 1e-6)
  const radius = Math.max(
    horizontal * 0.65,
    Math.hypot(size.x, size.z) * 0.42,
    size.y * 0.55,
    2,
  )
  const geo = new THREE.CircleGeometry(radius, 96)
  const mat = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.9,
    metalness: 0,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  const eps = Math.max(0.0005 * size.y, 0.002)
  mesh.position.set(center.x, box.min.y - eps, center.z)
  mesh.receiveShadow = !!shadowOn
  mesh.castShadow = false
  mesh.userData.__workbenchHelperGround = true
  mesh.name = 'WorkbenchHelperGround'
  return mesh
}

/** 无模型时仍可提供半径 1 的默认地面 */
function createDefaultHelperGroundMesh(shadowOn) {
  const geo = new THREE.CircleGeometry(1, 96)
  const mat = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.9,
    metalness: 0,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.set(0, -0.002, 0)
  mesh.receiveShadow = !!shadowOn
  mesh.castShadow = false
  mesh.userData.__workbenchHelperGround = true
  mesh.name = 'WorkbenchHelperGround'
  return mesh
}

function refreshHelperGrounds() {
  if (!sceneA || !sceneB) return
  removeWorkbenchHelperGrounds(sceneA)
  removeWorkbenchHelperGrounds(sceneB)
  if (!props.helperGround) return
  const shA = renderSettingsSource.value.shadow === 'on'
  const shB = renderSettingsResult.value.shadow === 'on'
  let gA = createHelperGroundMesh(sourceRoot, shA)
  if (!gA) gA = createDefaultHelperGroundMesh(shA)
  sceneA.add(gA)
  let gB = createHelperGroundMesh(resultRoot, shB)
  if (!gB) gB = createDefaultHelperGroundMesh(shB)
  sceneB.add(gB)
}

function syncMeshesUsingMaterial(material) {
  if (!material) return
  const visit = (root) => {
    if (!root) return
    root.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return
      const mats = Array.isArray(o.material) ? o.material : [o.material]
      if (!mats.includes(material)) return
      syncMaterialsVertexTangentsFromGeometry(o)
      syncStandardMaterialsForNormalMap(o)
    })
  }
  visit(sourceRoot)
  visit(resultRoot)
}

function applyGlobalRendererSettings() {
  const rsA = renderSettingsSource.value
  const rsB = renderSettingsResult.value
  applyRendererToneAndPipeline(rendererA, rsA.pipeline, rsA.toneMapping)
  applyRendererToneAndPipeline(rendererB, rsB.pipeline, rsB.toneMapping)
  applyDualViewportShadows(
    sceneA,
    sourceRoot,
    rendererA,
    rsA.shadow === 'on' ? 'on' : 'off',
    sceneB,
    resultRoot,
    rendererB,
    rsB.shadow === 'on' ? 'on' : 'off',
  )
  updateHelperGroundShadowFlags()
  rebuildPostProcess()
}

function teardownResizeObservers() {
  resizeObserverA?.disconnect()
  resizeObserverB?.disconnect()
  resizeObserverA = null
  resizeObserverB = null
}

function setupResizeObservers() {
  teardownResizeObservers()
  if (typeof ResizeObserver === 'undefined') return
  const elA = sourceCanvasWrapRef.value
  const elB = resultCanvasWrapRef.value
  if (!elA || !elB) return
  resizeObserverA = new ResizeObserver(() => nextTick(() => onResize()))
  resizeObserverA.observe(elA)
  resizeObserverB = new ResizeObserver(() => nextTick(() => onResize()))
  resizeObserverB.observe(elB)
}

/**
 * 打开新文件前：卸载当前处理前/处理后场景并广播空大纲（再显示进度条与请求网络）
 */
function resetModelStateBeforeLoad() {
  clearResult()
  clearSource()
  sourceClips = []
  resultClips = []
  statsSource.value = { meshes: 0, triangles: 0, vertices: 0 }
  emit('outline-updated', { panel: 'source', outline: [], animations: 0, clips: [] })
  emit('outline-updated', { panel: 'result', outline: [], animations: 0, clips: [] })
  nextTick(() => onResize())
}

/** @param {THREE.LoadingManager | null | undefined} mgr */
function wrapManagerProgress(mgr) {
  if (!mgr) return () => {}
  const prev = mgr.onProgress
  mgr.onProgress = (url, loaded, total) => {
    try {
      prev?.(url, loaded, total)
    } catch {
      /* ignore */
    }
    if (loadProgress.value.active && total > 0) {
      loadProgress.value.ratio = Math.min(0.98, loaded / total)
    }
  }
  return () => {
    mgr.onProgress = prev
  }
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
  vertexAttrNamesSource.value = []
  refreshHelperGrounds()
  retuneSsaoWorldScales()
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
  vertexAttrNamesResult.value = []
  refreshHelperGrounds()
  retuneSsaoWorldScales()
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
  refreshHelperGrounds()
  retuneSsaoWorldScales()
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
  refreshHelperGrounds()
  retuneSsaoWorldScales()
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
    deepCloneMeshGeometries(resultRoot)
    isolateResultBranchResources(resultRoot)
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
    refreshVertexAttrNameLists()
    applyGlobalRendererSettings()
    refreshHelperGrounds()
    retuneSsaoWorldScales()
    onResize()
  } catch (e) {
    emit('viewer-error', e?.message || String(e))
  }
}

function resolveOutlineItem(panel, item) {
  try {
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
        try {
          meshMaterialInfo = getMeshMaterialsMemoryTable(object)
        } catch {
          meshMaterialInfo = null
        }
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
  } catch {
    return { kind: 'empty' }
  }
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

watch(
  [renderSettingsSource, renderSettingsResult],
  () => {
    applyGlobalRendererSettings()
    onResize()
  },
  { deep: true },
)

watch(
  () => props.helperGround,
  () => refreshHelperGrounds(),
)

function maybeRaytraceHint(pipeline) {
  if (pipeline === 'raytrace')
    emit(
      'status',
      '「光追」模式占位：标准 WebGL 无实时硬件光追；当前与 PBR 前向路径等效，离线路径追踪可后续接入',
    )
}

watch(
  () => renderSettingsSource.value.pipeline,
  (p) => maybeRaytraceHint(p),
)
watch(
  () => renderSettingsResult.value.pipeline,
  (p) => maybeRaytraceHint(p),
)

async function loadUrl(url) {
  if (!gltfLoader) {
    emit('viewer-error', '视口未就绪，请稍后重试')
    return
  }
  resetModelStateBeforeLoad()
  loadProgress.value = { active: true, ratio: 0, message: '正在打开…' }
  const popProgress = wrapManagerProgress(sharedLoadingManager)
  try {
    const pathOnly = url.split('?')[0].split('#')[0].toLowerCase()
    if (pathOnly.endsWith('.obj')) {
      loadProgress.value.message = '正在加载 OBJ…'
      await loadObjFromUrl(url)
      return
    }
    loadProgress.value.message = '正在加载 glTF…'
    const gltf = await gltfLoader.loadAsync(url)
    loadProgress.value.ratio = 1
    applyGltfToSource(gltf)
    emit('status', `已加载：${url}；已自动深度克隆至「处理后」`)
  } catch (e) {
    const msg = e?.message || String(e)
    emit('viewer-error', msg)
    throw e
  } finally {
    popProgress()
    loadProgress.value.active = false
    loadProgress.value.ratio = 0
    nextTick(() => onResize())
  }
}

async function loadFile(file) {
  const name = file.name.toLowerCase()
  if (name.endsWith('.obj')) {
    resetModelStateBeforeLoad()
    loadProgress.value = { active: true, ratio: 0.2, message: '正在解析 OBJ…' }
    try {
      await loadObjSingleBlob(file)
    } catch (e) {
      const msg = e?.message || String(e)
      emit('viewer-error', msg)
      throw e
    } finally {
      loadProgress.value.active = false
      nextTick(() => onResize())
    }
    return
  }
  if (!gltfLoader) {
    emit('viewer-error', '视口未就绪，请稍后重试')
    return
  }
  resetModelStateBeforeLoad()
  loadProgress.value = { active: true, ratio: 0, message: `正在加载：${file.name}` }
  const popProgress = wrapManagerProgress(sharedLoadingManager)
  const objectUrl = URL.createObjectURL(file)
  try {
    const gltf = await gltfLoader.loadAsync(objectUrl)
    loadProgress.value.ratio = 1
    applyGltfToSource(gltf)
    emit('status', `已加载：${file.name}；已自动深度克隆至「处理后」`)
  } catch (e) {
    const msg = e?.message || String(e)
    emit('viewer-error', msg)
    throw e
  } finally {
    popProgress()
    URL.revokeObjectURL(objectUrl)
    loadProgress.value.active = false
    nextTick(() => onResize())
  }
}

async function loadFiles(fileList) {
  const files = Array.from(fileList || [])
  if (!files.length) throw new Error('未选择文件')

  const hasObj = files.some((f) => f.name.toLowerCase().endsWith('.obj'))
  if (hasObj) {
    resetModelStateBeforeLoad()
    loadProgress.value = { active: true, ratio: 0, message: '正在加载 OBJ/MTL…' }
    try {
      await loadObjFromFileList(files)
    } catch (e) {
      const msg = e?.message || String(e)
      emit('viewer-error', msg)
      throw e
    } finally {
      loadProgress.value.active = false
      nextTick(() => onResize())
    }
    return
  }

  if (files.length === 1 && files[0].name.toLowerCase().endsWith('.glb')) {
    await loadFile(files[0])
    return
  }
  resetModelStateBeforeLoad()
  loadProgress.value = { active: true, ratio: 0, message: '正在加载 glTF 及依赖…' }
  const map = new Map()
  for (const f of files) {
    map.set(f.name, URL.createObjectURL(f))
  }
  const gltfFile =
    files.find((f) => f.name.toLowerCase().endsWith('.gltf')) ||
    files.find((f) => f.name.toLowerCase().endsWith('.glb'))
  if (!gltfFile) {
    for (const u of map.values()) URL.revokeObjectURL(u)
    loadProgress.value.active = false
    throw new Error('请至少选择一个 .gltf 或 .glb 文件')
  }
  const manager = new THREE.LoadingManager()
  attachCompressedTextureHandlers(manager, rendererA)
  manager.setURLModifier(urlModifierFromFileMap(map))
  const popProgress = wrapManagerProgress(manager)
  const localLoader = new GLTFLoader(manager)
  localLoader.setDRACOLoader(dracoLoader)
  try {
    const gltf = await localLoader.loadAsync(map.get(gltfFile.name))
    loadProgress.value.ratio = 1
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
    popProgress()
    for (const u of map.values()) URL.revokeObjectURL(u)
    loadProgress.value.active = false
    nextTick(() => onResize())
  }
}

function refreshViewHud(root, renderer, targetRef) {
  if (!root) {
    targetRef.value = {
      cpu: 0,
      vram: 0,
      geo: 0,
      tex: 0,
      meshes: 0,
      triangles: 0,
      vertices: 0,
      materials: 0,
      texturesScene: 0,
      geometries: 0,
      textures: 0,
    }
    return
  }
  const est = estimateSceneMemory(root)
  const cnt = computeSceneResourceCounts(root)
  const geo = est.breakdown.find((b) => b.id === 'geo')?.bytes || 0
  const tex = est.breakdown.find((b) => b.id === 'tex')?.bytes || 0
  const vramEst = geo + tex
  const info = renderer?.info?.memory
  targetRef.value = {
    cpu: est.total,
    vram: vramEst,
    geo,
    tex,
    meshes: cnt.meshes,
    triangles: cnt.triangles,
    vertices: cnt.vertices,
    materials: cnt.materials,
    texturesScene: cnt.textures,
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
  const ssaoA = renderSettingsSource.value.ssao
  const ssaoB = renderSettingsResult.value.ssao
  const useCompA = composerA && (ssaoA === 'on' || ssaoA === 'only')
  const useCompB = composerB && (ssaoB === 'on' || ssaoB === 'only')
  if (ssaoPassA) patchSsaoCameraUniforms(ssaoPassA, cameraA)
  if (ssaoPassB) patchSsaoCameraUniforms(ssaoPassB, cameraB)
  if (useCompA) composerA.render(delta)
  else if (rendererA && sceneA && cameraA) rendererA.render(sceneA, cameraA)
  if (useCompB) composerB.render(delta)
  else if (rendererB && sceneB && cameraB) rendererB.render(sceneB, cameraB)
  if (props.showSource && rendererA && cameraA) renderCornerAxisGizmo(rendererA, cameraA, gizmoCtxA)
  if (props.showResult && rendererB && cameraB) renderCornerAxisGizmo(rendererB, cameraB, gizmoCtxB)
}

function onResize() {
  const elA = sourceEl.value
  const elB = resultEl.value
  if (!elA || !elB || !rendererA || !rendererB) return
  const pr = Math.min(window.devicePixelRatio || 1, 2)
  rendererA.setPixelRatio(pr)
  rendererB.setPixelRatio(pr)
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
  if (composerA && wA && hA) {
    composerA.setPixelRatio(rendererA.getPixelRatio())
    composerA.setSize(wA, hA)
  }
  if (composerB && wB && hB) {
    composerB.setPixelRatio(rendererB.getPixelRatio())
    composerB.setSize(wB, hB)
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
  gizmoCtxA = createAxisGizmoContext()
  gizmoCtxB = createAxisGizmoContext()
  applyGlobalRendererSettings()
  animate()
  nextTick(() => setupResizeObservers())
}

onMounted(async () => {
  await nextTick()
  mount()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', onResize)
  teardownResizeObservers()
  cancelAnimationFrame(animationId)
  disposePostProcess()
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
  else if (rendererA) nextTick(() => setupResizeObservers())
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
      const r = mergeTextureGroup(root, op.textures, op.keepUuid, [sourceRoot])
      textureMerged += r.merged
    } else if (op.kind === 'material') {
      const r = mergeMaterialGroup(root, op.materials, op.keepUuid, [sourceRoot])
      materialMerged += r.merged
    } else if (op.kind === 'object' || op.kind === 'mesh') {
      const r = mergeMeshInstances(op.keepUuid, op.items)
      nodesRemoved += r.removed
    }
  }
  refreshOutline('result')
  refreshVertexAttrNameLists()
  return { textureMerged, materialMerged, nodesRemoved, groupsApplied: ops.length }
}

/**
 * 对「处理后」场景中所有 Mesh / SkinnedMesh 的 BufferGeometry 做 meshoptimizer WASM 简化。
 * @param {{ ratio: number, algorithm: string, lockBorder: boolean }} opts
 */
async function simplifyResultMeshes(opts) {
  await meshoptSimplifierReady()
  if (!isMeshoptSimplifySupported()) {
    throw new Error('当前环境不支持 meshoptimizer WASM（需启用 WebAssembly）')
  }
  if (!resultRoot) throw new Error('请先加载模型并确保存在「处理后」场景')

  const skipped = []
  let meshes = 0
  let triBefore = 0
  let triAfter = 0

  const candidates = []
  resultRoot.traverse((obj) => {
    if (!obj.isMesh && !obj.isSkinnedMesh) return
    const g = obj.geometry
    if (!g || !g.isBufferGeometry) return
    candidates.push({ obj, g })
  })

  for (const { obj, g } of candidates) {
    try {
      if (g.groups && g.groups.length > 1) {
        skipped.push(`${obj.name || obj.uuid}: 多材质 groups（未处理）`)
        continue
      }
      if (g.morphAttributes && Object.keys(g.morphAttributes).length > 0) {
        skipped.push(`${obj.name || obj.uuid}: 含 morph 目标（未处理）`)
        continue
      }
      const pos = g.getAttribute('position')
      if (!pos) {
        skipped.push(`${obj.name || obj.uuid}: 无 position`)
        continue
      }
      const idx = g.index
      const tb = idx ? idx.count / 3 : pos.count / 3
      const r = await applyMeshoptSimplifyToGeometry(g, opts)
      triBefore += tb
      triAfter += r.trianglesAfter
      meshes++
    } catch (e) {
      skipped.push(`${obj.name || obj.uuid}: ${e?.message || String(e)}`)
    }
  }

  afterResultGeometryMutation()
  refreshOutline('result')
  refreshVertexAttrNameLists()
  emit('result-updated', {
    outline: buildRichOutline(resultRoot, { clips: resultClips }),
    animations: resultClips.length,
    clips: resultClips,
  })

  return { meshes, triBefore, triAfter, skipped }
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
  refreshVertexAttrNameLists,
  afterResultGeometryMutation,
  syncMeshesUsingMaterial,
  refreshOutline,
  simplifyResultMeshes,
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
      'viewport-maximized': viewportMaximized,
      'viewport-max-split': viewportMaximized && showSource && showResult,
      'viewport-max-single': viewportMaximized && showSource !== showResult,
    }"
  >
    <div v-if="loadProgress.active" class="vp-load-overlay" aria-live="polite">
      <div class="vp-load-card">
        <p class="vp-load-msg">{{ loadProgress.message }}</p>
        <div class="vp-load-track">
          <div
            class="vp-load-fill"
            :style="{ width: `${Math.min(100, Math.max(0, loadProgress.ratio * 100))}%` }"
          />
        </div>

        <p class="vp-load-hint">已关闭上一模型，正在拉取与解析…</p>
      </div>
    </div>
    <div v-show="showSource" class="vp-stack vp-stack-source">
      <div class="vp-label-row">
        <div class="vp-label">处理前（只读快照 · 与处理后无引用关系）</div>
        <div class="vp-toolbar" title="仅影响左侧视口显示，不改源数据">
          <select
            v-model="viewStateSource.geometryMode"
            class="vt-sel"
            title="点云：对 Mesh/SkinnedMesh 用顶点位置绘制点，即显示顶点"
          >
            <option value="solid">实体</option>
            <option value="wireframe">线框</option>
            <option value="points">点云（顶点）</option>
          </select>
          <select v-model="viewStateSource.vertexAttrMode" class="vt-sel vt-sel-wide" title="将顶点缓冲区映射为着色；点云模式下不生效">
            <option value="off">顶点属性·关</option>
            <option value="meshNormal">顶点属性·三角法线</option>
            <option v-for="n in vertexAttrNamesSource" :key="'va-src-' + n" :value="'attr:' + n">
              顶点属性·{{ vertexAttrDisplayName(n) }}
            </option>
          </select>
          <select v-model="viewStateSource.lightingMode" class="vt-sel">
            <option value="studio">光照·影棚</option>
            <option value="soft">光照·柔和</option>
            <option value="flat">光照·平铺</option>
          </select>
          <select v-model="viewStateSource.textureMode" class="vt-sel vt-sel-wide" title="单槽：仅用该槽贴图赋 MeshBasic（含 envMap）">
            <option value="full">贴图·采样</option>
            <option value="albedoFlat">贴图·无光照</option>
            <option value="hideMaps">贴图·隐藏</option>
            <option v-for="key in TEXTURE_PREVIEW_SLOT_KEYS" :key="'tex-src-' + key" :value="'slot:' + key">
              槽·{{ key }}
            </option>
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
      <div class="vp-render-row" title="仅影响左侧视口 WebGL 与后期">
        <span class="vp-render-title">渲染与效果</span>
        <label class="vp-gl">
          <span>管线</span>
          <select v-model="renderSettingsSource.pipeline" class="vt-sel vt-sel-wide">
            <option value="classic">固定流水线</option>
            <option value="pbr">PBR</option>
            <option value="raytrace">光追（占位）</option>
          </select>
        </label>
        <label class="vp-gl">
          <span>阴影</span>
          <select v-model="renderSettingsSource.shadow" class="vt-sel">
            <option value="off">关</option>
            <option value="on">平行光阴影</option>
          </select>
        </label>
        <label class="vp-gl">
          <span>色调</span>
          <select v-model="renderSettingsSource.toneMapping" class="vt-sel vt-sel-wide" title="色调映射 / HDR 曝光风格">
            <option value="none">关</option>
            <option value="linear">Linear</option>
            <option value="aces">ACES Filmic</option>
            <option value="reinhard">Reinhard</option>
            <option value="cineon">Cineon</option>
            <option value="agx">AgX</option>
            <option value="neutral">Neutral</option>
          </select>
        </label>
        <label class="vp-gl">
          <span>SSAO</span>
          <select v-model="renderSettingsSource.ssao" class="vt-sel vt-sel-wide">
            <option value="off">关</option>
            <option value="on">合成 AO</option>
            <option value="only">仅显示 AO</option>
          </select>
        </label>
      </div>
      <div ref="sourceCanvasWrapRef" class="vp-canvas-wrap">
        <div ref="sourceEl" class="vp-canvas" />
        <div
          class="vp-mem-corner vp-mem-corner--src"
          title="左上角：场景资源计数；本格粗估：CPU 总占用与显存相关字节；GL 为 WebGL 本上下文计数"
        >
          <span class="mem-corner-label">场景 / 存储</span>
          <span class="mem-corner-counts"
            >△{{ viewHudSource.triangles.toLocaleString() }} · 顶点
            {{ viewHudSource.vertices.toLocaleString() }} · Mesh {{ viewHudSource.meshes }} · 材质
            {{ viewHudSource.materials }} · 贴图 {{ viewHudSource.texturesScene }}</span
          >
          <span class="mem-corner-main"
            >{{ fmtBytes(viewHudSource.cpu) }} · VRAM≈{{ fmtBytes(viewHudSource.vram) }}</span
          >
          <span class="mem-corner-sub"
            >Geo {{ fmtBytes(viewHudSource.geo) }} · Tex {{ fmtBytes(viewHudSource.tex) }} · GL 几何/纹理
            {{ viewHudSource.geometries }}/{{ viewHudSource.textures }}</span
          >
        </div>
        <button
          type="button"
          class="hud-toggle"
          :title="hudExpandedSource ? '折叠信息面板' : '展开信息面板'"
          @click="hudExpandedSource = !hudExpandedSource"
        >
          {{ hudExpandedSource ? '▼ 信息' : '▲ 信息' }}
        </button>
        <div v-if="hudExpandedSource" class="vp-hud">
          <div class="hud-stats">
            三角面 {{ statsSource.triangles.toLocaleString() }} · 顶点 {{ statsSource.vertices.toLocaleString() }} · Mesh
            {{ statsSource.meshes }}
          </div>
          <div class="hud-readonly-note">
            源网格 LOD 固定 100%（只读）。左右「渲染与效果」互不联动；仅相机可选「联动观察」见工作台工具栏。
          </div>
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
          <select
            v-model="viewStateResult.geometryMode"
            class="vt-sel"
            title="点云：对 Mesh/SkinnedMesh 用顶点位置绘制点，即显示顶点"
          >
            <option value="solid">实体</option>
            <option value="wireframe">线框</option>
            <option value="points">点云（顶点）</option>
          </select>
          <select v-model="viewStateResult.vertexAttrMode" class="vt-sel vt-sel-wide" title="将顶点缓冲区映射为着色；点云模式下不生效">
            <option value="off">顶点属性·关</option>
            <option value="meshNormal">顶点属性·三角法线</option>
            <option v-for="n in vertexAttrNamesResult" :key="'va-dst-' + n" :value="'attr:' + n">
              顶点属性·{{ vertexAttrDisplayName(n) }}
            </option>
          </select>
          <select v-model="viewStateResult.lightingMode" class="vt-sel">
            <option value="studio">光照·影棚</option>
            <option value="soft">光照·柔和</option>
            <option value="flat">光照·平铺</option>
          </select>
          <select v-model="viewStateResult.textureMode" class="vt-sel vt-sel-wide" title="单槽：仅用该槽贴图赋 MeshBasic（含 envMap）">
            <option value="full">贴图·采样</option>
            <option value="albedoFlat">贴图·无光照</option>
            <option value="hideMaps">贴图·隐藏</option>
            <option v-for="key in TEXTURE_PREVIEW_SLOT_KEYS" :key="'tex-dst-' + key" :value="'slot:' + key">
              槽·{{ key }}
            </option>
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
      <div class="vp-render-row" title="仅影响右侧视口 WebGL 与后期">
        <span class="vp-render-title">渲染与效果</span>
        <label class="vp-gl">
          <span>管线</span>
          <select v-model="renderSettingsResult.pipeline" class="vt-sel vt-sel-wide">
            <option value="classic">固定流水线</option>
            <option value="pbr">PBR</option>
            <option value="raytrace">光追（占位）</option>
          </select>
        </label>
        <label class="vp-gl">
          <span>阴影</span>
          <select v-model="renderSettingsResult.shadow" class="vt-sel">
            <option value="off">关</option>
            <option value="on">平行光阴影</option>
          </select>
        </label>
        <label class="vp-gl">
          <span>色调</span>
          <select v-model="renderSettingsResult.toneMapping" class="vt-sel vt-sel-wide" title="色调映射 / HDR 曝光风格">
            <option value="none">关</option>
            <option value="linear">Linear</option>
            <option value="aces">ACES Filmic</option>
            <option value="reinhard">Reinhard</option>
            <option value="cineon">Cineon</option>
            <option value="agx">AgX</option>
            <option value="neutral">Neutral</option>
          </select>
        </label>
        <label class="vp-gl">
          <span>SSAO</span>
          <select v-model="renderSettingsResult.ssao" class="vt-sel vt-sel-wide">
            <option value="off">关</option>
            <option value="on">合成 AO</option>
            <option value="only">仅显示 AO</option>
          </select>
        </label>
      </div>
      <div ref="resultCanvasWrapRef" class="vp-canvas-wrap">
        <div ref="resultEl" class="vp-canvas" />
        <div
          class="vp-mem-corner vp-mem-corner--dst"
          title="左上角：场景资源计数；本格粗估：CPU 总占用与显存相关字节；GL 为 WebGL 本上下文计数"
        >
          <span class="mem-corner-label">场景 / 存储</span>
          <span class="mem-corner-counts"
            >△{{ viewHudResult.triangles.toLocaleString() }} · 顶点
            {{ viewHudResult.vertices.toLocaleString() }} · Mesh {{ viewHudResult.meshes }} · 材质
            {{ viewHudResult.materials }} · 贴图 {{ viewHudResult.texturesScene }}</span
          >
          <span class="mem-corner-main"
            >{{ fmtBytes(viewHudResult.cpu) }} · VRAM≈{{ fmtBytes(viewHudResult.vram) }}</span
          >
          <span class="mem-corner-sub"
            >Geo {{ fmtBytes(viewHudResult.geo) }} · Tex {{ fmtBytes(viewHudResult.tex) }} · GL 几何/纹理
            {{ viewHudResult.geometries }}/{{ viewHudResult.textures }}</span
          >
        </div>
        <button
          type="button"
          class="hud-toggle"
          :title="hudExpandedResult ? '折叠信息面板' : '展开信息面板'"
          @click="hudExpandedResult = !hudExpandedResult"
        >
          {{ hudExpandedResult ? '▼ 信息' : '▲ 信息' }}
        </button>
        <div v-if="hudExpandedResult" class="vp-hud">
          <div class="hud-stats">
            三角面 {{ statsResult.triangles.toLocaleString() }} · 顶点 {{ statsResult.vertices.toLocaleString() }} · Mesh
            {{ statsResult.meshes }}（本侧 LOD 仅影响右侧几何副本）
          </div>
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
.vp-load-overlay {
  position: absolute;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(8, 10, 14, 0.78);
  pointer-events: all;
}
.vp-load-card {
  min-width: min(360px, 90vw);
  padding: 20px 24px;
  border-radius: 8px;
  background: linear-gradient(#2c323c, #252a32);
  border: 1px solid #4a5568;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
}
.vp-load-msg {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  color: #e8edf5;
}
.vp-load-track {
  height: 8px;
  border-radius: 4px;
  background: #141820;
  border: 1px solid #3a4558;
  overflow: hidden;
}
.vp-load-fill {
  height: 100%;
  border-radius: 3px;
  background: linear-gradient(90deg, #3d7a9a, #4a9f7a);
  transition: width 0.12s ease-out;
}
.vp-load-hint {
  margin: 12px 0 0;
  font-size: 11px;
  color: #8e97a6;
  line-height: 1.45;
}
.vp-render-row {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
  padding: 5px 8px;
  background: rgba(25, 28, 34, 0.95);
  border-bottom: 1px solid #2f3540;
}
.vp-render-title {
  font-size: 10px;
  font-weight: 700;
  color: #7ec4e8;
  letter-spacing: 0.04em;
  margin-right: 4px;
}
.vp-stack-result .vp-render-title {
  color: #e8c07e;
}
.dual-viewport.viewport-maximized.viewport-max-split {
  flex-direction: row;
  align-items: stretch;
}
.dual-viewport.viewport-maximized.viewport-max-split .vp-stack {
  flex: 1 1 50%;
  min-width: 0;
  min-height: 0;
}
.dual-viewport.viewport-maximized.viewport-max-single .vp-stack {
  flex: 1 1 auto;
  min-height: 0;
}
.vp-gl {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  cursor: pointer;
  user-select: none;
}
.vp-gl span:first-child {
  color: #8e97a6;
  font-size: 10px;
}
.vt-sel-wide {
  min-width: 120px;
  max-width: 160px;
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
  max-width: min(400px, calc(100% - 96px));
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
.mem-corner-counts {
  display: block;
  font-size: 9px;
  line-height: 1.35;
  color: #b8d4f0;
  margin-bottom: 4px;
  font-variant-numeric: tabular-nums;
}
.vp-mem-corner--dst .mem-corner-counts {
  color: #f0dcc0;
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
  max-width: 88px;
  min-width: 88px;
  height: 22px;
  vertical-align: middle;
  filter: none;
}
.hud-lod input[type='range']::-webkit-slider-thumb {
  margin-top: -5px;
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
