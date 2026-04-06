<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'

const props = defineProps({
  material: { type: Object, default: null },
  size: { type: Number, default: 160 },
})

const canvasRef = ref(null)
let renderer
let scene
let camera
let mesh
let raf = 0

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
    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 10)
    camera.position.set(0, 0.15, 2.2)
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
  mesh = new THREE.Mesh(new THREE.SphereGeometry(0.85, 48, 48), mat)
  scene.add(mesh)

  const s = props.size
  renderer.setSize(s, s, false)
  renderer.render(scene, camera)
}

function loop() {
  raf = requestAnimationFrame(loop)
  if (mesh) mesh.rotation.y += 0.014
  if (renderer && scene && camera) renderer.render(scene, camera)
}

onMounted(() => {
  build()
  loop()
})

watch(
  () => [props.material, props.size],
  () => build(),
)

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  clearMesh()
  renderer?.dispose()
  renderer = undefined
  scene = undefined
  camera = undefined
})
</script>

<template>
  <canvas ref="canvasRef" class="mat-preview-canvas" />
</template>

<style scoped>
.mat-preview-canvas {
  display: block;
  max-width: 100%;
  border-radius: 4px;
  border: 1px solid #4a5568;
  background: #1a1d24;
}
</style>
