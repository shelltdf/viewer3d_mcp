<script setup>
import { ref, computed, watch, onBeforeUnmount, nextTick } from 'vue'
import { vertexAttrDisplayName } from '../utils/vertexAttrNaming.js'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** @type {import('vue').PropType<import('three').Mesh | import('three').SkinnedMesh | null>} */
  meshObject: { type: Object, default: null },
  meshLabel: { type: String, default: '' },
  readOnly: { type: Boolean, default: true },
})

const emit = defineEmits(['update:open', 'edited'])

const canvasRef = ref(null)
const activeUvKey = ref('uv')
const nudgeDu = ref(0)
const nudgeDv = ref(0)
const drag = ref(null)
const view = ref({ scale: 400, offX: 0, offY: 0 })

const geometry = computed(() => (props.meshObject?.geometry?.isBufferGeometry ? props.meshObject.geometry : null))

const uvChannels = computed(() => {
  const g = geometry.value
  if (!g?.attributes) return []
  return ['uv', 'uv2', 'uv3'].filter((k) => g.getAttribute(k)).map((k) => ({
    key: k,
    label: vertexAttrDisplayName(k),
  }))
})

function channelLabel(key) {
  return vertexAttrDisplayName(key)
}

function close() {
  emit('update:open', false)
}

function fitToBounds() {
  const g = geometry.value
  const uv = g?.getAttribute(activeUvKey.value)
  const c = canvasRef.value
  if (!uv || !c) return
  let minU = Infinity
  let maxU = -Infinity
  let minV = Infinity
  let maxV = -Infinity
  for (let i = 0; i < uv.count; i++) {
    const u = uv.getX(i)
    const v = uv.getY(i)
    minU = Math.min(minU, u)
    maxU = Math.max(maxU, u)
    minV = Math.min(minV, v)
    maxV = Math.max(maxV, v)
  }
  const du = Math.max(maxU - minU, 1e-6)
  const dv = Math.max(maxV - minV, 1e-6)
  const pad = 48
  const cw = c.width - pad * 2
  const ch = c.height - pad * 2
  const s = Math.min(cw / du, ch / dv) * 0.92
  const cx = (minU + maxU) / 2
  const cy = (minV + maxV) / 2
  view.value = {
    scale: s,
    offX: c.width / 2 - cx * s,
    offY: c.height / 2 - (1 - cy) * s,
  }
}

function uvToCanvas(u, v) {
  const { scale: sc, offX, offY } = view.value
  return [offX + u * sc, offY + (1 - v) * sc]
}

let raf = 0
function draw() {
  const c = canvasRef.value
  const g = geometry.value
  if (!c || !g) return
  const ctx = c.getContext('2d')
  if (!ctx) return
  const W = c.width
  const H = c.height
  ctx.fillStyle = '#14161c'
  ctx.fillRect(0, 0, W, H)
  ctx.strokeStyle = '#2a3344'
  ctx.lineWidth = 1
  const step = 0.25
  for (let t = -4; t <= 8; t += step) {
    const [x1, y1] = uvToCanvas(t, 0)
    const [x2, y2] = uvToCanvas(t, 1)
    ctx.beginPath()
    ctx.moveTo(x1, y1)
    ctx.lineTo(x2, y2)
    ctx.stroke()
    const [x3, y3] = uvToCanvas(0, t)
    const [x4, y4] = uvToCanvas(1, t)
    ctx.beginPath()
    ctx.moveTo(x3, y3)
    ctx.lineTo(x4, y4)
    ctx.stroke()
  }
  ctx.strokeStyle = '#4a5568'
  const box0 = uvToCanvas(0, 1)
  const box1 = uvToCanvas(1, 0)
  const rx = Math.min(box0[0], box1[0])
  const ry = Math.min(box0[1], box1[1])
  ctx.strokeRect(rx, ry, Math.abs(box1[0] - box0[0]), Math.abs(box1[1] - box0[1]))

  const uv = g.getAttribute(activeUvKey.value)
  if (!uv) {
    ctx.fillStyle = '#8e97a6'
    ctx.font = '13px system-ui'
    ctx.fillText('当前通道无属性数据', 16, 28)
    return
  }
  const idx = g.index
  const drawTri = (ia, ib, ic) => {
    const u0 = uv.getX(ia)
    const v0 = uv.getY(ia)
    const u1 = uv.getX(ib)
    const v1 = uv.getY(ib)
    const u2 = uv.getX(ic)
    const v2 = uv.getY(ic)
    const [x0, y0] = uvToCanvas(u0, v0)
    const [x1p, y1p] = uvToCanvas(u1, v1)
    const [x2p, y2p] = uvToCanvas(u2, v2)
    ctx.beginPath()
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1p, y1p)
    ctx.lineTo(x2p, y2p)
    ctx.closePath()
    ctx.strokeStyle = 'rgba(126, 200, 255, 0.75)'
    ctx.lineWidth = 1.1
    ctx.stroke()
    ctx.fillStyle = 'rgba(126, 200, 255, 0.06)'
    ctx.fill()
  }

  if (idx) {
    for (let i = 0; i + 2 < idx.count; i += 3) {
      drawTri(idx.getX(i), idx.getX(i + 1), idx.getX(i + 2))
    }
  } else {
    const n = uv.count
    for (let i = 0; i + 2 < n; i += 3) {
      drawTri(i, i + 1, i + 2)
    }
  }

  ctx.fillStyle = '#9fb3d6'
  ctx.font = '11px ui-monospace, monospace'
  ctx.fillText(
    `${channelLabel(activeUvKey.value)}  ·  顶点 ${uv.count}  ·  拖动平移 · 滚轮缩放`,
    10,
    H - 10,
  )
}

function scheduleDraw() {
  cancelAnimationFrame(raf)
  raf = requestAnimationFrame(draw)
}

watch(uvChannels, (chs) => {
  if (!chs.length) return
  if (!chs.some((c) => c.key === activeUvKey.value)) activeUvKey.value = chs[0].key
})

watch([() => props.open, () => props.meshObject?.uuid, activeUvKey], async () => {
  if (!props.open) return
  await nextTick()
  fitToBounds()
  scheduleDraw()
})

onBeforeUnmount(() => cancelAnimationFrame(raf))

function onWheel(e) {
  e.preventDefault()
  const f = e.deltaY > 0 ? 0.92 : 1.08
  view.value = { ...view.value, scale: Math.max(20, Math.min(20000, view.value.scale * f)) }
  scheduleDraw()
}

function onPointerDown(e) {
  drag.value = { x: e.clientX, y: e.clientY, ox: view.value.offX, oy: view.value.offY }
}
function onPointerMove(e) {
  if (!drag.value) return
  view.value = {
    ...view.value,
    offX: drag.value.ox + (e.clientX - drag.value.x),
    offY: drag.value.oy + (e.clientY - drag.value.y),
  }
  scheduleDraw()
}
function onPointerUp() {
  drag.value = null
}

function applyNudge() {
  if (props.readOnly) return
  const g = geometry.value
  const uv = g?.getAttribute(activeUvKey.value)
  if (!uv) return
  const du = Number(nudgeDu.value) || 0
  const dv = Number(nudgeDv.value) || 0
  if (!du && !dv) return
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) + du, uv.getY(i) + dv)
  uv.needsUpdate = true
  nudgeDu.value = 0
  nudgeDv.value = 0
  scheduleDraw()
  emit('edited')
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="uv-win-overlay" @mousedown.self="close">
      <div class="uv-win-panel" @mousedown.stop>
        <header class="uv-win-head">
          <h3 class="uv-win-title">UV 视窗 — {{ meshLabel || 'Mesh' }}</h3>
          <button type="button" class="uv-win-close" @click="close">关闭</button>
        </header>
        <p v-if="readOnly" class="uv-win-ro">仅查看（处理前只读）</p>
        <div v-if="!geometry" class="uv-win-empty">无几何数据</div>
        <template v-else>
          <div v-if="!uvChannels.length" class="uv-win-empty">
            当前无 uv / uv2 / uv3 通道；可在属性面板添加 uv0 后再打开本视窗。
          </div>
          <template v-else>
            <div class="uv-win-toolbar">
              <label>
                <span class="uv-lab">通道</span>
                <select v-model="activeUvKey" class="uv-sel">
                  <option v-for="ch in uvChannels" :key="ch.key" :value="ch.key">
                    {{ ch.label }}（{{ ch.key }}）
                  </option>
                </select>
              </label>
              <button type="button" class="uv-btn" @click="fitToBounds">适配范围</button>
              <template v-if="!readOnly">
                <span class="uv-nudge">
                  <label>Δu <input v-model.number="nudgeDu" type="number" step="0.01" class="uv-inp" /></label>
                  <label>Δv <input v-model.number="nudgeDv" type="number" step="0.01" class="uv-inp" /></label>
                  <button type="button" class="uv-btn" @click="applyNudge">应用平移</button>
                </span>
              </template>
            </div>
            <canvas
              ref="canvasRef"
              width="560"
              height="560"
              class="uv-canvas"
              @wheel.prevent="onWheel"
              @pointerdown="onPointerDown"
              @pointermove="onPointerMove"
              @pointerup="onPointerUp"
              @pointerleave="onPointerUp"
            />
          </template>
        </template>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.uv-win-overlay {
  position: fixed;
  inset: 0;
  z-index: 800;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.uv-win-panel {
  background: #1e232b;
  border: 1px solid #3d4a5c;
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.55);
  max-width: 96vw;
}
.uv-win-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid #3a4558;
}
.uv-win-title {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #c5d4e8;
}
.uv-win-close {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #5a6a82;
  background: #2a3344;
  color: #e6ebf3;
  cursor: pointer;
  font-size: 12px;
}
.uv-win-close:hover {
  border-color: #7ec8ff;
}
.uv-win-ro {
  margin: 0;
  padding: 6px 14px;
  font-size: 11px;
  color: #c49a6a;
  background: rgba(120, 70, 30, 0.2);
}
.uv-win-empty {
  padding: 24px 20px;
  color: #8e97a6;
  font-size: 12px;
}
.uv-win-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  padding: 10px 14px;
  border-bottom: 1px solid #2a3344;
}
.uv-lab {
  font-size: 11px;
  color: #8aa4c8;
  margin-right: 6px;
}
.uv-sel {
  background: #252a32;
  color: #e6ebf3;
  border: 1px solid #4a5568;
  border-radius: 4px;
  padding: 4px 8px;
  font-size: 12px;
}
.uv-btn {
  padding: 5px 12px;
  border-radius: 5px;
  border: 1px solid #4a6a8a;
  background: #2a3a4c;
  color: #d8e8f8;
  font-size: 11px;
  cursor: pointer;
}
.uv-btn:hover {
  border-color: #7ec8ff;
}
.uv-nudge {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  color: #a8b4c8;
}
.uv-inp {
  width: 72px;
  margin-left: 4px;
  background: #252a32;
  border: 1px solid #4a5568;
  color: #e6ebf3;
  border-radius: 4px;
  padding: 3px 6px;
  font-size: 11px;
}
.uv-canvas {
  display: block;
  margin: 12px;
  border-radius: 6px;
  border: 1px solid #3a4558;
  cursor: grab;
  touch-action: none;
}
.uv-canvas:active {
  cursor: grabbing;
}
</style>
