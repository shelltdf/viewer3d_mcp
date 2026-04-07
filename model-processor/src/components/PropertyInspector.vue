<script setup>
import { computed, ref, watch } from 'vue'
import * as THREE from 'three'
import TexturePreviewCanvas from './TexturePreviewCanvas.vue'
import MaterialPreviewBall from './MaterialPreviewBall.vue'
import {
  getTextureMemoryBreakdown,
  getTextureSamplingRows,
  getTextureCompressionFormatTable,
} from '../utils/textureMemory.js'
import { getMeshGeometryCompressionEstimates } from '../utils/meshCompressionEstimate.js'
import {
  getObject3DContentHashDisplay,
  getMaterialContentHashDisplay,
  getTextureContentHashDisplay,
  getClipContentHashDisplay,
} from '../utils/selectionContentHash.js'
import { sanitizeTangentAttribute, vertexAttrDisplayName } from '../utils/vertexAttrNaming.js'
import {
  refreshGeometryBounds,
  syncMaterialsVertexTangentsFromGeometry,
  syncStandardMaterialsForNormalMap,
} from '../utils/meshTangentMaterialSync.js'
import { applyTextureColorSpaceForMaterialSlot } from '../utils/materialTextureSlots.js'
import { useUiLocale } from '../composables/useUiLocale.js'
import { createMaterialByTypeName, MESH_MATERIAL_TYPE_OPTIONS } from '../utils/materialReplace.js'

const { t } = useUiLocale()

const props = defineProps({
  /** @type {any} */
  payload: { type: Object, default: null },
  /** 与大纲当前焦点一致：source=处理前只读，result=处理后可编辑 */
  selectionPanel: { type: String, default: 'source' },
})

const emit = defineEmits(['open-lightbox', 'action'])

/** 贴图槽格内短标签（完整名 tooltip） */
const SLOT_SHORT = {
  map: 'map',
  lightMap: 'light',
  aoMap: 'ao',
  emissiveMap: 'emit',
  bumpMap: 'bump',
  normalMap: 'N',
  displacementMap: 'disp',
  roughnessMap: 'rough',
  metalnessMap: 'metal',
  alphaMap: 'α',
  envMap: 'env',
  specularMap: 'spec',
  gradientMap: 'grad',
}

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
const matAutoRotate = ref(false)
/** 材质标量就地修改时强制重算可编辑行（payload 引用不变） */
const materialParamsTick = ref(0)
const slotCtx = ref(null)
const slotFileInputRef = ref(null)
const pendingSlotKey = ref('')
const slotImportLoading = ref(false)

watch(
  () => [
    props.payload?.kind,
    props.payload?.object?.uuid,
    props.payload?.material?.uuid,
    props.payload?.texture?.uuid,
  ],
  () => {
    textureChannel.value = 'rgba'
    matAutoRotate.value = false
    meshMatEditTick.value++
  },
)

/** 同对象上直接改 BufferGeometry 时触发列表重算 */
const geometryInspectTick = ref(0)
watch(
  () => props.payload?.object?.uuid,
  () => {
    geometryInspectTick.value = 0
  },
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

const isReadOnlyContext = computed(() => props.selectionPanel === 'source')

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

const textureSampling = computed(() => {
  const p = props.payload
  if (p?.kind !== 'texture' || !p.texture) return []
  return getTextureSamplingRows(p.texture).rows
})

const textureCompressTable = computed(() => {
  const p = props.payload
  if (p?.kind !== 'texture' || !p.texture) return []
  return getTextureCompressionFormatTable(p.texture)
})

const meshGeoCompress = computed(() => {
  const p = props.payload
  const g = p?.object?.geometry
  if (!g?.isBufferGeometry) return []
  return getMeshGeometryCompressionEstimates(g)
})

/** @type {import('vue').ComputedRef<{ name: string, itemSize: number, count: number, normalized: boolean }[]>} */
const meshVertexAttrs = computed(() => {
  geometryInspectTick.value
  const g = props.payload?.object?.geometry
  if (!g?.isBufferGeometry || !g.attributes) return []
  return Object.keys(g.attributes)
    .map((name) => {
      const a = g.attributes[name]
      return {
        name,
        itemSize: a.itemSize,
        count: a.count,
        normalized: !!a.normalized,
      }
    })
    .sort((x, y) => x.name.localeCompare(y.name))
})

const selectionContentHash = computed(() => {
  const p = props.payload
  if (!p || p.kind === 'empty' || p.kind === 'section') return '—'
  if (p.kind === 'object3d' && p.object) return getObject3DContentHashDisplay(p.object)
  if (p.kind === 'material' && p.material) return getMaterialContentHashDisplay(p.material)
  if (p.kind === 'texture' && p.texture) return getTextureContentHashDisplay(p.texture)
  if (p.kind === 'clip' && p.clip) return getClipContentHashDisplay(p.clip)
  return '—'
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

const MAT_PARAM_SKIP = new Set([
  ...MAP_KEYS,
  'uuid',
  'version',
  'id',
  'type',
  'userData',
  'defines',
  'name',
  'blending',
  'blendEquation',
  'blendSrc',
  'blendDst',
  'blendEquationAlpha',
  'blendSrcAlpha',
  'blendDstAlpha',
  'blendColor',
  'blendAlpha',
  'premultipliedAlpha',
  'clipping',
  'clipIntersection',
  'clipShadows',
  'shadowSide',
  'toneMapped',
  'dithering',
  'clippingPlanes',
])

function materialNumberMeta(key) {
  if (['roughness', 'metalness', 'opacity', 'reflectivity', 'refractionRatio', 'sheen', 'sheenRoughness'].includes(key)) {
    return { min: 0, max: 1, step: 0.01 }
  }
  if (key === 'shininess') return { min: 0, max: 1000, step: 1 }
  if (key === 'bumpScale' || key === 'displacementScale') return { min: -20, max: 20, step: 0.01 }
  if (key === 'displacementBias') return { min: -2, max: 2, step: 0.001 }
  if (
    ['emissiveIntensity', 'envMapIntensity', 'lightMapIntensity', 'aoMapIntensity', 'transmission', 'thickness'].includes(
      key,
    )
  ) {
    return { min: 0, max: 20, step: 0.05 }
  }
  if (key === 'ior') return { min: 1, max: 2.5, step: 0.01 }
  if (['clearcoat', 'clearcoatRoughness', 'iridescence', 'iridescenceIOR', 'anisotropy'].includes(key)) {
    return { min: 0, max: 1, step: 0.01 }
  }
  if (key === 'wireframeLinewidth') return { min: 0, max: 20, step: 0.5 }
  return { min: -1e6, max: 1e6, step: 0.001 }
}

function buildMaterialEditableRows(m) {
  if (!m || m.isShaderMaterial || m.isRawShaderMaterial) return []
  const rows = []
  for (const key of Object.keys(m).sort()) {
    if (MAT_PARAM_SKIP.has(key)) continue
    const v = m[key]
    if (typeof v === 'function') continue
    if (v?.isTexture) continue
    if (v && typeof v === 'object' && !v.isColor && !v.isVector2 && !v.isVector3) continue
    if (key === 'side' && typeof v === 'number') {
      rows.push({ key, kind: 'side', value: v })
    } else if (typeof v === 'boolean') {
      rows.push({ key, kind: 'bool', value: v })
    } else if (typeof v === 'number') {
      rows.push({ key, kind: 'number', value: v, ...materialNumberMeta(key) })
    } else if (v?.isColor) {
      rows.push({ key, kind: 'color', value: '#' + v.getHexString() })
    } else if (v?.isVector2) {
      rows.push({ key, kind: 'vec2', x: v.x, y: v.y })
    } else if (v?.isVector3) {
      rows.push({ key, kind: 'vec3', x: v.x, y: v.y, z: v.z })
    }
  }
  return rows
}

const materialEditableRows = computed(() => {
  materialParamsTick.value
  const m = props.payload?.kind === 'material' ? props.payload.material : null
  return buildMaterialEditableRows(m)
})

const materialTypeSelectOptions = MESH_MATERIAL_TYPE_OPTIONS

/** 选中 Mesh 时编辑材质槽后强制刷新本段 UI */
const meshMatEditTick = ref(0)

const QUICK_MAT_NUM_KEYS = [
  'roughness',
  'metalness',
  'shininess',
  'opacity',
  'emissiveIntensity',
  'envMapIntensity',
  'lightMapIntensity',
  'aoMapIntensity',
]

const meshSlotsDetail = computed(() => {
  meshMatEditTick.value
  const o = props.payload?.object
  if (!o || (!o.isMesh && !o.isSkinnedMesh)) return []
  const mats = Array.isArray(o.material) ? o.material : [o.material]
  const out = []
  for (let slot = 0; slot < mats.length; slot++) {
    const mat = mats[slot]
    if (!mat) continue
    const quickRows = []
    for (const key of QUICK_MAT_NUM_KEYS) {
      if (typeof mat[key] === 'number') {
        quickRows.push({ key, kind: 'number', value: mat[key], ...materialNumberMeta(key) })
      }
    }
    out.push({ slot, mat, quickRows })
  }
  return out
})

function onMeshSlotMaterialTypeChange(slot, ev) {
  const newType = ev.target?.value
  if (isReadOnlyContext.value || !newType) return
  const o = props.payload?.object
  if (!o?.isMesh && !o?.isSkinnedMesh) return
  const mats = Array.isArray(o.material) ? o.material : [o.material]
  const m = mats[slot]
  if (!m || newType === m.type) return
  if (isShaderLikeMaterial(m)) return
  const neu = createMaterialByTypeName(newType, m)
  if (!neu) return
  emit('action', {
    type: 'material-replaced',
    oldMaterial: m,
    newMaterial: neu,
    panel: props.selectionPanel,
  })
  meshMatEditTick.value++
}

function onMeshSlotOpenInOutline(mat) {
  if (!mat?.uuid) return
  emit('action', {
    type: 'select-outline-material',
    materialUuid: mat.uuid,
    panel: props.selectionPanel,
  })
}

function onMeshSlotQuickNumber(slot, key, ev) {
  if (isReadOnlyContext.value) return
  const o = props.payload?.object
  if (!o?.isMesh && !o?.isSkinnedMesh) return
  const mats = Array.isArray(o.material) ? o.material : [o.material]
  const m = mats[slot]
  if (!m || typeof m[key] !== 'number') return
  const n = parseFloat(ev.target.value)
  if (Number.isNaN(n)) return
  m[key] = n
  m.needsUpdate = true
  meshMatEditTick.value++
  emit('action', { type: 'material-updated', material: m, panel: props.selectionPanel })
}

function onMeshSlotNameInput(slot, ev) {
  if (isReadOnlyContext.value) return
  const o = props.payload?.object
  if (!o?.isMesh && !o?.isSkinnedMesh) return
  const mats = Array.isArray(o.material) ? o.material : [o.material]
  const m = mats[slot]
  if (!m) return
  m.name = ev.target?.value ?? ''
  m.needsUpdate = true
  meshMatEditTick.value++
  emit('action', { type: 'material-updated', material: m, panel: props.selectionPanel })
}

function isShaderLikeMaterial(m) {
  return !!(m && (m.isShaderMaterial || m.isRawShaderMaterial))
}

function emitMaterialUpdated() {
  const m = props.payload?.material
  if (!m) return
  m.needsUpdate = true
  materialParamsTick.value++
  emit('action', { type: 'material-updated', material: m, panel: props.selectionPanel })
}

function onMaterialTypeChange(ev) {
  const newType = ev.target?.value
  const m = props.payload?.material
  if (!m || isReadOnlyContext.value || !newType || newType === m.type) return
  const neu = createMaterialByTypeName(newType, m)
  if (!neu) return
  emit('action', {
    type: 'material-replaced',
    oldMaterial: m,
    newMaterial: neu,
    panel: props.selectionPanel,
  })
}

function onMatNameInput(ev) {
  const m = props.payload?.material
  if (!m || isReadOnlyContext.value) return
  m.name = ev.target.value
  emitMaterialUpdated()
}

function onMatNumberKey(key, ev) {
  const m = props.payload?.material
  if (!m || isReadOnlyContext.value) return
  const n = parseFloat(ev.target.value)
  if (Number.isNaN(n)) return
  m[key] = n
  emitMaterialUpdated()
}

function onMatBoolKey(key, ev) {
  const m = props.payload?.material
  if (!m || isReadOnlyContext.value) return
  m[key] = !!ev.target.checked
  emitMaterialUpdated()
}

function onMatColorKey(key, ev) {
  const m = props.payload?.material
  if (!m || isReadOnlyContext.value) return
  const c = m[key]
  if (!c?.isColor) return
  try {
    c.set(ev.target.value)
  } catch {
    /* ignore */
  }
  emitMaterialUpdated()
}

function onMatVec2Key(key, comp, ev) {
  const m = props.payload?.material
  if (!m || isReadOnlyContext.value) return
  const v = m[key]
  if (!v?.isVector2) return
  const n = parseFloat(ev.target.value)
  if (Number.isNaN(n)) return
  if (comp === 'x') v.x = n
  else v.y = n
  emitMaterialUpdated()
}

function onMatVec3Key(key, comp, ev) {
  const m = props.payload?.material
  if (!m || isReadOnlyContext.value) return
  const v = m[key]
  if (!v?.isVector3) return
  const n = parseFloat(ev.target.value)
  if (Number.isNaN(n)) return
  if (comp === 'x') v.x = n
  else if (comp === 'y') v.y = n
  else v.z = n
  emitMaterialUpdated()
}

function onMatSideChange(ev) {
  const m = props.payload?.material
  if (!m || isReadOnlyContext.value) return
  const v = parseInt(ev.target.value, 10)
  if (Number.isNaN(v)) return
  m.side = v
  emitMaterialUpdated()
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

function closeSlotCtx() {
  slotCtx.value = null
}

function onSlotContextMenu(e, key) {
  if (props.payload?.kind !== 'material' || !props.payload.material) return
  if (isReadOnlyContext.value) return
  e.preventDefault()
  e.stopPropagation()
  slotCtx.value = { key, x: e.clientX, y: e.clientY }
}

function slotImportClick() {
  if (!slotCtx.value) return
  pendingSlotKey.value = slotCtx.value.key
  closeSlotCtx()
  slotFileInputRef.value?.click()
}

function slotClearClick() {
  if (!slotCtx.value || props.payload?.kind !== 'material') return
  const key = slotCtx.value.key
  const m = props.payload.material
  closeSlotCtx()
  if (!m[key]?.isTexture) return
  m[key] = null
  m.needsUpdate = true
  emit('action', { type: 'material-updated', material: m, panel: props.selectionPanel })
}

async function onSlotImagePicked(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  const key = pendingSlotKey.value
  pendingSlotKey.value = ''
  if (!file || props.payload?.kind !== 'material' || !key) return
  const m = props.payload.material
  const url = URL.createObjectURL(file)
  slotImportLoading.value = true
  try {
    const tex = await new THREE.TextureLoader().loadAsync(url)
    tex.name = file.name
    applyTextureColorSpaceForMaterialSlot(tex, key)
    m[key] = tex
    m.needsUpdate = true
    emit('action', { type: 'material-updated', material: m, panel: props.selectionPanel })
  } catch (err) {
    emit('action', {
      type: 'inspector-status',
      level: 'error',
      message: `贴图加载失败：${err?.message || String(err)}`,
    })
  } finally {
    slotImportLoading.value = false
    URL.revokeObjectURL(url)
  }
}

function meshGeoEditable() {
  const p = props.payload
  if (p?.kind !== 'object3d' || !p.object) return null
  if (!p.object.isMesh && !p.object.isSkinnedMesh) return null
  const g = p.object.geometry
  return g?.isBufferGeometry ? g : null
}

function onAddUvChannel() {
  const g = meshGeoEditable()
  if (!g || isReadOnlyContext.value) return
  if (g.getAttribute('uv')) {
    emit('action', { type: 'inspector-status', message: '已存在 uv 通道，跳过添加。' })
    return
  }
  const pos = g.getAttribute('position')
  if (!pos) return
  const n = pos.count
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2))
  g.getAttribute('uv').needsUpdate = true
  geometryInspectTick.value++
  emit('action', { type: 'vertex-attrs-changed' })
}

function onAddUv2Channel() {
  const g = meshGeoEditable()
  if (!g || isReadOnlyContext.value) return
  if (g.getAttribute('uv2')) {
    emit('action', { type: 'inspector-status', message: '已存在 uv2 通道，跳过添加。' })
    return
  }
  const pos = g.getAttribute('position')
  if (!pos) return
  const n = pos.count
  g.setAttribute('uv2', new THREE.BufferAttribute(new Float32Array(n * 2), 2))
  g.getAttribute('uv2').needsUpdate = true
  geometryInspectTick.value++
  emit('action', { type: 'vertex-attrs-changed' })
}

function onEnsureNormals() {
  const g = meshGeoEditable()
  if (!g || isReadOnlyContext.value) return
  g.computeVertexNormals()
  const na = g.getAttribute('normal')
  if (na) na.needsUpdate = true
  geometryInspectTick.value++
  emit('action', { type: 'vertex-attrs-changed' })
}

/**
 * Three `computeTangents()` 要求 index + position + normal + uv；无 index 时仅 console.error 并静默返回。
 * @param {import('three').BufferGeometry} g
 */
function ensureIndexedForTangents(g) {
  if (g.index) return
  const pos = g.getAttribute('position')
  if (!pos) return
  const n = pos.count
  const IndexArray = n > 65535 ? Uint32Array : Uint16Array
  const arr = new IndexArray(n)
  for (let i = 0; i < n; i++) arr[i] = i
  // r174：`setIndex(typedArray)` 会把 index 设为裸 TypedArray，非 BufferAttribute；
  // WebGL 绑定读 `index.array.byteLength` 会抛错，网格整段不画。
  g.setIndex(new THREE.BufferAttribute(arr, 1))
  if (g.index) g.index.needsUpdate = true
}

/**
 * UV 全相同或全零时每个三角形在 UV 上退化，`computeTangents` 会跳过全部面 → 切线恒为零。
 * @param {import('three').BufferGeometry} g
 */
function ensureUvForTangentComputation(g) {
  const pos = g.getAttribute('position')
  if (!pos) return
  let uv = g.getAttribute('uv')
  if (!uv) {
    const n = pos.count
    const data = new Float32Array(n * 2)
    for (let i = 0; i < n; i++) {
      data[i * 2] = pos.getX(i) * 0.1 + 0.5
      data[i * 2 + 1] = pos.getZ(i) * 0.1 + 0.5
    }
    g.setAttribute('uv', new THREE.BufferAttribute(data, 2))
    return
  }
  const ux0 = uv.getX(0)
  const uy0 = uv.getY(0)
  const eps = 1e-6
  let constant = true
  for (let i = 1; i < uv.count; i++) {
    if (Math.abs(uv.getX(i) - ux0) > eps || Math.abs(uv.getY(i) - uy0) > eps) {
      constant = false
      break
    }
  }
  if (!constant) return
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, pos.getX(i) * 0.1 + 0.5, pos.getZ(i) * 0.1 + 0.5)
  }
  uv.needsUpdate = true
}

function onEnsureTangents() {
  const g = meshGeoEditable()
  const meshObj = props.payload?.kind === 'object3d' ? props.payload.object : null
  if (!g || isReadOnlyContext.value) return
  try {
    if (typeof g.computeTangents !== 'function') {
      emit('action', {
        type: 'inspector-status',
        level: 'error',
        message: '当前 Three 版本不支持 BufferGeometry.computeTangents()',
      })
      return
    }
    ensureIndexedForTangents(g)
    if (!g.getAttribute('normal')) g.computeVertexNormals()
    ensureUvForTangentComputation(g)
    g.computeTangents()
    sanitizeTangentAttribute(g)
    refreshGeometryBounds(g)
    if (meshObj && (meshObj.isMesh || meshObj.isSkinnedMesh)) {
      syncMaterialsVertexTangentsFromGeometry(meshObj)
      syncStandardMaterialsForNormalMap(meshObj)
    }
    const ta = g.getAttribute('tangent')
    if (ta) ta.needsUpdate = true
    geometryInspectTick.value++
    emit('action', { type: 'vertex-attrs-changed' })
    emit('action', {
      type: 'inspector-status',
      message:
        '已计算切线。若无索引或 UV 退化，已自动补齐索引或暂用位置投影 UV；导出前请核对真实展 UV。',
    })
  } catch (err) {
    emit('action', {
      type: 'inspector-status',
      level: 'error',
      message: `切线计算失败：${err?.message || String(err)}`,
    })
  }
}

function onOpenUvWindow() {
  const p = props.payload
  if (p?.kind !== 'object3d' || !p.object) return
  if (!p.object.isMesh && !p.object.isSkinnedMesh) return
  emit('action', {
    type: 'open-uv-window',
    object: p.object,
    panel: props.selectionPanel,
    label: p.object.name || p.object.uuid,
  })
}
</script>

<template>
  <div class="inspector">
    <div
      v-if="payload && payload.kind !== 'empty'"
      class="selection-context-bar"
      :class="isReadOnlyContext ? 'selection-context-bar--readonly' : 'selection-context-bar--editable'"
      role="status"
    >
      <span class="ctx-badge">{{ isReadOnlyContext ? '只读' : '可编辑' }}</span>
      <span class="ctx-text">{{
        isReadOnlyContext
          ? '当前选中来自「处理前」，仅对照；工具 / 合并 / 管线不写此侧。'
          : '当前选中来自「处理后」；工具、LOD、重复资源合并等均作用于此副本。'
      }}</span>
    </div>
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
        <dd class="mono uuid-line">{{ payload.object.uuid }}</dd>
        <dt>哈希值</dt>
        <dd
          class="mono content-hash-dd"
          title="仅几何、材质参数与贴图内容等；不含对象名称与 UUID"
        >
          {{ selectionContentHash }}
        </dd>
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

      <template v-if="meshSlotsDetail.length && (payload.object.isMesh || payload.object.isSkinnedMesh)">
        <h4 class="sub-title">{{ t('meshMatEditSection') }}</h4>
        <p class="hint tiny">{{ t('meshMatEditHint') }}</p>
        <div class="mesh-mat-slots">
          <div v-for="row in meshSlotsDetail" :key="row.slot + '-' + row.mat.uuid" class="mesh-mat-slot">
            <div class="mesh-mat-slot-head">
              <span class="mesh-mat-slot-label">槽 {{ row.slot }} · {{ row.mat.type }}</span>
              <button
                type="button"
                class="mini-btn mini-btn--primary mesh-mat-outline-btn"
                @click="onMeshSlotOpenInOutline(row.mat)"
              >
                {{ t('matOpenInOutline') }}
              </button>
            </div>
            <dl class="kv kv-tight">
              <dt>{{ t('matTypeLabel') }}</dt>
              <dd v-if="isReadOnlyContext">{{ row.mat.type }}</dd>
              <dd v-else-if="isShaderLikeMaterial(row.mat)" class="hint tiny">{{ t('matShaderNoEdit') }}</dd>
              <dd v-else>
                <select
                  class="mat-edit-sel mat-edit-sel--block"
                  :value="row.mat.type"
                  @change="onMeshSlotMaterialTypeChange(row.slot, $event)"
                >
                  <option
                    v-if="!materialTypeSelectOptions.some((o) => o.value === row.mat.type)"
                    :value="row.mat.type"
                    disabled
                  >
                    {{ row.mat.type }}
                  </option>
                  <option v-for="opt in materialTypeSelectOptions" :key="opt.value" :value="opt.value">
                    {{ t(opt.labelKey) }}
                  </option>
                </select>
              </dd>
              <dt>{{ t('matNameLabel') }}</dt>
              <dd v-if="isReadOnlyContext">{{ row.mat.name || '—' }}</dd>
              <dd v-else>
                <input
                  class="mat-edit-txt"
                  type="text"
                  :value="row.mat.name"
                  @change="onMeshSlotNameInput(row.slot, $event)"
                />
              </dd>
            </dl>
            <template v-if="!isReadOnlyContext && !isShaderLikeMaterial(row.mat)">
              <div v-if="row.quickRows.length" class="mesh-mat-quick">
                <span class="mesh-mat-quick-title">{{ t('matParamsSectionTitle') }}（常用）</span>
                <div class="mesh-mat-quick-grid">
                  <label
                    v-for="qr in row.quickRows"
                    :key="row.slot + '-' + qr.key"
                    class="mesh-mat-quick-field"
                  >
                    <span class="mesh-mat-quick-key">{{ qr.key }}</span>
                    <input
                      type="number"
                      class="mat-inp-num mesh-mat-quick-inp"
                      :min="qr.min"
                      :max="qr.max"
                      :step="qr.step"
                      :value="qr.value"
                      @change="onMeshSlotQuickNumber(row.slot, qr.key, $event)"
                    />
                  </label>
                </div>
              </div>
            </template>
          </div>
        </div>
      </template>

      <template v-if="meshGeoCompress.length && (payload.object.isMesh || payload.object.isSkinnedMesh)">
        <h4 class="sub-title">几何压缩体积粗估（Draco / Meshopt 等）</h4>
        <p class="hint tiny">以下为经验占位，非真实编码器输出；便于对比数量级。</p>
        <div class="mesh-table-wrap">
          <table class="mesh-table compress-est-table">
            <thead>
              <tr>
                <th>方式</th>
                <th>粗估体积</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, idx) in meshGeoCompress" :key="idx">
                <td>{{ row.label }}</td>
                <td class="mono">{{ fmtBytes(row.bytes) }}</td>
                <td class="compress-note">{{ row.note }}</td>
              </tr>
            </tbody>
          </table>
        </div>
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

        <template v-if="payload.object.geometry?.isBufferGeometry">
          <h4 class="sub-title">顶点属性（Buffer 通道）</h4>
          <p class="hint tiny">每项为 geometry.attributes 名称、分量数与顶点数。</p>
          <div v-if="meshVertexAttrs.length" class="mesh-table-wrap">
            <table class="mesh-table mesh-attr-table">
              <thead>
                <tr>
                  <th>名称</th>
                  <th>itemSize</th>
                  <th>count</th>
                  <th>normalized</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in meshVertexAttrs" :key="row.name">
                  <td class="mono" :title="'buffer: ' + row.name">
                    {{ vertexAttrDisplayName(row.name) }}
                  </td>
                  <td>{{ row.itemSize }}</td>
                  <td>{{ row.count.toLocaleString() }}</td>
                  <td>{{ row.normalized ? '是' : '否' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="hint tiny">当前几何暂无 attributes 条目（异常情况）。</p>
          <div class="mesh-uv-launch">
            <button type="button" class="mini-btn mini-btn--primary" @click="onOpenUvWindow">
              UV 视窗…
            </button>
            <span class="hint tiny"
              >独立二维视窗查看 uv0 / uv1… 三角拓扑；处理后可在视窗内平移 UV。</span
            >
          </div>
          <div v-if="!isReadOnlyContext" class="mesh-attr-actions">
            <button type="button" class="mini-btn" @click="onAddUvChannel">添加 uv（零填充）</button>
            <button type="button" class="mini-btn" @click="onAddUv2Channel">添加 uv2</button>
            <button type="button" class="mini-btn" @click="onEnsureNormals">重算法线</button>
            <button type="button" class="mini-btn" @click="onEnsureTangents">计算切线</button>
            <p class="hint tiny">
              切线算法需要索引、法线与 uv；无索引时会自动加顺序索引，UV 全相同/zero 时会用位置临时铺 UV。仅作用于「处理后」副本。
            </p>
          </div>
        </template>
      </template>
      <template v-if="payload.object.isSkinnedMesh">
        <dl class="kv">
          <dt>骨骼</dt>
          <dd>{{ payload.object.skeleton?.bones?.length ?? '—' }}</dd>
        </dl>
      </template>
    </template>

    <template v-else-if="payload.kind === 'material' && payload.material">
      <label class="check mat-rot-toggle">
        <input v-model="matAutoRotate" type="checkbox" />
        自动旋转预览
      </label>
      <div class="preview-block" title="双击最大化预览" @dblclick="onDblMat">
        <MaterialPreviewBall :material="payload.material" :size="168" :auto-rotate="matAutoRotate" />
        <span class="preview-tip">拖动旋转球体 · 勾选上项可自动旋转 · 双击放大</span>
      </div>
      <dl class="kv">
        <dt>{{ t('matTypeLabel') }}</dt>
        <dd v-if="isReadOnlyContext">{{ payload.material.type }}</dd>
        <dd v-else-if="isShaderLikeMaterial(payload.material)" class="hint tiny">{{ t('matShaderNoEdit') }}</dd>
        <dd v-else>
          <select
            class="mat-edit-sel"
            :value="payload.material.type"
            @change="onMaterialTypeChange($event)"
          >
            <option
              v-if="!materialTypeSelectOptions.some((o) => o.value === payload.material.type)"
              :value="payload.material.type"
              disabled
            >
              {{ payload.material.type }}
            </option>
            <option v-for="opt in materialTypeSelectOptions" :key="opt.value" :value="opt.value">
              {{ t(opt.labelKey) }}
            </option>
          </select>
        </dd>
        <dt>{{ t('matNameLabel') }}</dt>
        <dd v-if="isReadOnlyContext">{{ payload.material.name || '（未命名）' }}</dd>
        <dd v-else>
          <input
            class="mat-edit-txt"
            type="text"
            :value="payload.material.name"
            @change="onMatNameInput($event)"
          />
        </dd>
        <dt>UUID</dt>
        <dd class="mono uuid-line">{{ payload.material.uuid }}</dd>
        <dt>哈希值</dt>
        <dd
          class="mono content-hash-dd"
          title="仅可序列化参数与各槽贴图内容；不含材质名称与 UUID"
        >
          {{ selectionContentHash }}
        </dd>
      </dl>

      <h4 class="sub-title">贴图槽</h4>
      <input
        ref="slotFileInputRef"
        class="hidden-slot-file"
        type="file"
        accept="image/*,.png,.jpg,.jpeg,.webp,.gif,.bmp,.ktx,.ktx2"
        @change="onSlotImagePicked"
      />
      <Teleport to="body">
        <div v-if="slotCtx" class="slot-ctx-scrim" @mousedown.self="closeSlotCtx">
          <div
            class="slot-ctx-menu"
            :style="{ left: slotCtx.x + 'px', top: slotCtx.y + 'px' }"
            @click.stop
          >
            <button type="button" class="slot-ctx-btn" @click="slotImportClick">导入图片…</button>
            <button
              type="button"
              class="slot-ctx-btn"
              :disabled="!payload.material[slotCtx.key]?.isTexture"
              @click="slotClearClick"
            >
              清除槽位
            </button>
          </div>
        </div>
      </Teleport>
      <div class="slot-grid-wrap" :class="{ 'slot-grid-wrap--busy': slotImportLoading }">
        <div v-if="slotImportLoading" class="slot-import-overlay" aria-live="polite" role="status">
          <span class="slot-import-spinner" aria-hidden="true" />
          <span class="slot-import-overlay-text">正在加载贴图…</span>
        </div>
        <div class="slot-grid slot-grid-compact">
          <div
            v-for="k in MAP_KEYS"
            :key="k"
            class="slot-cell"
            :title="`${k}${!isReadOnlyContext ? ' · 右键导入/清除' : ''}`"
            @contextmenu="onSlotContextMenu($event, k)"
          >
            <div class="slot-name" :title="k">{{ SLOT_SHORT[k] || k }}</div>
            <div v-if="payload.material[k]?.isTexture" class="slot-thumb">
              <TexturePreviewCanvas :texture="payload.material[k]" :size="44" />
            </div>
            <div v-else class="slot-empty">—</div>
          </div>
        </div>
      </div>
      <p v-if="!isReadOnlyContext" class="hint tiny">处理后材质：在槽格上右键可导入或清除贴图（不与磁盘写回联动）。</p>

      <h4 class="sub-title">{{ t('matParamsSectionTitle') }}</h4>
      <template v-if="isReadOnlyContext">
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
      <template v-else-if="isShaderLikeMaterial(payload.material)">
        <p class="hint tiny">{{ t('matShaderNoEdit') }}</p>
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
      <template v-else>
        <p class="hint tiny">{{ t('matParamsEditHint') }}</p>
        <div class="param-table-wrap param-table-wrap-tall">
          <table class="param-table param-table-edit">
            <tbody>
              <tr v-for="row in materialEditableRows" :key="row.key">
                <td class="p-key">{{ row.key }}</td>
                <td class="p-val-edit">
                  <template v-if="row.kind === 'number'">
                    <input
                      type="number"
                      class="mat-inp-num"
                      :min="row.min"
                      :max="row.max"
                      :step="row.step"
                      :value="row.value"
                      @change="onMatNumberKey(row.key, $event)"
                    />
                  </template>
                  <template v-else-if="row.kind === 'bool'">
                    <label class="check-inline">
                      <input type="checkbox" :checked="row.value" @change="onMatBoolKey(row.key, $event)" />
                    </label>
                  </template>
                  <template v-else-if="row.kind === 'color'">
                    <input
                      type="color"
                      class="mat-inp-color"
                      :value="row.value"
                      @input="onMatColorKey(row.key, $event)"
                    />
                  </template>
                  <template v-else-if="row.kind === 'vec2'">
                    <span class="vec-inline">
                      <input
                        type="number"
                        class="mat-inp-num narrow"
                        :value="row.x"
                        @change="onMatVec2Key(row.key, 'x', $event)"
                      />
                      <input
                        type="number"
                        class="mat-inp-num narrow"
                        :value="row.y"
                        @change="onMatVec2Key(row.key, 'y', $event)"
                      />
                    </span>
                  </template>
                  <template v-else-if="row.kind === 'vec3'">
                    <span class="vec-inline">
                      <input
                        type="number"
                        class="mat-inp-num narrow"
                        :value="row.x"
                        @change="onMatVec3Key(row.key, 'x', $event)"
                      />
                      <input
                        type="number"
                        class="mat-inp-num narrow"
                        :value="row.y"
                        @change="onMatVec3Key(row.key, 'y', $event)"
                      />
                      <input
                        type="number"
                        class="mat-inp-num narrow"
                        :value="row.z"
                        @change="onMatVec3Key(row.key, 'z', $event)"
                      />
                    </span>
                  </template>
                  <template v-else-if="row.kind === 'side'">
                    <select class="mat-edit-sel wide" :value="row.value" @change="onMatSideChange($event)">
                      <option :value="0">{{ t('matSideFront') }}</option>
                      <option :value="1">{{ t('matSideBack') }}</option>
                      <option :value="2">{{ t('matSideDouble') }}</option>
                    </select>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
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

      <h4 class="sub-title">采样状态（GPU 采样器语义）</h4>
      <dl v-if="textureSampling.length" class="kv kv-tight">
        <template v-for="(row, idx) in textureSampling" :key="idx">
          <dt>{{ row.label }}</dt>
          <dd class="mono">{{ row.value }}</dd>
        </template>
      </dl>
      <p v-else class="hint tiny">无法读取采样字段</p>

      <h4 class="sub-title">常见压缩格式 · 文件 / 内存 / 显存（粗估）</h4>
      <p class="hint tiny">立方体贴图已乘 6；「文件」指磁盘或传输载荷，「内存」指解码/暂存，「显存」指 GPU 可采样占用。</p>
      <div v-if="textureCompressTable.length" class="compress-table-wrap">
        <table class="compress-table">
          <thead>
            <tr>
              <th>格式</th>
              <th>文件</th>
              <th>内存</th>
              <th>显存</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, idx) in textureCompressTable" :key="idx">
              <td>{{ row.label }}</td>
              <td class="mono">{{ fmtBytes(row.fileBytes) }}</td>
              <td class="mono">{{ fmtBytes(row.ramBytes) }}</td>
              <td class="mono">{{ fmtBytes(row.vramBytes) }}</td>
              <td class="compress-note">{{ row.note }}</td>
            </tr>
          </tbody>
        </table>
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
        <dd class="mono uuid-line">{{ payload.texture.uuid }}</dd>
        <dt>哈希值</dt>
        <dd
          class="mono content-hash-dd"
          title="像素/块数据与采样等属性；不含贴图名称与 UUID"
        >
          {{ selectionContentHash }}
        </dd>
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
        <dt>UUID</dt>
        <dd class="mono uuid-line">{{ payload.clip.uuid || '—' }}</dd>
        <dt>哈希值</dt>
        <dd
          class="mono content-hash-dd"
          title="时长、混合模式与轨道关键帧数据；不含片段名、轨道名与 UUID"
        >
          {{ selectionContentHash }}
        </dd>
        <dt>时长 (s)</dt>
        <dd>{{ fmt(payload.clip.duration) }}</dd>
        <dt>轨道数</dt>
        <dd>{{ payload.clip.tracks?.length ?? 0 }}</dd>
      </dl>
    </template>
  </div>
</template>

<style scoped>
.selection-context-bar {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 10px;
  padding: 8px 10px;
  border-radius: 6px;
  border-width: 2px;
  border-style: solid;
  font-size: 11px;
  line-height: 1.45;
}
.selection-context-bar--readonly {
  background: rgba(90, 35, 35, 0.35);
  border-color: #c45c5c;
  color: #ffd6d6;
}
.selection-context-bar--editable {
  background: rgba(35, 80, 55, 0.38);
  border-color: #4caf7a;
  color: #d8f5e4;
}
.ctx-badge {
  flex: 0 0 auto;
  font-weight: 800;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 3px 7px;
  border-radius: 4px;
}
.selection-context-bar--readonly .ctx-badge {
  background: #8b2e2e;
  color: #fff;
}
.selection-context-bar--editable .ctx-badge {
  background: #2e6b45;
  color: #fff;
}
.ctx-text {
  flex: 1 1 auto;
  min-width: 0;
}
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
.mesh-uv-launch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin: 10px 0 6px;
}
.mesh-uv-launch .hint {
  flex: 1 1 180px;
  margin: 0;
}
.mini-btn--primary {
  border-color: #4a8ab8;
  background: linear-gradient(180deg, #2e4a62, #243545);
}
.mini-btn--primary:hover {
  border-color: #7ec8ff;
}

.mesh-attr-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}
.mesh-attr-actions .hint {
  flex: 1 1 100%;
  margin: 0;
}
.slot-grid-wrap {
  position: relative;
  margin-bottom: 8px;
}
.slot-grid-wrap .slot-grid-compact {
  margin-bottom: 0;
}
.slot-grid-wrap--busy .slot-grid {
  pointer-events: none;
  opacity: 0.45;
  filter: grayscale(0.35);
}
.slot-import-overlay {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(12, 14, 18, 0.72);
  border-radius: 6px;
  border: 1px solid rgba(125, 212, 168, 0.35);
}
.slot-import-overlay-text {
  font-size: 11px;
  color: #7dd4a8;
  font-weight: 600;
}
.slot-import-spinner {
  width: 22px;
  height: 22px;
  border: 2px solid rgba(125, 212, 168, 0.25);
  border-top-color: #7dd4a8;
  border-radius: 50%;
  animation: slot-spin 0.7s linear infinite;
}
@keyframes slot-spin {
  to {
    transform: rotate(360deg);
  }
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
.hidden-slot-file {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.slot-ctx-scrim {
  position: fixed;
  inset: 0;
  z-index: 500;
  background: transparent;
}
.slot-ctx-menu {
  position: fixed;
  z-index: 501;
  min-width: 140px;
  padding: 4px 0;
  background: #252a32;
  border: 1px solid #4a5568;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.slot-ctx-btn {
  display: block;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: #e6ebf3;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.slot-ctx-btn:hover:not(:disabled) {
  background: #3a4558;
}
.slot-ctx-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.slot-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}
.slot-grid-compact {
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  margin-bottom: 8px;
}
.slot-cell {
  border: 1px solid #3a4558;
  border-radius: 4px;
  padding: 6px;
  background: #1a1d24;
}
.slot-grid-compact .slot-cell {
  padding: 3px 4px;
  border-radius: 3px;
}
.slot-name {
  font-size: 9px;
  color: #8aa4c8;
  margin-bottom: 4px;
  word-break: break-all;
}
.slot-grid-compact .slot-name {
  font-size: 8px;
  margin-bottom: 2px;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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
.slot-grid-compact .slot-empty {
  font-size: 9px;
  padding: 10px 0;
}
.param-table-wrap {
  max-height: 220px;
  overflow: auto;
  border: 1px solid #3a4558;
  border-radius: 4px;
}
.param-table-wrap-tall {
  max-height: min(420px, 55vh);
}
.mat-edit-sel,
.mat-edit-txt {
  width: 100%;
  max-width: 100%;
  box-sizing: border-box;
  padding: 4px 6px;
  font-size: 11px;
  border: 1px solid #4a5160;
  border-radius: 3px;
  background: #1b2029;
  color: #e6ebf3;
}
.mat-edit-sel.wide {
  min-width: 160px;
}
.mat-edit-sel--block {
  width: 100%;
  max-width: 100%;
}
.kv-tight dt {
  flex: 0 0 80px;
}
.mesh-mat-slots {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 8px 0 12px;
}
.mesh-mat-slot {
  border: 1px solid #3a4558;
  border-radius: 6px;
  padding: 8px 10px;
  background: #1a1d24;
}
.mesh-mat-slot-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.mesh-mat-slot-label {
  font-size: 11px;
  color: #9fb3d6;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.mesh-mat-outline-btn {
  flex: 0 0 auto;
}
.mesh-mat-quick {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #2f3540;
}
.mesh-mat-quick-title {
  display: block;
  font-size: 10px;
  color: #8aa4c8;
  margin-bottom: 6px;
}
.mesh-mat-quick-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
}
.mesh-mat-quick-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.mesh-mat-quick-key {
  font-size: 9px;
  color: #6b7a90;
  font-family: ui-monospace, system-ui, monospace;
}
.mesh-mat-quick-inp {
  max-width: 110px;
}
.mat-inp-num {
  width: 100%;
  max-width: 140px;
  padding: 3px 5px;
  font-size: 10px;
  border: 1px solid #4a5160;
  border-radius: 3px;
  background: #1b2029;
  color: #e6ebf3;
}
.mat-inp-num.narrow {
  max-width: 72px;
  margin-right: 4px;
}
.mat-inp-color {
  width: 36px;
  height: 24px;
  padding: 0;
  border: 1px solid #4a5160;
  border-radius: 3px;
  vertical-align: middle;
  cursor: pointer;
}
.p-val-edit {
  color: #d0d8e6;
  vertical-align: middle;
}
.vec-inline {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px 4px;
  align-items: center;
}
.check-inline {
  display: inline-flex;
  align-items: center;
}
.param-table-edit .p-key {
  width: 38%;
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
.mat-rot-toggle {
  margin-bottom: 8px;
  font-size: 11px;
  color: #aeb6c4;
}
.kv-tight {
  margin-bottom: 12px;
  font-size: 10px;
}
.compress-table-wrap,
.compress-est-table {
  margin-bottom: 12px;
}
.compress-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 9px;
}
.compress-table th,
.compress-table td {
  padding: 4px 6px;
  border-bottom: 1px solid #2e3440;
  text-align: left;
  vertical-align: top;
}
.compress-table th {
  background: #2a3038;
  color: #9aa3b0;
}
.compress-note {
  color: #7a8494;
  line-height: 1.35;
}
.uuid-line {
  word-break: break-all;
  color: #d0d8e6;
}
.content-hash-dd {
  font-size: one;
  line-height: 1.35;
  word-break: break-all;
  color: #9fdfb8;
  font-variant-numeric: tabular-nums;
}
.compress-est-table .compress-note {
  font-size: 9px;
}
</style>
