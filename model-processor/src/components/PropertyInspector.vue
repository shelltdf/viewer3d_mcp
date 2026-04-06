<script setup>
import { computed } from 'vue'

const props = defineProps({
  /** @type {{ kind: string, label?: string, object?: object, material?: object, texture?: object, clip?: object } | null} */
  payload: { type: Object, default: null },
})

const title = computed(() => {
  const p = props.payload
  if (!p || p.kind === 'empty') return '未选择'
  if (p.kind === 'section') return p.label || '分组'
  const map = {
    object3d: '对象',
    material: '材质',
    texture: '贴图',
    clip: '动画片段',
  }
  return map[p.kind] || '属性'
})

function fmt(v) {
  if (v === undefined || v === null) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(4)
  return String(v)
}
</script>

<template>
  <div class="inspector">
    <p class="inspector-title">{{ title }}</p>
    <div v-if="!payload || payload.kind === 'empty'" class="empty">在左侧大纲中选择一个条目</div>

    <template v-else-if="payload.kind === 'section'">
      <p class="hint">{{ payload.label }}</p>
    </template>

    <template v-else-if="payload.kind === 'object3d' && payload.object">
      <dl class="kv">
        <dt>类型</dt>
        <dd>{{ payload.object.type }}</dd>
        <dt>名称</dt>
        <dd>{{ payload.object.name || '（未命名）' }}</dd>
        <dt>UUID</dt>
        <dd class="mono">{{ payload.object.uuid }}</dd>
        <dt>可见</dt>
        <dd>{{ payload.object.visible ? '是' : '否' }}</dd>
        <template v-if="payload.object.isMesh || payload.object.isSkinnedMesh">
          <dt>几何</dt>
          <dd>{{ payload.object.geometry?.type || '—' }}</dd>
          <dt>材质数</dt>
          <dd>
            {{ Array.isArray(payload.object.material) ? payload.object.material.length : payload.object.material ? 1 : 0 }}
          </dd>
        </template>
        <template v-if="payload.object.isSkinnedMesh">
          <dt>骨骼</dt>
          <dd>{{ payload.object.skeleton?.bones?.length ?? '—' }}</dd>
        </template>
      </dl>
    </template>

    <template v-else-if="payload.kind === 'material' && payload.material">
      <dl class="kv">
        <dt>类型</dt>
        <dd>{{ payload.material.type }}</dd>
        <dt>名称</dt>
        <dd>{{ payload.material.name || '（未命名）' }}</dd>
        <dt>UUID</dt>
        <dd class="mono">{{ payload.material.uuid }}</dd>
        <dt>颜色</dt>
        <dd v-if="payload.material.color">#{{ payload.material.color.getHexString?.() }}</dd>
        <dd v-else>—</dd>
        <dt>金属度 / 粗糙度</dt>
        <dd>
          {{ fmt(payload.material.metalness) }} / {{ fmt(payload.material.roughness) }}
        </dd>
        <dt>透明</dt>
        <dd>{{ payload.material.transparent ? '是' : '否' }} · opacity {{ fmt(payload.material.opacity) }}</dd>
      </dl>
    </template>

    <template v-else-if="payload.kind === 'texture' && payload.texture">
      <dl class="kv">
        <dt>名称</dt>
        <dd>{{ payload.texture.name || '（未命名）' }}</dd>
        <dt>UUID</dt>
        <dd class="mono">{{ payload.texture.uuid }}</dd>
        <dt>尺寸</dt>
        <dd>
          <template v-if="payload.texture.image && payload.texture.image.width">
            {{ payload.texture.image.width }} × {{ payload.texture.image.height }}
          </template>
          <template v-else>—</template>
        </dd>
        <dt>重复</dt>
        <dd>
          {{ fmt(payload.texture.repeat?.x) }}, {{ fmt(payload.texture.repeat?.y) }}
        </dd>
        <dt>色彩空间</dt>
        <dd>{{ payload.texture.colorSpace || '—' }}</dd>
      </dl>
    </template>

    <template v-else-if="payload.kind === 'clip' && payload.clip">
      <dl class="kv">
        <dt>名称</dt>
        <dd>{{ payload.clip.name || '（未命名）' }}</dd>
        <dt>时长 (s)</dt>
        <dd>{{ fmt(payload.clip.duration) }}</dd>
        <dt>轨道数</dt>
        <dd>{{ payload.clip.tracks?.length ?? 0 }}</dd>
      </dl>
    </template>
  </div>
</template>

<style scoped>
.inspector {
  font-size: 12px;
  color: #c5cdd9;
}
.inspector-title {
  margin: 0 0 10px;
  font-size: 12px;
  font-weight: 600;
  color: #9fb3d6;
}
.empty {
  color: #7a8494;
  font-size: 11px;
}
.hint {
  margin: 0;
  color: #8e97a6;
  font-size: 11px;
}
.kv {
  margin: 0;
  display: grid;
  grid-template-columns: 88px 1fr;
  gap: 6px 8px;
  align-items: baseline;
}
.kv dt {
  margin: 0;
  font-size: 10px;
  color: #8e97a6;
}
.kv dd {
  margin: 0;
  font-size: 11px;
  word-break: break-all;
}
.mono {
  font-family: ui-monospace, monospace;
  font-size: 10px;
}
</style>
