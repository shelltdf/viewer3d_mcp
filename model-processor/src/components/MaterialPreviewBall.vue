<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'

const props = defineProps({
  material: { type: Object, default: null },
  size: { type: Number, default: 160 },
  /** 为 true 时每帧自转；默认在画布上拖动旋转 */
  autoRotate: { type: Boolean, default: false },
})

const canvasRef = ref(null)
let renderer
let scene
let camera
let mesh
let raf = 0
let rotX = 0.15
let rotY = 0
let dragging = false
let lastX = 0
let lastY = 0

function clearMesh() {
  if (mesh && scene) {
    scene.remove(mesh)
    mesh.geometry?.dispose()
    if (mesh.material) {
      mesh.material.dispose()
    }
    mesh = undefined
  }
}

function onPointerDown(e) {
  if (props.autoRotate) return
  dragging = true
  lastX = e.clientX
  lastY = e.clientY
}

function onPointerMove(e) {
  if (!dragging || props.autoRotate) return
  const dx = e.clientX - lastX
  const dy = e.clientY - lastY
  lastX = e.clientX
  lastY = e.clientY
  rotY += dx * 0.012
  rotX += dy * 0.012
  rotX = Math.max(-1.35, Math.min(1.35, rotX))
}

function onPointerUp() {
  dragging = false
}

function build() {
  const canvas = canvasRef.value
  if (!canvas || !props.material) {
    clearMesh()
    return
  }

  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    scene = new THREE.Scene()
    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 10)
    camera.position.set(0, 0, 2.55)
    camera.lookAt(0, 0, 0)
    const amb = new THREE.AmbientLight(0xffffff, 0.4)
    scene.add(amb)
    const d = new THREE.DirectionalLight(0xffffff, 1.05)
    d.position.set(2.5, 4, 2)
    scene.add(d)
  }

  clearMesh()
  let mat
  try {
    mat = props.material.clone()
  } catch {
    mat = new THREE.MeshStandardMaterial({ color: 0x888888 })
  }
  mesh = new THREE.Mesh(new THREE.SphereGeometry(0.68, 48, 48), mat)
  mesh.rotation.x = rotX
  mesh.rotation.y = rotY
  scene.add(mesh)

  const s = props.size
  renderer.setSize(s, s, false)
  renderer.render(scene, camera)
}

function loop() {
  raf = requestAnimationFrame(loop)
  if (!mesh || !renderer || !scene || !camera) return
  if (props.autoRotate) {
    mesh.rotation.y += 0.014
    rotX = mesh.rotation.x
    rotY = mesh.rotation.y
  } else {
    mesh.rotation.x = rotX
    mesh.rotation.y = rotY
  }
  renderer.render(scene, camera)
}

onMounted(() => {
  const canvas = canvasRef.value
  build()
  if (canvas) {
    canvas.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
  }
  loop()
})

watch(
  () => [props.material, props.size],
  () => build(),
)

watch(
  () => props.autoRotate,
  () => {
    dragging = false
  },
)

onBeforeUnmount(() => {
  const canvas = canvasRef.value
  cancelAnimationFrame(raf)
  if (canvas) {
    canvas.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    canvas.removeEventListener('pointercancel', onPointerUp)
  }
  clearMesh()
  renderer?.dispose()
  renderer = undefined
  scene = undefined
  camera = undefined
})
</script>

<template>
  <canvas
    ref="canvasRef"
    class="mat-preview-canvas"
    :class="{ grab: !autoRotate }"
  />
</template>

<style scoped>
.mat-preview-canvas {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 1 / 1;
  max-width: 100%;
  border-radius: 4px;
  border: 1px solid #4a5568;
  background: #1a1d24;
  touch-action: none;
}
.grab {
  cursor: grab;
}
</style>
