<script setup>
import { computed } from 'vue'
import TexturePreviewCanvas from './TexturePreviewCanvas.vue'
import MaterialPreviewBall from './MaterialPreviewBall.vue'

const props = defineProps({
  /** @type {any} */
  payload: { type: Object, default: null },
})

const emit = defineEmits(['open-lightbox'])

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

function onDblTex() {
  const p = props.payload
  if (p?.kind === 'texture' && p.texture) emit('open-lightbox', { kind: 'texture', texture: p.texture })
}

function onDblMat() {
  const p = props.payload
  if (p?.kind === 'material' && p.material) emit('open-lightbox', { kind: 'material', material: p.material })
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
      </dl>

      <template v-if="payload.meshInfo">
        <h4 class="sub-title">子树 Mesh 汇总</h4>
        <p class="mesh-sum">
          合计：三角面 {{ payload.meshInfo.totals.triangles.toLocaleString() }} · 顶点
          {{ payload.meshInfo.totals.vertices.toLocaleString() }} · Mesh {{ payload.meshInfo.totals.meshes }}
        </p>
        <div v-if="payload.meshInfo.meshes.length" class="mesh-table-wrap">
          <table class="mesh-table">
            <thead>
              <tr>
                <th>名称</th>
                <th>三角面</th>
                <th>顶点</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="m in payload.meshInfo.meshes" :key="m.uuid">
                <td>{{ m.name }}</td>
                <td>{{ m.triangles.toLocaleString() }}</td>
                <td>{{ m.vertices.toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-else class="hint">该节点下无 Mesh（可能为组 / 变换节点）</p>
      </template>

      <template v-if="payload.object.isMesh || payload.object.isSkinnedMesh">
        <h4 class="sub-title">本节点（若为 Mesh）</h4>
        <dl class="kv">
          <dt>几何</dt>
          <dd>{{ payload.object.geometry?.type || '—' }}</dd>
          <dt>材质数</dt>
          <dd>
            {{ Array.isArray(payload.object.material) ? payload.object.material.length : payload.object.material ? 1 : 0 }}
          </dd>
        </dl>
      </template>
      <template v-if="payload.object.isSkinnedMesh">
        <dl class="kv">
          <dt>骨骼</dt>
          <dd>{{ payload.object.skeleton?.bones?.length ?? '—' }}</dd>
        </dl>
      </template>
    </template>

    <template v-else-if="payload.kind === 'material' && payload.material">
      <div class="preview-block" title="双击最大化预览" @dblclick="onDblMat">
        <MaterialPreviewBall :material="payload.material" :size="168" />
        <span class="preview-tip">双击放大</span>
      </div>
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
      <div class="preview-block" title="双击最大化预览" @dblclick="onDblTex">
        <TexturePreviewCanvas :texture="payload.texture" :size="168" />
        <span class="preview-tip">双击放大</span>
      </div>
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
.sub-title {
  margin: 12px 0 6px;
  font-size: 11px;
  font-weight: 600;
  color: #8aa4c8;
}
.mesh-sum {
  margin: 0 0 8px;
  font-size: 11px;
  color: #b8c0d0;
}
.mesh-table-wrap {
  overflow: auto;
  max-height: 200px;
  border: 1px solid #3a4558;
  border-radius: 4px;
}
.mesh-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10px;
}
.mesh-table th,
.mesh-table td {
  padding: 4px 6px;
  text-align: left;
  border-bottom: 1px solid #2e3440;
}
.mesh-table th {
  background: #2a3038;
  color: #9aa3b0;
}
.preview-block {
  position: relative;
  margin-bottom: 10px;
  cursor: zoom-in;
}
.preview-tip {
  display: block;
  margin-top: 4px;
  font-size: 10px;
  color: #6b7a8e;
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
