<script setup>
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
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

const emit = defineEmits(['stats'])

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

/** @type {{ dispose: () => void, step: (dt: number) => void, syncBodiesFromBones: () => void, updateWireframes: () => void, wireGroup?: THREE.Group } | null} */
let ragdollCtx = null
let lastAnimTime = performance.now()

/** 与 `creatureGeometryFingerprint` 对齐，避免只改「模型/骨骼/物理显示」时误触发整机重建 */
let lastGeometryFingerprint = ''

/** 模型（SkinnedMesh）、骨骼可视化、物理线框：统一走 `params`（Dock 与右上角面板同源） */
function applyViewportDisplayLayers() {
  const root = creatureRootRef.value
  if (!root) return
  const p = props.params
  const body = root.getObjectByName('CreatureBody')
  if (body) body.visible = p.showCreatureModel !== false
  const arm = root.getObjectByName('Armature')
  if (arm) setSkeletonVisualizationVisible(arm, p.showSkeleton !== false)
  if (ragdollCtx?.wireGroup) ragdollCtx.wireGroup.visible = p.showCreaturePhysics !== false
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
  applyViewportDisplayLayers()
}

function rebuildCreature() {
  const scene = sceneRef.value
  if (!scene) return
  disposeRagdollPhysics()
  const old = creatureRootRef.value
  if (old) {
    scene.remove(old)
    disposeCreature(old)
    creatureRootRef.value = null
  }
  const { group, stats } = buildCreature(props.params)
  scene.add(group)
  creatureRootRef.value = group
  emit('stats', stats)
  rebuildRagdollPhysics()
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

defineExpose({ rebuildCreature, fitCameraToCreature, exportCreatureZip })

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

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(8, 40),
    new THREE.MeshStandardMaterial({ color: 0x3a4540, roughness: 1, metalness: 0 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.position.y = -0.005
  ground.receiveShadow = true
  scene.add(ground)

  rebuildCreature()
  fitCameraToCreature()

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
  disposeRagdollPhysics()
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
