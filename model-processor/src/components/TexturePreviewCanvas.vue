<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'

const props = defineProps({
  texture: { type: Object, default: null },
  size: { type: Number, default: 160 },
  /** rgba | r | g | b | a */
  channel: { type: String, default: 'rgba' },
})

const canvasRef = ref(null)
let renderer
let scene
let camera
let mesh
let material

const VS = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const FS = `
uniform sampler2D map;
uniform float uMode;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(map, vUv);
  if (uMode < 0.5) {
    gl_FragColor = vec4(c.rgb, 1.0);
  } else if (uMode < 1.5) {
    gl_FragColor = vec4(c.rrr, 1.0);
  } else if (uMode < 2.5) {
    gl_FragColor = vec4(c.ggg, 1.0);
  } else if (uMode < 3.5) {
    gl_FragColor = vec4(c.bbb, 1.0);
  } else {
    gl_FragColor = vec4(vec3(c.a), 1.0);
  }
}
`

function modeFromChannel(ch) {
  const m = { rgba: 0, r: 1, g: 2, b: 3, a: 4 }
  return m[ch] ?? 0
}

function clearScene() {
  if (!scene) return
  while (scene.children.length) {
    const o = scene.children[0]
    scene.remove(o)
    if (o.geometry) o.geometry.dispose()
    if (o.material) o.material.dispose()
  }
  mesh = undefined
  material = undefined
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
  material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: props.texture },
      uMode: { value: modeFromChannel(props.channel) },
    },
    vertexShader: VS,
    fragmentShader: FS,
  })
  mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material)
  scene.add(mesh)

  const s = props.size
  renderer.setSize(s, s, false)
  renderOnce()
}

function updateUniforms() {
  if (!material?.uniforms) return
  material.uniforms.map.value = props.texture
  material.uniforms.uMode.value = modeFromChannel(props.channel)
  renderOnce()
}

onMounted(() => {
  build()
})

watch(
  () => [props.texture, props.size],
  () => build(),
)

watch(
  () => props.channel,
  () => updateUniforms(),
)

onBeforeUnmount(() => {
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
