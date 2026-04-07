<script setup>
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import {
  buildCreature,
  creatureGeometryFingerprint,
  setSkeletonVisualizationVisible,
} from '../creature/proceduralCreature.js'
import {
  bakeCreatureAnimationClip,
  disposeExportClone,
  prepareCreatureExportClone,
  resetCreatureBindPose,
} from '../creature/bakeExport.js'
import {
  CREATURE_ANIMATIONS,
  applyCreatureJointAnimation,
  sampleCreatureAnimation,
} from '../creature/proceduralAnimations.js'
import { createRagdoll } from '../creature/ragdollPhysics.js'
import JSZip from 'jszip'

const props = defineProps({
  params: { type: Object, required: true },
})

/** 与 App.vue Dock 共用同一 v-model；根位移 + Armature 逐关节旋转（体表未蒙皮） */
const animationPreset = defineModel('animationPreset', { type: String, default: 'none' })

/** 物理布娃娃：仅控制是否 **物理解算**（world.step + 刚体→骨骼）；刚体/约束在生成角色时已建立 */
const ragdollEnabled = defineModel('ragdollEnabled', { type: Boolean, default: false })

const emit = defineEmits(['stats', 'hierarchy', 'selection'])

const containerRef = ref(null)
const canvasRef = ref(null)
const rendererRef = shallowRef(null)
const sceneRef = shallowRef(null)
const cameraRef = shallowRef(null)
const controlsRef = shallowRef(null)
const creatureRootRef = shallowRef(null)

let raf = 0
let resizeObserver = null
const exporting = ref(false)

/** @type {{ dispose: () => void, step: (dt: number) => void, syncBodiesFromBones: () => void, updateWireframes: () => void, wireGroup?: THREE.Group, boneBodyInfo?: Record<string, any> } | null} */
let ragdollCtx = null
let lastAnimTime = performance.now()

/** 与 `creatureGeometryFingerprint` 对齐，避免只改「模型/骨骼/物理显示」时误触发整机重建 */
let lastGeometryFingerprint = ''

const hierarchyTree = ref([])
const selectedInfo = ref(null)
const selectedPath = ref('')
const raycaster = new THREE.Raycaster()
const pointerNdc = new THREE.Vector2()
let modelHitbox = null
let modelWireframe = null
let groundMesh = null
let rebuildSeq = 0

function disposeModelHitbox() {
  if (!modelHitbox) return
  const s = sceneRef.value
  if (s) s.remove(modelHitbox)
  modelHitbox.geometry?.dispose?.()
  modelHitbox.material?.dispose?.()
  modelHitbox = null
}

function disposeModelWireframe() {
  if (!modelWireframe) return
  const s = sceneRef.value
  if (s) s.remove(modelWireframe)
  modelWireframe.geometry?.dispose?.()
  modelWireframe.material?.dispose?.()
  modelWireframe = null
}

function ensureModelWireframe() {
  const scene = sceneRef.value
  const root = creatureRootRef.value
  if (!scene || !root) return
  const body = root.getObjectByName('CreatureBody')
  if (!body?.isSkinnedMesh) return
  if (!modelWireframe) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x7fe8ff,
      wireframe: true,
      transparent: true,
      opacity: 0.58,
      depthTest: true,
      depthWrite: false,
    })
    modelWireframe = new THREE.SkinnedMesh(body.geometry, mat)
    modelWireframe.name = 'CreatureWireframe'
    modelWireframe.bind(body.skeleton)
    modelWireframe.renderOrder = 900
    scene.add(modelWireframe)
  }
}

function ensureModelHitbox() {
  const scene = sceneRef.value
  const root = creatureRootRef.value
  if (!scene || !root) return
  if (!modelHitbox) {
    modelHitbox = new THREE.Group()
    modelHitbox.name = 'JointHitboxes'
    scene.add(modelHitbox)
  }
  while (modelHitbox.children.length) {
    const c = modelHitbox.children.pop()
    c.geometry?.dispose?.()
    c.material?.dispose?.()
  }
  const arm = root.getObjectByName('Armature')
  const bones = arm ? arm.children[0]?.isBone ? [arm.children[0]] : [] : []
  if (!bones.length) return
  const q = [...bones]
  while (q.length) {
    const b = q.shift()
    for (const k of b.children) if (k.isBone) q.push(k)
    const ext = b.userData?.ragdollHalfExtents
    const r = ext?.x && ext?.z ? Math.max(0.006, Math.min(ext.x, ext.z)) : 0.02
    const geo = new THREE.EdgesGeometry(new THREE.SphereGeometry(r, 10, 8))
    const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 0.9 }))
    line.name = `JointHitbox_${b.name}`
    b.getWorldPosition(line.position)
    line.userData.pickInfo = {
      type: 'model-hitbox',
      boneName: b.name,
      radius: r,
    }
    modelHitbox.add(line)
  }
}

function buildBoneNode(bone, parentPath) {
  const path = parentPath ? `${parentPath}/${bone.name}` : bone.name
  return {
    id: path,
    name: bone.name,
    kind: 'bone',
    children: bone.children.filter((c) => c.isBone).map((c) => buildBoneNode(c, path)),
  }
}

function rebuildHierarchyAndSelection() {
  const root = creatureRootRef.value
  if (!root) {
    hierarchyTree.value = []
    selectedInfo.value = null
    selectedPath.value = ''
    return
  }
  const arm = root.getObjectByName('Armature')
  const body = root.getObjectByName('CreatureBody')
  const firstBone = arm?.children.find((c) => c.isBone)
  const physicsKids = Object.keys(ragdollCtx?.boneBodyInfo || {}).map((k) => ({
    id: `PhysicsHitboxes/${k}`,
    name: k,
    kind: 'physics-hitbox',
    children: [],
  }))
  hierarchyTree.value = [
    { id: 'CreatureBody', name: 'CreatureBody', kind: 'mesh', children: [] },
    {
      id: 'Armature',
      name: 'Armature',
      kind: 'armature',
      children: firstBone ? [buildBoneNode(firstBone, 'Armature')] : [],
    },
    {
      id: 'JointHitboxes',
      name: 'JointHitboxes',
      kind: 'hitbox',
      children: modelHitbox
        ? modelHitbox.children.map((c) => ({ id: `JointHitboxes/${c.name}`, name: c.name.replace('JointHitbox_', ''), kind: 'hitbox-node', children: [] }))
        : [],
    },
    { id: 'PhysicsHitboxes', name: 'PhysicsHitboxes', kind: 'physics', children: physicsKids },
  ]
  if (body && !selectedInfo.value) {
    selectedInfo.value = { type: 'mesh', name: 'CreatureBody' }
    selectedPath.value = 'CreatureBody'
  }
  emit('hierarchy', hierarchyTree.value)
  emit('selection', { path: selectedPath.value, info: selectedInfo.value, text: selectedInfoText.value })
}

const selectedInfoText = computed(() => {
  const v = selectedInfo.value
  if (!v) return '未选择对象'
  if (v.type === 'bone') {
    return `骨骼: ${v.name}\n主导顶点: ${v.dominantVertexCount ?? 0}\n平均主导权重: ${((v.avgDominantWeight ?? 0) * 100).toFixed(1)}%\n物理体: ${v.hitboxShape ?? '-'}`
  }
  if (v.type === 'physics-hitbox') {
    return `物理 hitbox\n骨骼: ${v.boneName}\n形状: ${v.shape}\n质量: ${v.mass?.toFixed?.(3) ?? '-'}`
  }
  if (v.type === 'model-hitbox') {
    return `关节 hitbox\n骨骼: ${v.boneName || '-'}\n半径: ${(v.radius || 0).toFixed(3)}`
  }
  return `${v.type || '对象'}: ${v.name || '-'}`
})

const flatHierarchy = computed(() => {
  const out = []
  function walk(nodes, depth) {
    for (const n of nodes || []) {
      out.push({ ...n, depth })
      if (n.children?.length) walk(n.children, depth + 1)
    }
  }
  walk(hierarchyTree.value, 0)
  return out
})

/** 模型（SkinnedMesh）、骨骼可视化、物理线框：统一走 `params`（Dock 与右上角面板同源） */
function applyViewportDisplayLayers() {
  const root = creatureRootRef.value
  if (!root) return
  const p = props.params
  const body = root.getObjectByName('CreatureBody')
  if (body) body.visible = p.showCreatureModel !== false
  if (modelWireframe) modelWireframe.visible = p.showCreatureWireframe === true
  const arm = root.getObjectByName('Armature')
  if (arm) setSkeletonVisualizationVisible(arm, p.showSkeleton !== false)
  if (ragdollCtx?.wireGroup) ragdollCtx.wireGroup.visible = p.showCreaturePhysics !== false
  if (modelHitbox) modelHitbox.visible = p.showCreatureHitbox !== false
  if (groundMesh) groundMesh.visible = p.showGround !== false
}

function disposeCreature(root) {
  if (!root) return
  const mats = new Set()
  root.traverse((obj) => {
    if (obj.isSkinnedMesh) obj.skeleton?.dispose?.()
    if (obj.isMesh || obj.isLine || obj.isLineSegments) {
      obj.geometry?.dispose?.()
      const mat = obj.material
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((m) => mats.add(m))
        else mats.add(mat)
      }
    }
  })
  mats.forEach((m) => m.dispose?.())
}

function disposeRagdollPhysics() {
  ragdollCtx?.dispose()
  ragdollCtx = null
}

/** 与 `buildCreature` 配套：建立 cannon World、地面、各骨刚体与约束及调试线框（不决定是否步进解算） */
function rebuildRagdollPhysics() {
  disposeRagdollPhysics()
  const scene = sceneRef.value
  const root = creatureRootRef.value
  if (!scene || !root) return
  ragdollCtx = createRagdoll(scene, root)
  if (!ragdollCtx) ragdollEnabled.value = false
  rebuildHierarchyAndSelection()
  applyViewportDisplayLayers()
}

async function rebuildCreature() {
  const seq = ++rebuildSeq
  const scene = sceneRef.value
  if (!scene) return
  disposeRagdollPhysics()
  disposeModelHitbox()
  disposeModelWireframe()
  const old = creatureRootRef.value
  if (old) {
    scene.remove(old)
    disposeCreature(old)
    creatureRootRef.value = null
  }
  const built = buildCreature(props.params)
  if (seq !== rebuildSeq) return
  const { group, stats } = built
  scene.add(group)
  creatureRootRef.value = group
  emit('stats', stats)
  rebuildRagdollPhysics()
  ensureModelHitbox()
  ensureModelWireframe()
  rebuildHierarchyAndSelection()
  lastGeometryFingerprint = creatureGeometryFingerprint(props.params)
  applyViewportDisplayLayers()
}

function fitCameraToCreature() {
  const cam = cameraRef.value
  const controls = controlsRef.value
  const root = creatureRootRef.value
  if (!cam || !controls || !root) return
  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) return
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 0.1)
  const dist = maxDim * 2.4
  cam.near = Math.max(0.01, dist / 300)
  cam.far = Math.max(100, dist * 25)
  cam.updateProjectionMatrix()
  cam.position.set(center.x + dist * 0.45, center.y + dist * 0.35, center.z + dist * 0.5)
  controls.target.copy(center)
  controls.update()
}

function selectBone(bone) {
  const root = creatureRootRef.value
  if (!bone || !root) return
  const stats = root.userData?.boneWeightStats?.[bone.name] || {}
  const pinfo = ragdollCtx?.boneBodyInfo?.[bone.name] || {}
  selectedInfo.value = {
    type: 'bone',
    name: bone.name,
    dominantVertexCount: stats.dominantVertexCount || 0,
    avgDominantWeight: stats.avgDominantWeight || 0,
    hitboxShape: pinfo.shape || '-',
  }
  selectedPath.value = `Armature/${bone.name}`
  emit('selection', { path: selectedPath.value, info: selectedInfo.value, text: selectedInfoText.value })
}

function pickByPointer(ev) {
  const camera = cameraRef.value
  const root = creatureRootRef.value
  if (!camera || !root) return
  const rect = canvasRef.value?.getBoundingClientRect()
  if (!rect) return
  pointerNdc.x = ((ev.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1
  pointerNdc.y = -((ev.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1
  raycaster.setFromCamera(pointerNdc, camera)
  const pickables = []
  if (modelHitbox) pickables.push(modelHitbox)
  if (modelHitbox) modelHitbox.children.forEach((c) => pickables.push(c))
  root.traverse((o) => {
    if (o.name.startsWith('JointViz_')) pickables.push(o)
  })
  ragdollCtx?.wireGroup?.traverse((o) => {
    if (o.isLineSegments) pickables.push(o)
  })
  const hits = raycaster.intersectObjects(pickables, true)
  if (!hits.length) return
  const hit = hits[0].object
  if (hit.userData?.pickInfo?.type === 'model-hitbox') {
    selectedInfo.value = { type: 'model-hitbox', ...(hit.userData.pickInfo || {}) }
    selectedPath.value = `JointHitboxes/${hit.name}`
    emit('selection', { path: selectedPath.value, info: selectedInfo.value, text: selectedInfoText.value })
    return
  }
  if (hit.userData?.pickInfo?.type === 'physics-hitbox') {
    const pi = hit.userData.pickInfo
    const pinfo = ragdollCtx?.boneBodyInfo?.[pi.boneName] || {}
    selectedInfo.value = {
      type: 'physics-hitbox',
      boneName: pi.boneName,
      shape: pinfo.shape || pi.shape,
      mass: pinfo.mass,
    }
    selectedPath.value = `PhysicsHitboxes/${pi.boneName}`
    emit('selection', { path: selectedPath.value, info: selectedInfo.value, text: selectedInfoText.value })
    return
  }
  let p = hit
  while (p && !p.isBone) p = p.parent
  if (p?.isBone) selectBone(p)
}

function selectByTree(node) {
  const root = creatureRootRef.value
  if (!root) return
  if (node.kind === 'mesh') {
    selectedInfo.value = { type: 'mesh', name: 'CreatureBody' }
    selectedPath.value = node.id
    emit('selection', { path: selectedPath.value, info: selectedInfo.value, text: selectedInfoText.value })
    return
  }
  if (node.kind === 'hitbox' && modelHitbox?.userData?.pickInfo) {
    selectedInfo.value = { type: 'model-hitbox', boneName: '-', radius: 0 }
    selectedPath.value = node.id
    emit('selection', { path: selectedPath.value, info: selectedInfo.value, text: selectedInfoText.value })
    return
  }
  if (node.kind === 'hitbox-node') {
    const obj = modelHitbox?.children?.find((c) => c.name === `JointHitbox_${node.name}`)
    if (!obj) return
    selectedInfo.value = { type: 'model-hitbox', ...(obj.userData.pickInfo || {}) }
    selectedPath.value = `JointHitboxes/${obj.name}`
    emit('selection', { path: selectedPath.value, info: selectedInfo.value, text: selectedInfoText.value })
    return
  }
  if (node.kind === 'physics-hitbox') {
    const pinfo = ragdollCtx?.boneBodyInfo?.[node.name] || {}
    selectedInfo.value = {
      type: 'physics-hitbox',
      boneName: node.name,
      shape: pinfo.shape || '-',
      mass: pinfo.mass,
    }
    selectedPath.value = node.id
    emit('selection', { path: selectedPath.value, info: selectedInfo.value, text: selectedInfoText.value })
    return
  }
  if (node.kind === 'bone') {
    const arm = root.getObjectByName('Armature')
    const bone = arm?.getObjectByName(node.name)
    if (bone?.isBone) selectBone(bone)
  }
}

function selectByPath(path) {
  if (!path) return
  const n = flatHierarchy.value.find((x) => x.id === path || path.endsWith('/' + x.name))
  if (n) selectByTree(n)
}

function animate() {
  raf = requestAnimationFrame(animate)
  const renderer = rendererRef.value
  const scene = sceneRef.value
  const camera = cameraRef.value
  const controls = controlsRef.value
  if (!renderer || !scene || !camera) return
  const now = performance.now()
  const dt = Math.min(0.05, (now - lastAnimTime) / 1000)
  lastAnimTime = now
  const root = creatureRootRef.value
  if (root) {
    const t = now * 0.001
    const preset = animationPreset.value || 'none'
    const kind = props.params.kind || 'quadruped'
    const pose = sampleCreatureAnimation(preset, t, kind)
    const gy = Number(root.userData?.groundOffsetY) || 0
    if (ragdollCtx) {
      if (ragdollEnabled.value) {
        ragdollCtx.step(dt)
      } else {
        root.position.set(pose.px, pose.py + gy, pose.pz)
        root.rotation.set(pose.rx, pose.ry, pose.rz, 'XYZ')
        const armature = root.getObjectByName('Armature')
        applyCreatureJointAnimation(armature, preset, t, kind)
        ragdollCtx.syncBodiesFromBones()
        ragdollCtx.updateWireframes()
      }
    } else {
      root.position.set(pose.px, pose.py + gy, pose.pz)
      root.rotation.set(pose.rx, pose.ry, pose.rz, 'XYZ')
      const armature = root.getObjectByName('Armature')
      applyCreatureJointAnimation(armature, preset, t, kind)
    }
    ensureModelHitbox()
  }
  controls?.update()
  renderer.render(scene, camera)
}

function onResize() {
  const el = containerRef.value
  const renderer = rendererRef.value
  const camera = cameraRef.value
  if (!el || !renderer || !camera) return
  const w = el.clientWidth
  const h = el.clientHeight
  camera.aspect = w / Math.max(h, 1)
  camera.updateProjectionMatrix()
  renderer.setSize(w, h, false)
}

async function exportCreatureZip() {
  const root = creatureRootRef.value
  if (!root || exporting.value) return
  exporting.value = true
  const kind = props.params.kind || 'quadruped'
  const sub = props.params.subspecies != null ? String(props.params.subspecies) : ''
  const base = sub
    ? `creature-${kind}-${sub}-${props.params.seed}`
    : `creature-${kind}-${props.params.seed}`

  const animPresets = CREATURE_ANIMATIONS.map((a) => a.id).filter((id) => id !== 'none')
  const clipsMeta = []
  let modelClone = null
  const disposable = []
  try {
    const exporter = new GLTFExporter()

    modelClone = prepareCreatureExportClone(root, { stripBodyMesh: false })
    resetCreatureBindPose(modelClone)
    const modelBuf = await exporter.parseAsync(modelClone, {
      binary: true,
      truncateDrawRange: true,
    })
    if (!(modelBuf instanceof ArrayBuffer))
      throw new Error('model.glb：期望 binary glTF（ArrayBuffer）')

    const zip = new JSZip()
    zip.file('model.glb', modelBuf)

    for (const aid of animPresets) {
      const animClone = prepareCreatureExportClone(root, { stripBodyMesh: true })
      disposable.push(animClone)
      const clip = bakeCreatureAnimationClip(animClone, aid, kind, 30)
      const animBuf = await exporter.parseAsync(animClone, {
        binary: true,
        truncateDrawRange: true,
        animations: [clip],
      })
      if (!(animBuf instanceof ArrayBuffer)) {
        throw new Error(`animation_${aid}.glb：期望 binary glTF`)
      }
      const fname = `animation_${aid}.glb`
      zip.file(fname, animBuf)
      clipsMeta.push({ id: aid, file: fname, durationSec: clip.duration })
    }

    zip.file(
      'manifest.json',
      JSON.stringify(
        {
          generator: 'animal-studio',
          version: 2,
          kind,
          subspecies: props.params.subspecies ?? null,
          seed: props.params.seed,
          fpsBake: 30,
          skinned: true,
          files: {
            model: 'model.glb',
            animations: clipsMeta.map((c) => c.file),
          },
          clips: clipsMeta,
          note:
            'model.glb 含 SkinnedMesh（自动权重）与骨骼。各 animation_<preset>.glb 仅烘焙 TRS，层级与 model 对齐以便在 DCC 中套用；合并后播放蒙皮动画更平滑。',
        },
        null,
        2,
      ),
      'utf-8',
    )

    const out = await zip.generateAsync({ type: 'blob' })
    const url = URL.createObjectURL(out)
    const a = document.createElement('a')
    a.href = url
    a.download = `${base}.zip`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    console.error(e)
    alert('导出失败：' + (e?.message || String(e)))
  } finally {
    disposeExportClone(modelClone)
    for (const d of disposable) disposeExportClone(d)
    exporting.value = false
  }
}

async function captureScreenshotToClipboard() {
  const renderer = rendererRef.value
  const scene = sceneRef.value
  const camera = cameraRef.value
  const canvas = canvasRef.value
  if (!renderer || !scene || !camera || !canvas) throw new Error('视口尚未就绪')
  renderer.render(scene, camera)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('截图失败：无法生成图片')
  if (!navigator?.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('当前环境不支持写入图片到剪贴板（需 HTTPS 或支持 Clipboard API 的环境）')
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}

defineExpose({ rebuildCreature, fitCameraToCreature, exportCreatureZip, captureScreenshotToClipboard, selectByPath })

onMounted(() => {
  const canvas = canvasRef.value
  const el = containerRef.value
  if (!canvas || !el) return

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(el.clientWidth, el.clientHeight, false)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.2
  rendererRef.value = renderer

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x2a3544)
  sceneRef.value = scene

  const camera = new THREE.PerspectiveCamera(40, el.clientWidth / Math.max(el.clientHeight, 1), 0.02, 200)
  camera.position.set(2.2, 1.8, 3.2)
  cameraRef.value = camera

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.07
  controlsRef.value = controls

  scene.add(new THREE.AmbientLight(0xd8e4f5, 0.5))
  const sun = new THREE.DirectionalLight(0xfff5e8, 1.2)
  sun.position.set(6, 10, 5)
  sun.castShadow = true
  sun.shadow.mapSize.set(1024, 1024)
  scene.add(sun)
  const fill = new THREE.DirectionalLight(0xa8c0ff, 0.25)
  fill.position.set(-4, 3, 4)
  scene.add(fill)

  const checkerCanvas = document.createElement('canvas')
  checkerCanvas.width = 2
  checkerCanvas.height = 2
  const checkerCtx = checkerCanvas.getContext('2d')
  if (checkerCtx) {
    checkerCtx.fillStyle = '#ffffff'
    checkerCtx.fillRect(0, 0, 2, 2)
    checkerCtx.fillStyle = '#111111'
    checkerCtx.fillRect(0, 0, 1, 1)
    checkerCtx.fillRect(1, 1, 1, 1)
  }
  const checkerTex = new THREE.CanvasTexture(checkerCanvas)
  checkerTex.wrapS = THREE.RepeatWrapping
  checkerTex.wrapT = THREE.RepeatWrapping
  checkerTex.magFilter = THREE.NearestFilter
  checkerTex.minFilter = THREE.NearestFilter
  checkerTex.generateMipmaps = false
  const groundSize = 40
  // 每个 repeat 对应 1 米，因此 repeat=groundSize 即 1m 棋盘格
  checkerTex.repeat.set(groundSize, groundSize)
  checkerTex.needsUpdate = true

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(groundSize, groundSize, 1, 1),
    new THREE.MeshStandardMaterial({ map: checkerTex, roughness: 1, metalness: 0 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.005
  ground.receiveShadow = true
  scene.add(ground)
  groundMesh = ground

  rebuildCreature()
  fitCameraToCreature()
  canvas.addEventListener('pointerdown', pickByPointer)

  resizeObserver = new ResizeObserver(onResize)
  resizeObserver.observe(el)
  window.addEventListener('resize', onResize)
  animate()
})

onUnmounted(() => {
  cancelAnimationFrame(raf)
  resizeObserver?.disconnect()
  resizeObserver = null
  window.removeEventListener('resize', onResize)
  controlsRef.value?.dispose()
  controlsRef.value = null
  canvasRef.value?.removeEventListener?.('pointerdown', pickByPointer)
  disposeRagdollPhysics()
  disposeModelHitbox()
  disposeModelWireframe()
  groundMesh = null
  disposeCreature(creatureRootRef.value)
  creatureRootRef.value = null
  sceneRef.value?.clear()
  sceneRef.value = null
  rendererRef.value?.dispose()
  rendererRef.value = null
  cameraRef.value = null
})

watch(
  () => props.params,
  () => {
    if (!sceneRef.value) return
    const fp = creatureGeometryFingerprint(props.params)
    if (fp !== lastGeometryFingerprint) rebuildCreature()
    else applyViewportDisplayLayers()
  },
  { deep: true },
)

watch(ragdollEnabled, (on) => {
  if (!sceneRef.value || !creatureRootRef.value || !ragdollCtx) return
  if (on) ragdollCtx.syncBodiesFromBones()
  applyViewportDisplayLayers()
})

</script>

<template>
  <div ref="containerRef" class="viewport">
    <canvas ref="canvasRef" class="canvas" />
    <div class="anim-bar" @pointerdown.stop>
      <label class="anim-label">
        <span class="anim-title">动作</span>
        <select v-model="animationPreset" class="select anim-select" title="根位移 + 骨骼旋转；SkinnedMesh 随骨形变（自动权重示意）">
          <option v-for="a in CREATURE_ANIMATIONS" :key="a.id" :value="a.id">{{ a.label }}</option>
        </select>
      </label>
    </div>
    <div
      class="display-panel"
      @pointerdown.stop
      title="与左侧 Dock「外观」同源：模型 / 骨骼 / 物理为同一套角色图层"
    >
      <div class="display-panel-title">显示</div>
      <label class="display-check">
        <input v-model="params.showCreatureModel" type="checkbox" />
        <span>模型显示</span>
      </label>
      <label class="display-check">
        <input v-model="params.showCreatureWireframe" type="checkbox" />
        <span>模型线框</span>
      </label>
      <label class="display-check">
        <input v-model="params.showSkeleton" type="checkbox" />
        <span>骨骼显示</span>
      </label>
      <label
        class="display-check"
        :title="
          ragdollEnabled
            ? '碰撞体线框（与物理解算同步）'
            : '刚体与骨骼同尺度基准；此项控制线框，关闭解算时线框随骨骼更新'
        "
      >
        <input v-model="params.showCreaturePhysics" type="checkbox" />
        <span>物理显示</span>
      </label>
      <label class="display-check" title="每关节 hitbox 线框">
        <input v-model="params.showCreatureHitbox" type="checkbox" />
        <span>Hitbox 显示</span>
      </label>
      <label class="display-check">
        <input v-model="params.showGround" type="checkbox" />
        <span>地面显示</span>
      </label>
    </div>
    <div class="hud">拖拽旋转 · 滚轮缩放 · 右平移</div>
  </div>
</template>

<style scoped>
.viewport {
  position: relative;
  width: 100%;
  height: 100%;
  min-height: 0;
}
.canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.hud {
  position: absolute;
  left: 10px;
  bottom: 10px;
  font-size: 11px;
  color: #8a93a8;
  pointer-events: none;
}

.anim-bar {
  position: absolute;
  left: 10px;
  top: 10px;
  z-index: 20;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(22, 27, 36, 0.92);
  border: 1px solid #2f3a4d;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}

.anim-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 12px;
  color: #c8d0dc;
  cursor: default;
}

.anim-title {
  flex-shrink: 0;
  font-weight: 600;
}

.anim-select {
  min-width: 11rem;
  padding: 4px 8px;
  font-size: 12px;
  border-radius: 4px;
  border: 1px solid #3d4a5f;
  background: #1e2530;
  color: #e8ecf2;
}

.display-panel {
  position: absolute;
  right: 10px;
  top: 10px;
  z-index: 20;
  min-width: 7.5rem;
  padding: 8px 10px;
  border-radius: 6px;
  background: rgba(22, 27, 36, 0.92);
  border: 1px solid #2f3a4d;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
}

.display-panel-title {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6b7788;
  margin: 0 0 8px;
}

.display-check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 6px;
  font-size: 12px;
  color: #c8d0dc;
  cursor: pointer;
  user-select: none;
}

.display-check:last-of-type {
  margin-bottom: 0;
}

.display-check input {
  flex-shrink: 0;
}

</style>
