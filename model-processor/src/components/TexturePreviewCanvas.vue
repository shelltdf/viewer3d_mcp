<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'

const props = defineProps({
  texture: { type: Object, default: null },
  size: { type: Number, default: 160 },
})

const canvasRef = ref(null)
let renderer
let scene
let camera
let raf = 0

function clearScene() {
  if (!scene) return
  while (scene.children.length) {
    const o = scene.children[0]
    scene.remove(o)
    if (o.geometry) o.geometry.dispose()
    if (o.material) {
      if (o.material.map) o.material.map = null
      o.material.dispose()
    }
  }
}

function renderOnce() {
  if (renderer && scene && camera) renderer.render(scene, camera)
}

function build() {
  const canvas = canvasRef.value
  if (!canvas || !props.texture) {
    clearScene()
    renderOnce()
    return
  }

  if (!renderer) {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    scene = new THREE.Scene()
    camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 2)
    camera.position.z = 1
  }

  clearScene()
  const mat = new THREE.MeshBasicMaterial({ map: props.texture })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)
  scene.add(mesh)

  const s = props.size
  renderer.setSize(s, s, false)
  renderOnce()
}

function loop() {
  raf = requestAnimationFrame(loop)
  renderOnce()
}

onMounted(() => {
  build()
  loop()
})

watch(
  () => [props.texture, props.size],
  () => build(),
)

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  clearScene()
  renderer?.dispose()
  renderer = undefined
  scene = undefined
  camera = undefined
})
</script>

<template>
  <canvas ref="canvasRef" class="tex-preview-canvas" />
</template>

<style scoped>
.tex-preview-canvas {
  display: block;
  max-width: 100%;
  border-radius: 4px;
  border: 1px solid #4a5568;
  background: #1a1d24;
}
</style>
