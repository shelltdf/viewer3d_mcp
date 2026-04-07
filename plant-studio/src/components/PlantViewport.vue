<script setup>
import { onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { buildProceduralPlant } from '../plant/proceduralTree.js'
import { defaultEnvSettings, defaultWindSettings, hexToColorNum } from '../plant/sceneSettings.js'

const props = defineProps({
  params: { type: Object, required: true },
  env: {
    type: Object,
    default: () => ({ ...defaultEnvSettings() }),
  },
  wind: {
    type: Object,
    default: () => ({ ...defaultWindSettings() }),
  },
})

const emit = defineEmits(['stats'])

const containerRef = ref(null)
const canvasRef = ref(null)

/** @type {import('vue').ShallowRef<THREE.WebGLRenderer | null>} */
const rendererRef = shallowRef(null)
/** @type {import('vue').ShallowRef<THREE.Scene | null>} */
const sceneRef = shallowRef(null)
/** @type {import('vue').ShallowRef<THREE.PerspectiveCamera | null>} */
const cameraRef = shallowRef(null)
/** @type {import('vue').ShallowRef<import('three/examples/jsm/controls/OrbitControls.js').OrbitControls | null>} */
const controlsRef = shallowRef(null)
/** @type {import('vue').ShallowRef<THREE.Group | null>} */
const plantRootRef = shallowRef(null)

/** @type {THREE.AmbientLight | null} */
let ambLight = null
/** @type {THREE.HemisphereLight | null} */
let hemiLight = null
/** @type {THREE.DirectionalLight | null} */
let sunLight = null
/** @type {THREE.DirectionalLight | null} */
let fillLight = null
/** @type {THREE.Mesh | null} */
let groundMesh = null

/** @type {THREE.Matrix4[]} */
let leafBaseMatrices = []
/** @type {THREE.InstancedMesh | null} */
let leavesInstanced = null
/** @type {THREE.Mesh | null} */
let woodMesh = null

const _m = new THREE.Matrix4()
const _pos = new THREE.Vector3()
const _quat = new THREE.Quaternion()
const _scale = new THREE.Vector3()
const _windQ = new THREE.Quaternion()
const _windE = new THREE.Euler()
const _leafDummy = new THREE.Object3D()

let raf = 0
/** @type {ResizeObserver | null} */
let resizeObserver = null
const exporting = ref(false)

const TONE_MAP = {
  aces: THREE.ACESFilmicToneMapping,
  linear: THREE.LinearToneMapping,
  reinhard: THREE.ReinhardToneMapping,
  cineon: THREE.CineonToneMapping,
  neutral: THREE.NeutralToneMapping,
}

function setSunFromAngles(light, azimuthDeg, elevationDeg) {
  if (!light) return
  const az = (Number(azimuthDeg) * Math.PI) / 180
  const el = (Number(elevationDeg) * Math.PI) / 180
  const r = 22
  const ce = Math.cos(el)
  light.position.set(r * ce * Math.sin(az), r * Math.sin(el), r * ce * Math.cos(az))
}

function applyEnv() {
  const e = props.env
  const renderer = rendererRef.value
  const scene = sceneRef.value
  if (!renderer || !scene) return

  renderer.toneMappingExposure = Math.max(0.1, Number(e.exposure) || 1)
  renderer.toneMapping = TONE_MAP[e.toneMapping] ?? THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = !!e.shadowEnabled

  scene.background = new THREE.Color(hexToColorNum(e.background, 0x3d4a5c))

  if (ambLight) {
    ambLight.color.setHex(hexToColorNum(e.ambientColor, 0xe8eef5))
    ambLight.intensity = Math.max(0, Number(e.ambientIntensity) ?? 0)
  }
  if (hemiLight) {
    hemiLight.color.setHex(hexToColorNum(e.hemiSky, 0xb8d4f0))
    hemiLight.groundColor.setHex(hexToColorNum(e.hemiGround, 0x6b5a4a))
    hemiLight.intensity = Math.max(0, Number(e.hemiIntensity) ?? 0)
  }
  if (sunLight) {
    sunLight.color.setHex(hexToColorNum(e.sunColor, 0xfff8f0))
    sunLight.intensity = Math.max(0, Number(e.sunIntensity) ?? 0)
    sunLight.castShadow = !!e.shadowEnabled
    setSunFromAngles(sunLight, e.sunAzimuthDeg, e.sunElevationDeg)
  }
  if (fillLight) {
    fillLight.color.setHex(hexToColorNum(e.fillColor, 0xc8d4ff))
    fillLight.intensity = Math.max(0, Number(e.fillIntensity) ?? 0)
  }
  if (groundMesh?.material && 'color' in groundMesh.material) {
    /** @type {THREE.MeshStandardMaterial} */ (groundMesh.material).color.setHex(
      hexToColorNum(e.groundColor, 0x4a5a52),
    )
  }
}

function capturePlantRefs(group) {
  leafBaseMatrices = []
  leavesInstanced = null
  woodMesh = null
  group.traverse((o) => {
    if (o.name === 'Wood' && o.isMesh) woodMesh = o
    if (o.isInstancedMesh && o.name === 'Leaves') {
      leavesInstanced = o
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, _m)
        leafBaseMatrices.push(_m.clone())
      }
    }
  })
}

function applyWind(t) {
  const w = props.wind
  const trunkFactor = Math.max(0, Math.min(1, Number(w.trunkSway) ?? 0))

  if (!w.enabled) {
    if (woodMesh) woodMesh.rotation.set(0, 0, 0)
    if (leavesInstanced && leafBaseMatrices.length >= leavesInstanced.count) {
      for (let i = 0; i < leavesInstanced.count; i++) {
        leavesInstanced.setMatrixAt(i, leafBaseMatrices[i])
      }
      leavesInstanced.instanceMatrix.needsUpdate = true
    }
    return
  }

  const str = Math.max(0, Number(w.strength) ?? 0)
  const spd = Math.max(0.05, Number(w.speed) ?? 1)
  const ti = t * spd

  if (woodMesh) {
    const k = str * trunkFactor
    woodMesh.rotation.z = k * 0.1 * Math.sin(ti)
    woodMesh.rotation.x = k * 0.04 * Math.sin(ti * 0.73 + 0.6)
  }

  if (leavesInstanced && leafBaseMatrices.length >= leavesInstanced.count) {
    for (let i = 0; i < leavesInstanced.count; i++) {
      leafBaseMatrices[i].decompose(_pos, _quat, _scale)
      const ph = i * 0.71 + (i % 7) * 0.09
      _windE.set(
        str * 0.55 * Math.sin(ti * 1.15 + ph),
        str * 0.28 * Math.sin(ti * 0.88 + ph * 0.47),
        str * 0.22 * Math.cos(ti * 0.95 + ph * 0.33),
      )
      _windQ.setFromEuler(_windE)
      _quat.multiply(_windQ)
      _leafDummy.matrix.compose(_pos, _quat, _scale)
      leavesInstanced.setMatrixAt(i, _leafDummy.matrix)
    }
    leavesInstanced.instanceMatrix.needsUpdate = true
  }
}

function disposePlant(root) {
  if (!root) return
  root.traverse((obj) => {
    if (obj.isMesh) {
      obj.geometry?.dispose?.()
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.())
      else obj.material?.dispose?.()
    }
  })
}

function rebuildPlant() {
  const scene = sceneRef.value
  if (!scene) return
  const old = plantRootRef.value
  if (old) {
    scene.remove(old)
    disposePlant(old)
    plantRootRef.value = null
  }
  const { group, stats } = buildProceduralPlant(props.params)
  scene.add(group)
  plantRootRef.value = group
  capturePlantRefs(group)
  emit('stats', stats)
}

function fitCameraToPlant() {
  const cam = cameraRef.value
  const controls = controlsRef.value
  const plant = plantRootRef.value
  if (!cam || !controls || !plant) return
  const box = new THREE.Box3().setFromObject(plant)
  if (box.isEmpty()) return
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxDim = Math.max(size.x, size.y, size.z, 1)
  const dist = maxDim * 2.2
  cam.near = Math.max(0.01, dist / 200)
  cam.far = Math.max(200, dist * 20)
  cam.updateProjectionMatrix()
  cam.position.set(center.x + dist * 0.55, center.y + dist * 0.35, center.z + dist * 0.55)
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
  controls?.update()
  applyWind(performance.now() * 0.001)
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

/** 导出前短暂恢复静止姿态，避免 GLB 带风变形 */
function applyRestPoseToPlant() {
  const plant = plantRootRef.value
  if (!plant) return
  const wood = plant.getObjectByName('Wood')
  const leaves = plant.getObjectByName('Leaves')
  if (wood) wood.rotation.set(0, 0, 0)
  if (leaves && leaves.isInstancedMesh && leafBaseMatrices.length >= leaves.count) {
    for (let i = 0; i < leaves.count; i++) {
      leaves.setMatrixAt(i, leafBaseMatrices[i])
    }
    leaves.instanceMatrix.needsUpdate = true
  }
}

function restoreWindPoseAfterExport() {
  applyWind(performance.now() * 0.001)
}

async function exportGlb() {
  const plant = plantRootRef.value
  if (!plant || exporting.value) return
  exporting.value = true
  const hadWind = props.wind.enabled
  try {
    if (hadWind) applyRestPoseToPlant()

    const exporter = new GLTFExporter()
    const arraybuffer = await new Promise((resolve, reject) => {
      exporter.parse(
        plant,
        (res) => {
          if (res instanceof ArrayBuffer) resolve(res)
          else reject(new Error('Expected binary glTF'))
        },
        (err) => reject(err),
        { binary: true, truncateDrawRange: true },
      )
    })

    const blob = new Blob([arraybuffer], { type: 'model/gltf-binary' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `plant-${props.params.seed}.glb`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    console.error(e)
    alert('导出失败：' + (e?.message || String(e)))
  } finally {
    if (hadWind) restoreWindPoseAfterExport()
    exporting.value = false
  }
}

defineExpose({
  rebuildPlant,
  fitCameraToPlant,
  exportGlb,
})

onMounted(() => {
  const canvas = canvasRef.value
  const el = containerRef.value
  if (!canvas || !el) return

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(el.clientWidth, el.clientHeight, false)
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.outputColorSpace = THREE.SRGBColorSpace
  rendererRef.value = renderer

  const scene = new THREE.Scene()
  sceneRef.value = scene

  const camera = new THREE.PerspectiveCamera(42, el.clientWidth / Math.max(el.clientHeight, 1), 0.05, 500)
  camera.position.set(4, 3, 6)
  cameraRef.value = camera

  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controlsRef.value = controls

  ambLight = new THREE.AmbientLight(0xffffff, 0.5)
  scene.add(ambLight)

  hemiLight = new THREE.HemisphereLight(0xb8d4f0, 0x6b5a4a, 0.42)
  hemiLight.position.set(0, 1, 0)
  scene.add(hemiLight)

  sunLight = new THREE.DirectionalLight(0xfff8f0, 1.45)
  setSunFromAngles(sunLight, props.env.sunAzimuthDeg, props.env.sunElevationDeg)
  sunLight.castShadow = true
  sunLight.shadow.mapSize.set(2048, 2048)
  sunLight.shadow.camera.near = 0.5
  sunLight.shadow.camera.far = 80
  sunLight.shadow.camera.left = -25
  sunLight.shadow.camera.right = 25
  sunLight.shadow.camera.top = 25
  sunLight.shadow.camera.bottom = -25
  scene.add(sunLight)

  fillLight = new THREE.DirectionalLight(0xc8d4ff, 0.38)
  fillLight.position.set(-6, 4, -4)
  scene.add(fillLight)

  groundMesh = new THREE.Mesh(
    new THREE.CircleGeometry(18, 48),
    new THREE.MeshStandardMaterial({ color: 0x4a5a52, roughness: 1, metalness: 0 }),
  )
  groundMesh.rotation.x = -Math.PI / 2
  groundMesh.position.y = -0.01
  groundMesh.receiveShadow = true
  scene.add(groundMesh)

  applyEnv()
  rebuildPlant()
  fitCameraToPlant()

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
  disposePlant(plantRootRef.value)
  plantRootRef.value = null
  leafBaseMatrices = []
  leavesInstanced = null
  woodMesh = null
  const scene = sceneRef.value
  if (scene) scene.clear()
  sceneRef.value = null
  ambLight = null
  hemiLight = null
  sunLight = null
  fillLight = null
  groundMesh = null
  rendererRef.value?.dispose()
  rendererRef.value = null
  cameraRef.value = null
})

watch(
  () => props.params,
  () => {
    if (!sceneRef.value) return
    rebuildPlant()
  },
  { deep: true },
)

watch(
  () => props.env,
  () => {
    applyEnv()
  },
  { deep: true },
)
</script>

<template>
  <div ref="containerRef" class="viewport">
    <canvas ref="canvasRef" class="canvas" />
    <div class="hud">
      <span>拖拽旋转 · 滚轮缩放 · 右平移</span>
    </div>
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
</style>
