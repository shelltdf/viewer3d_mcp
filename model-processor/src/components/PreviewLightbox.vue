<script setup>
import { watch } from 'vue'
import TexturePreviewCanvas from './TexturePreviewCanvas.vue'
import MaterialPreviewBall from './MaterialPreviewBall.vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  kind: { type: String, default: '' },
  texture: { type: Object, default: null },
  material: { type: Object, default: null },
  /** rgba | r | g | b | a */
  channel: { type: String, default: 'rgba' },
})

const emit = defineEmits(['close'])

watch(
  () => props.open,
  (v) => {
    if (v) document.body.style.overflow = 'hidden'
    else document.body.style.overflow = ''
  },
)

function onKey(e) {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="lightbox-root" role="presentation" @keydown="onKey">
      <div class="lightbox-back" @click.self="emit('close')" />
      <div class="lightbox-panel">
        <header class="lightbox-head">
          <span>{{ kind === 'texture' ? '贴图预览' : '材质预览' }}</span>
          <button type="button" class="lightbox-x" @click="emit('close')">×</button>
        </header>
        <div class="lightbox-body">
          <TexturePreviewCanvas
            v-if="kind === 'texture' && texture"
            :texture="texture"
            :size="720"
            :channel="channel"
          />
          <MaterialPreviewBall v-else-if="kind === 'material' && material" :material="material" :size="720" />
        </div>
        <p class="lightbox-hint">按 Esc 或点击背景关闭 · 双击属性区可再次打开</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.lightbox-root {
  position: fixed;
  inset: 0;
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
}
.lightbox-back {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.75);
}
.lightbox-panel {
  position: relative;
  z-index: 1;
  max-width: min(96vw, 920px);
  max-height: min(92vh, 900px);
  background: #1e2229;
  border: 1px solid #4a5568;
  border-radius: 8px;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.lightbox-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #3d4654;
  color: #d4dce8;
  font-size: 13px;
}
.lightbox-x {
  border: none;
  background: transparent;
  color: #9aa3b0;
  font-size: 22px;
  cursor: pointer;
  line-height: 1;
}
.lightbox-body {
  padding: 12px;
  display: flex;
  justify-content: center;
  align-items: center;
  overflow: auto;
}
.lightbox-hint {
  margin: 0;
  padding: 8px 14px 12px;
  font-size: 11px;
  color: #7a8494;
}
</style>
