<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps({
  texture: { type: Object, default: null },
  size: { type: Number, default: 56 },
})

const canvasRef = ref(null)

function draw() {
  const canvas = canvasRef.value
  const tex = props.texture
  if (!canvas || !tex?.image) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const s = props.size
  canvas.width = s
  canvas.height = s
  ctx.fillStyle = '#1a1d24'
  ctx.fillRect(0, 0, s, s)
  const img = tex.image
  try {
    if (typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap) {
      ctx.drawImage(img, 0, 0, s, s)
      return
    }
    if (img.complete === false) {
      img.onload = () => draw()
      return
    }
    if (img.width && img.height) {
      ctx.drawImage(img, 0, 0, s, s)
    }
  } catch {
    ctx.fillStyle = '#4a5568'
    ctx.font = `${Math.max(8, s / 8)}px sans-serif`
    ctx.fillText('…', s * 0.4, s * 0.55)
  }
}

onMounted(() => draw())

watch(
  () => [props.texture, props.size],
  () => draw(),
)
onBeforeUnmount(() => {})
</script>

<template>
  <canvas ref="canvasRef" class="thumb-2d" :style="{ width: size + 'px', height: size + 'px' }" />
</template>

<style scoped>
.thumb-2d {
  display: block;
  border-radius: 4px;
  border: 1px solid #4a5568;
  background: #1a1d24;
  image-rendering: pixelated;
}
</style>
