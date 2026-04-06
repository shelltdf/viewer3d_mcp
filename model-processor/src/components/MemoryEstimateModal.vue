<script setup>
import { computed } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  /** 'source' | 'result' */
  panel: { type: String, default: 'source' },
  getEstimate: { type: Function, required: true },
})

const emit = defineEmits(['close', 'update:panel'])

const data = computed(() => {
  try {
    return props.getEstimate(props.panel) || null
  } catch {
    return null
  }
})

const bars = computed(() => {
  const e = data.value
  if (!e?.breakdown?.length) return []
  const t = Math.max(e.total, 1)
  return e.breakdown.map((x) => ({
    ...x,
    pct: Math.min(100, Math.round((x.bytes / t) * 1000) / 10),
  }))
})

function fmtBytes(n) {
  if (n == null || Number.isNaN(n)) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="mem-root">
      <div class="mem-back" @click.self="emit('close')" />
      <div class="mem-panel" role="dialog">
        <header class="mem-head">
          <h2>内存占用估算</h2>
          <button type="button" class="mem-x" @click="emit('close')">×</button>
        </header>
        <div class="mem-toggle">
          <button
            type="button"
            class="mem-tab"
            :class="{ on: panel === 'source' }"
            @click="emit('update:panel', 'source')"
          >
            处理前
          </button>
          <button
            type="button"
            class="mem-tab"
            :class="{ on: panel === 'result' }"
            @click="emit('update:panel', 'result')"
          >
            处理后
          </button>
        </div>
        <div v-if="data" class="mem-body">
          <p class="mem-total">
            合计约 <strong>{{ fmtBytes(data.total) }}</strong>
            <span class="mem-sub"> · Mesh {{ data.meshCount }} · 贴图 {{ data.textureCount }}</span>
          </p>
          <div class="mem-bars">
            <div v-for="b in bars" :key="b.id" class="mem-row">
              <div class="mem-label">{{ b.label }}</div>
              <div class="mem-bar-wrap">
                <div class="mem-bar" :style="{ width: b.pct + '%' }" />
              </div>
              <div class="mem-val">{{ fmtBytes(b.bytes) }}（{{ b.pct }}%）</div>
            </div>
          </div>
          <p class="mem-note">{{ data.note }}</p>
        </div>
        <div v-else class="mem-empty">当前侧无模型或无法估算。</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mem-root {
  position: fixed;
  inset: 0;
  z-index: 350;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mem-back {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
}
.mem-panel {
  position: relative;
  z-index: 1;
  width: min(520px, 94vw);
  max-height: min(88vh, 640px);
  overflow: auto;
  background: linear-gradient(#2c3138, #252a32);
  border: 1px solid #4a5568;
  border-radius: 8px;
  padding: 0 0 14px;
}
.mem-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid #3d4654;
}
.mem-head h2 {
  margin: 0;
  font-size: 15px;
  color: #e2e8f0;
}
.mem-x {
  border: none;
  background: transparent;
  color: #9aa3b0;
  font-size: 22px;
  cursor: pointer;
}
.mem-toggle {
  display: flex;
  gap: 8px;
  padding: 10px 14px 0;
}
.mem-tab {
  flex: 1;
  padding: 8px;
  border: 1px solid #4a5568;
  border-radius: 4px;
  background: #2a3038;
  color: #aeb6c4;
  cursor: pointer;
  font-size: 12px;
}
.mem-tab.on {
  background: #3d5a82;
  border-color: #6b94c9;
  color: #f0f4fc;
}
.mem-body {
  padding: 12px 14px 0;
  font-size: 12px;
  color: #c5cdd9;
}
.mem-total {
  margin: 0 0 12px;
}
.mem-total strong {
  color: #9fdfb8;
  font-size: 16px;
}
.mem-sub {
  color: #8e97a6;
  font-size: 11px;
}
.mem-bars {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.mem-row {
  display: grid;
  grid-template-columns: 100px 1fr minmax(120px, auto);
  gap: 8px;
  align-items: center;
  font-size: 11px;
}
.mem-label {
  color: #9aa3b0;
}
.mem-bar-wrap {
  height: 14px;
  background: #1a1f26;
  border-radius: 3px;
  overflow: hidden;
  border: 1px solid #3a4558;
}
.mem-bar {
  height: 100%;
  background: linear-gradient(90deg, #4a7ab8, #5a9fd4);
  min-width: 2px;
}
.mem-val {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #d0d8e6;
}
.mem-note {
  margin: 14px 0 0;
  font-size: 10px;
  color: #7a8494;
  line-height: 1.45;
}
.mem-empty {
  padding: 24px 14px;
  font-size: 12px;
  color: #8e97a6;
  text-align: center;
}
</style>
