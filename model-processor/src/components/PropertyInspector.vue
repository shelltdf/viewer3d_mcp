<script setup>
import { computed, ref, watch } from 'vue'
import TexturePreviewCanvas from './TexturePreviewCanvas.vue'
import MaterialPreviewBall from './MaterialPreviewBall.vue'
import { getTextureMemoryBreakdown } from '../utils/textureMemory.js'

const props = defineProps({
  /** @type {any} */
  payload: { type: Object, default: null },
})

const emit = defineEmits(['open-lightbox', 'action'])

const MAP_KEYS = [
  'map',
  'lightMap',
  'aoMap',
  'emissiveMap',
  'bumpMap',
  'normalMap',
  'displacementMap',
  'roughnessMap',
  'metalnessMap',
  'alphaMap',
  'envMap',
  'specularMap',
  'gradientMap',
]

const textureChannel = ref('rgba')

watch(
  () => props.payload,
  () => {
    textureChannel.value = 'rgba'
  },
  { deep: true },
)

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

function fmtBytes(n) {
  if (n == null || Number.isNaN(n)) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(2)} MB`
}

const textureMem = computed(() => {
  const p = props.payload
  if (p?.kind !== 'texture' || !p.texture) return null
  return getTextureMemoryBreakdown(p.texture)
})

function materialScalarParams(m) {
  if (!m) return []
  const skip = new Set(['version', 'uuid', 'type', 'id', 'userData'])
  const rows = []
  for (const k of Object.keys(m)) {
    if (skip.has(k)) continue
    const v = m[k]
    if (typeof v === 'function') continue
    if (v?.isTexture) continue
    if (v?.isVector2) {
      rows.push({ key: k, value: `(${fmt(v.x)}, ${fmt(v.y)})` })
    } else if (v?.isVector3) {
      rows.push({ key: k, value: `(${fmt(v.x)}, ${fmt(v.y)}, ${fmt(v.z)})` })
    } else if (v?.isColor) {
      rows.push({ key: k, value: v.getHexString ? '#' + v.getHexString() : String(v) })
    } else if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') {
      rows.push({ key: k, value: String(v) })
    } else if (v == null) {
      rows.push({ key: k, value: '—' })
    }
  }
  return rows.sort((a, b) => a.key.localeCompare(b.key))
}

function onDblTex() {
  const p = props.payload
  if (p?.kind === 'texture' && p.texture) {
    emit('open-lightbox', {
      kind: 'texture',
      texture: p.texture,
      channel: textureChannel.value,
    })
  }
}

function onDblMat() {
  const p = props.payload
  if (p?.kind === 'material' && p.material) emit('open-lightbox', { kind: 'material', material: p.material })
}

function onCompressTexture() {
  const p = props.payload
  if (p?.kind === 'texture' && p.texture) emit('action', { type: 'texture-compress', texture: p.texture })
}

function onDecompressTexture() {
  const p = props.payload
  if (p?.kind === 'texture' && p.texture) emit('action', { type: 'texture-decompress', texture: p.texture })
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

      <template v-if="payload.meshMaterialInfo && (payload.object.isMesh || payload.object.isSkinnedMesh)">
        <h4 class="sub-title">材质与内存（本 Mesh）</h4>
        <p class="mesh-sum">
          几何约 <strong>{{ fmtBytes(payload.meshMaterialInfo.geometryBytes) }}</strong>
        </p>
        <div class="mesh-table-wrap">
          <table class="mesh-table mesh-mem-table">
            <thead>
              <tr>
                <th>槽位</th>
                <th>材质</th>
                <th>贴图 GPU</th>
                <th>RGBA 粗估</th>
                <th>BC7 类粗估</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in payload.meshMaterialInfo.materials" :key="row.uuid + '-' + row.slot">
                <td>{{ row.slot }}</td>
                <td class="mono">{{ row.name }}</td>
                <td>{{ fmtBytes(row.texGpu) }}</td>
                <td>{{ fmtBytes(row.texRaw) }}</td>
                <td>{{ fmtBytes(row.texBc7) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="hint tiny">BC7 类为块压缩粗估；实际格式以资源与 GPU 为准。</p>
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
      </dl>

      <h4 class="sub-title">贴图槽</h4>
      <div class="slot-grid">
        <div v-for="k in MAP_KEYS" :key="k" class="slot-cell">
          <div class="slot-name">{{ k }}</div>
          <div v-if="payload.material[k]?.isTexture" class="slot-thumb">
            <TexturePreviewCanvas :texture="payload.material[k]" :size="64" />
          </div>
          <div v-else class="slot-empty">—</div>
        </div>
      </div>

      <h4 class="sub-title">参数</h4>
      <div class="param-table-wrap">
        <table class="param-table">
          <tbody>
            <tr v-for="row in materialScalarParams(payload.material)" :key="row.key">
              <td class="p-key">{{ row.key }}</td>
              <td class="p-val">{{ row.value }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else-if="payload.kind === 'texture' && payload.texture">
      <div class="ch-row">
        <span class="ch-label">通道</span>
        <select v-model="textureChannel" class="ch-sel">
          <option value="rgba">RGBA</option>
          <option value="r">R</option>
          <option value="g">G</option>
          <option value="b">B</option>
          <option value="a">A</option>
        </select>
      </div>
      <div class="preview-block" title="双击最大化预览" @dblclick="onDblTex">
        <TexturePreviewCanvas :texture="payload.texture" :size="168" :channel="textureChannel" />
        <span class="preview-tip">双击放大</span>
      </div>
      <div v-if="textureMem" class="mem-block">
        <p class="mem-line">
          未压缩 RGBA 粗估：<strong>{{ fmtBytes(textureMem.rawRGBA) }}</strong>
        </p>
        <p class="mem-line">
          当前 GPU 占用：<strong>{{ fmtBytes(textureMem.gpuCurrent) }}</strong>
          <span v-if="textureMem.isCompressed" class="tag">已压缩格式</span>
        </p>
        <p class="mem-line">
          块压缩（BC7 类）粗估：<strong>{{ fmtBytes(textureMem.compressedBC7Like) }}</strong>
        </p>
      </div>
      <div class="btn-inline">
        <button type="button" class="mini-btn" @click="onCompressTexture">压缩</button>
        <button type="button" class="mini-btn" @click="onDecompressTexture">解压</button>
      </div>
      <p class="hint tiny">压缩/解压需接入管线；浏览器内仅作占位提示。</p>
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
.hint.tiny {
  font-size: 10px;
  margin-top: 6px;
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
.mesh-sum strong {
  color: #9fdfb8;
}
.mesh-table-wrap {
  overflow: auto;
  max-height: 200px;
  border: 1px solid #3a4558;
  border-radius: 4px;
}
.mesh-mem-table {
  font-size: 9px;
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
.ch-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.ch-label {
  font-size: 10px;
  color: #8e97a6;
}
.ch-sel {
  flex: 1;
  padding: 4px 6px;
  border: 1px solid #4a5160;
  border-radius: 3px;
  background: #1b2029;
  color: #e6ebf3;
  font-size: 11px;
}
.mem-block {
  margin-bottom: 10px;
  padding: 8px;
  border: 1px solid #3a4558;
  border-radius: 4px;
  background: #1e2229;
}
.mem-line {
  margin: 0 0 6px;
  font-size: 10px;
  color: #aeb6c4;
}
.mem-line:last-child {
  margin-bottom: 0;
}
.mem-line strong {
  color: #9fdfb8;
  font-variant-numeric: tabular-nums;
}
.tag {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 4px;
  font-size: 9px;
  border-radius: 2px;
  background: #3d5a82;
  color: #dbe8ff;
}
.btn-inline {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}
.mini-btn {
  padding: 4px 10px;
  font-size: 11px;
  border: 1px solid #5b626f;
  border-radius: 3px;
  background: #3a4452;
  color: #edf2ff;
  cursor: pointer;
}
.mini-btn:hover {
  border-color: #7696c3;
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
.slot-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}
.slot-cell {
  border: 1px solid #3a4558;
  border-radius: 4px;
  padding: 6px;
  background: #1a1d24;
}
.slot-name {
  font-size: 9px;
  color: #8aa4c8;
  margin-bottom: 4px;
  word-break: break-all;
}
.slot-thumb {
  display: flex;
  justify-content: center;
}
.slot-empty {
  font-size: 10px;
  color: #5c6570;
  text-align: center;
  padding: 20px 0;
}
.param-table-wrap {
  max-height: 220px;
  overflow: auto;
  border: 1px solid #3a4558;
  border-radius: 4px;
}
.param-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 10px;
}
.param-table td {
  padding: 3px 6px;
  border-bottom: 1px solid #2e3440;
  vertical-align: top;
}
.p-key {
  color: #8e97a6;
  width: 42%;
  word-break: break-all;
}
.p-val {
  color: #d0d8e6;
  word-break: break-all;
  font-family: ui-monospace, monospace;
  font-size: 9px;
}
</style>
