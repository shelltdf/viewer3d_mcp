<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import DualViewport from './DualViewport.vue'
import SceneOutliner from './SceneOutliner.vue'
import PropertyInspector from './PropertyInspector.vue'
import PreviewLightbox from './PreviewLightbox.vue'
import MemoryEstimateModal from './MemoryEstimateModal.vue'
import DuplicateResourceModal from './DuplicateResourceModal.vue'
import UvEditorWindow from './UvEditorWindow.vue'
import { useLocalWorkspace } from '../composables/useLocalWorkspace.js'
import { useActivityLog } from '../composables/useActivityLog.js'

const dualRef = ref(null)
const fileInputRef = ref(null)

const linkCamerasLinked = computed({
  get: () => dualRef.value?.linkCameras?.value ?? true,
  set: (v) => {
    const lc = dualRef.value?.linkCameras
    if (lc) lc.value = v
  },
})

const urlInput = ref('')
const statusText = ref('就绪')
const statusKind = ref('idle')

const sourceOutline = ref([])
const resultOutline = ref([])
const expandedSource = ref(new Set())
const expandedResult = ref(new Set())

const focusPanel = ref('source')
const selectedSourceUuid = ref(null)
const selectedResultUuid = ref(null)

/** 独立小弹窗：proc-* / bake-* / tool-* */
const activeDialog = ref('')
const showWorkspaceModal = ref(false)
const showLogModal = ref(false)
const showMemoryModal = ref(false)
const memoryPanel = ref('source')
const showDuplicateModal = ref(false)
const uvWindowOpen = ref(false)
/** @type {import('vue').Ref<import('three').Mesh | import('three').SkinnedMesh | null>} */
const uvWindowMesh = ref(null)
const uvWindowLabel = ref('')
const uvWindowReadOnly = ref(true)
/** 递增以使重复资源弹窗在合并后重新拉取分析（Three 场景非响应式，避免 computed 缓存陈旧数据） */
const dupSceneRevision = ref(0)
/** 执行「重复资源合并」后的结果摘要弹窗 */
const showMergeResultDialog = ref(false)
const mergeResultLines = ref([])
/** 双视口：可单独或同时显示「处理前 / 处理后」格子（至少保留一侧） */
const showViewportSource = ref(true)
const showViewportResult = ref(true)
/** 仅放大中央 3D 区域（隐藏左右 Dock）；双视口时左右等分 */
const viewportMaximized = ref(false)
const memStats = ref({
  js: null,
  gpuEst: 0,
  gpuPeakEst: 0,
  textures: 0,
  source: null,
  result: null,
})

const lightboxOpen = ref(false)
const lightboxKind = ref('')
const lightboxTexture = ref(null)
const lightboxMaterial = ref(null)
const lightboxChannel = ref('rgba')

const DIALOG_TITLES = {
  'proc-mesh': '网格简化',
  'proc-skeleton': '骨骼 / 权重简化',
  'proc-atlas': '材质贴图合并',
  'proc-pbr': '单贴图 → PBR',
  'bake-light': '灯光烘焙',
  'bake-tex': '烘焙到贴图',
  'bake-vertex': '烘焙到顶点属性',
  'tool-tiles': '切割瓦片',
  'tool-mesh2pc': 'Mesh → 点云',
  'tool-pc': '点云处理',
  'tool-pc2mesh': '点云 → Mesh',
  'tool-gaussian': 'Mesh → 高斯泼溅',
}

const dialogTitle = computed(() => DIALOG_TITLES[activeDialog.value] || '')

const { lines: logLines, push: logPush, formatAll: formatLogAll } = useActivityLog()

const {
  workspaceLabel,
  dirHandle,
  entries: workspaceEntries,
  lastError: workspaceError,
  listMaxDepth,
  pickFolder,
  refreshListing,
  setManualLabel,
  clearHandle,
} = useLocalWorkspace()

const workspaceTitle = computed(() =>
  dirHandle.value ? workspaceLabel.value || '（已选文件夹）' : '无工作目录',
)

watch(
  workspaceTitle,
  (t) => {
    document.title = `模型处理工作台 — ${t}`
  },
  { immediate: true },
)

watch([showViewportSource, showViewportResult], ([s, r]) => {
  if (!s && !r) showViewportResult.value = true
})

const inspectorPayload = computed(() => {
  const panel = focusPanel.value
  const id = panel === 'source' ? selectedSourceUuid.value : selectedResultUuid.value
  if (!id || !dualRef.value) return { kind: 'empty' }
  const items = panel === 'source' ? sourceOutline.value : resultOutline.value
  const item = items.find((i) => i.uuid === id)
  if (!item) return { kind: 'empty' }
  return dualRef.value.resolveOutlineItem(panel, item) || { kind: 'empty' }
})

const meshTargetRatio = ref(0.5)
const meshPreserveBorder = ref(true)
const maxBones = ref(64)
const maxInfluences = ref(4)
const mergeTextures = ref(true)
const pbrFromSingle = ref(true)

const bakeMode = ref('texture')
const bakeResolution = ref(2048)
const lightBakeSamples = ref(64)
const vertexBakeChannels = ref('color')

const tileSize = ref(4)
const tileOverlap = ref(0.05)

const pcDensity = ref('medium')
const pcNoiseRemove = ref(true)
const meshFromPcMethod = ref('poisson')

const gaussianMode = ref('colmap-style')

const dockCollapsed = ref(false)

const logTextDisplay = computed(() =>
  logLines.value
    .map((l) => {
      const d = new Date(l.t)
      const ts = d.toLocaleTimeString('zh-CN', { hour12: false })
      return `[${ts}] [${l.kind}] ${l.text}`
    })
    .join('\n'),
)

function setStatus(text, kind = 'idle') {
  statusText.value = text
  statusKind.value = kind
  logPush(text, kind)
}

onMounted(() => {
  logPush('就绪', 'idle')
})

function openLogModal() {
  showLogModal.value = true
}

async function copyLogText() {
  try {
    await navigator.clipboard.writeText(logTextDisplay.value || formatLogAll())
    setStatus('日志已复制到剪贴板', 'ok')
  } catch {
    setStatus('复制失败（权限或浏览器限制）', 'error')
  }
}

function onPreviewLightbox(payload) {
  lightboxKind.value = payload.kind
  lightboxTexture.value = payload.texture || null
  lightboxMaterial.value = payload.material || null
  lightboxChannel.value = payload.channel || 'rgba'
  lightboxOpen.value = true
}

function onInspectorAction(e) {
  if (e?.type === 'texture-compress') {
    setStatus('压缩贴图：占位（需接入压缩管线或后端）', 'ok')
  } else if (e?.type === 'texture-decompress') {
    setStatus('解压贴图：占位（需接入解压管线）', 'ok')
  } else if (e?.type === 'vertex-attrs-changed') {
    dualRef.value?.refreshVertexAttrNameLists?.()
    dualRef.value?.afterResultGeometryMutation?.()
    setStatus('已更新网格顶点属性（下拉列表已刷新）', 'ok')
  } else if (e?.type === 'inspector-status') {
    const msg = e.message || ''
    setStatus(msg, e.level === 'error' ? 'error' : 'ok')
  } else if (e?.type === 'open-uv-window') {
    uvWindowMesh.value = e.object || null
    uvWindowLabel.value = e.label || e.object?.name || e.object?.uuid || 'Mesh'
    uvWindowReadOnly.value = e.panel === 'source'
    uvWindowOpen.value = true
  }
}

function onUvWindowEdited() {
  dualRef.value?.refreshVertexAttrNameLists?.()
  setStatus('UV 已更新（视窗编辑）', 'ok')
}

function closeLightbox() {
  lightboxOpen.value = false
}

function getMemoryEst(panel) {
  return dualRef.value?.getMemoryEstimate?.(panel) ?? null
}

function getDupAnalysis(panel) {
  return dualRef.value?.getDuplicateAnalysis?.(panel) ?? null
}

function getDupResourceGraph(panel) {
  return dualRef.value?.getResourceGraph?.(panel) ?? { nodes: [], edges: [], stats: {} }
}

function onDuplicateMerge(payload) {
  const summary = dualRef.value?.applyDuplicateMerges?.(payload) ?? {}
  dupSceneRevision.value += 1

  const lines = []
  if (summary.textureMerged)
    lines.push(`贴图：已合并 / 省去 ${summary.textureMerged} 份 Texture 实例`)
  if (summary.materialMerged)
    lines.push(`材质：已合并 / 省去 ${summary.materialMerged} 份 Material 实例`)
  if (summary.nodesRemoved) lines.push(`场景节点：已移除 ${summary.nodesRemoved} 个重复节点（含其子树）`)
  if (!lines.length)
    lines.push('未产生可计数的合并（可能未勾选分组，或所选组无重复项）；可继续在重复资源窗口中查看。')

  mergeResultLines.value = lines
  showMergeResultDialog.value = true

  setStatus('重复资源合并已完成，详见结果对话框。', 'ok')
}

function closeMergeResultDialog() {
  showMergeResultDialog.value = false
}

function onOutlineUpdated(payload) {
  if (payload.panel === 'source') {
    sourceOutline.value = payload.outline || []
    if (!sourceOutline.value.length) selectedSourceUuid.value = null
  } else {
    resultOutline.value = payload.outline || []
    if (!resultOutline.value.length) selectedResultUuid.value = null
  }
}

function onMemoryStats(s) {
  memStats.value = s
}

function fmtMemBar(n) {
  if (n == null || Number.isNaN(n)) return '—'
  if (n < 1024) return `${Math.round(n)} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function onViewerError(msg) {
  setStatus(msg || '错误', 'error')
}

function onDualStatus(msg) {
  setStatus(msg, 'ok')
}

function onSourceLoaded(payload) {
  sourceOutline.value = payload?.outline || []
  expandedSource.value = new Set(sourceOutline.value.filter((i) => i.hasChildren).map((i) => i.uuid))
  resultOutline.value = []
  expandedResult.value = new Set()
  selectedSourceUuid.value = null
  selectedResultUuid.value = null
  focusPanel.value = 'source'
  setStatus(
    `已加载源模型 · 动画片段：${payload?.animations ?? 0}；已自动深度克隆至「处理后」（右侧为可编辑副本）`,
    'ok',
  )
}

function onResultUpdated(payload) {
  resultOutline.value = payload?.outline || []
  expandedResult.value = new Set(resultOutline.value.filter((i) => i.hasChildren).map((i) => i.uuid))
}

function onSelectSource(uuid) {
  focusPanel.value = 'source'
  selectedSourceUuid.value = uuid
}

function onSelectResult(uuid) {
  focusPanel.value = 'result'
  selectedResultUuid.value = uuid
}

function toggleSourceExpand(uuid) {
  const s = new Set(expandedSource.value)
  if (s.has(uuid)) s.delete(uuid)
  else s.add(uuid)
  expandedSource.value = s
}

function toggleResultExpand(uuid) {
  const s = new Set(expandedResult.value)
  if (s.has(uuid)) s.delete(uuid)
  else s.add(uuid)
  expandedResult.value = s
}

function openFiles() {
  fileInputRef.value?.click()
}

async function loadFromUrl() {
  const u = urlInput.value.trim()
  if (!u) {
    setStatus('请输入模型 URL', 'error')
    return
  }
  setStatus('正在加载 URL…', 'loading')
  try {
    await dualRef.value?.loadUrl(u)
  } catch {
    /* error emitted */
  }
}

async function onPickFile(e) {
  const selected = Array.from(e.target.files || [])
  e.target.value = ''
  if (!selected.length) return
  setStatus('正在加载本地模型…', 'loading')
  try {
    await dualRef.value?.loadFiles(selected)
  } catch {
    /* error emitted */
  }
}

function runPlaceholder(name) {
  setStatus(`「${name}」管线占位：后续可接入 WASM / 原生后端 / MCP`, 'ok')
}

async function pickWorkspace() {
  try {
    await pickFolder()
    setStatus(`工作目录：${workspaceLabel.value}`, 'ok')
  } catch (e) {
    setStatus(e?.message || String(e), 'error')
  }
}

function clearWorkspace() {
  clearHandle()
  setStatus('已清除本地工作目录句柄', 'ok')
}

function openWorkspaceMenu() {
  showWorkspaceModal.value = true
}
</script>

<template>
  <div class="workbench">
    <nav class="menubar">
      <div class="menu-root">
        <button class="menu-btn" type="button">文件</button>
        <div class="menu-pop">
          <button class="menu-item" type="button" @click="openFiles">打开模型…</button>
          <button class="menu-item" type="button" @click="loadFromUrl">从 URL 加载</button>
          <div class="menu-sep" />
          <button class="menu-item" type="button" @click="runPlaceholder('导出 glTF')">导出 glTF…</button>
        </div>
      </div>
      <div class="menu-root">
        <button class="menu-btn menu-top" type="button">处理</button>
        <div class="menu-pop menu-pop-wide">
          <button class="menu-item" type="button" @click="activeDialog = 'proc-mesh'">网格简化…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'proc-skeleton'">骨骼 / 权重简化…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'proc-atlas'">材质贴图合并…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'proc-pbr'">单贴图 → PBR…</button>
          <div class="menu-sep" />
          <button class="menu-item" type="button" @click="showDuplicateModal = true">重复资源共享…</button>
        </div>
      </div>
      <div class="menu-root">
        <button class="menu-btn menu-top" type="button">烘焙</button>
        <div class="menu-pop menu-pop-wide">
          <button class="menu-item" type="button" @click="activeDialog = 'bake-light'">灯光烘焙…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'bake-tex'">烘焙到贴图…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'bake-vertex'">烘焙到顶点…</button>
        </div>
      </div>
      <div class="menu-root">
        <button class="menu-btn menu-top" type="button">工具</button>
        <div class="menu-pop menu-pop-wide">
          <button class="menu-item" type="button" @click="activeDialog = 'tool-tiles'">切割瓦片…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'tool-mesh2pc'">Mesh → 点云…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'tool-pc'">点云处理…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'tool-pc2mesh'">点云 → Mesh…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'tool-gaussian'">Mesh → 高斯泼溅…</button>
        </div>
      </div>
      <button class="menu-btn menu-top" type="button" @click="openWorkspaceMenu">本地工作目录</button>
      <button class="menu-btn menu-top" type="button" @click="showMemoryModal = true">内存预览</button>
      <div class="menu-root">
        <button class="menu-btn" type="button">帮助</button>
        <div class="menu-pop">
          <span class="menu-hint">Vue + three.js 模型工作台壳层；算法管线可后续接入。</span>
        </div>
      </div>
    </nav>

    <div class="title-bar">
      <span class="title-app">模型处理工作台</span>
      <span class="title-sep">·</span>
      <span class="title-workspace" :title="workspaceTitle">{{ workspaceTitle }}</span>
    </div>

    <div class="toolbar">
      <button type="button" class="tool-btn primary" @click="openFiles">打开</button>
      <button type="button" class="tool-btn" @click="dualRef?.resetCameras?.()">重置相机</button>
      <button
        type="button"
        class="tool-btn"
        :class="{ 'tool-btn-active': viewportMaximized }"
        :title="viewportMaximized ? '恢复左右栏布局' : '仅最大化中央 3D（单侧铺满 / 双视口左右等分）'"
        @click="viewportMaximized = !viewportMaximized"
      >
        3D 最大化
      </button>
      <label class="toolbar-cb toolbar-cb-wide" title="两侧视口相机目标与朝向同步">
        <input v-model="linkCamerasLinked" type="checkbox" />
        联动观察
      </label>
      <div class="toolbar-vp" title="控制中央双视口是否显示；大纲仍可分别浏览两侧">
        <label class="toolbar-cb"
          ><input v-model="showViewportSource" type="checkbox" /> 显示处理前</label
        >
        <label class="toolbar-cb"
          ><input v-model="showViewportResult" type="checkbox" /> 显示处理后</label
        >
      </div>
      <span class="toolbar-gap" />
      <label class="inline">
        <span class="lbl">URL</span>
        <input v-model="urlInput" class="url-field" type="text" placeholder=".gltf / .glb / .obj" @keydown.enter="loadFromUrl" />
      </label>
      <button type="button" class="tool-btn" @click="loadFromUrl">加载</button>
      <input
        ref="fileInputRef"
        class="hidden"
        type="file"
        multiple
        accept=".gltf,.glb,.bin,.obj,.mtl,.dds,.ktx,.ktx2,image/*"
        @change="onPickFile"
      />
    </div>

    <div class="main-row" :class="{ 'viewport-max-mode': viewportMaximized }">
      <aside class="left-dock">
        <SceneOutliner
          title="大纲 · 处理前"
          :items="sourceOutline"
          :expanded-uuids="expandedSource"
          :selected-uuid="selectedSourceUuid"
          @toggle-expand="toggleSourceExpand"
          @select="onSelectSource"
        />
        <SceneOutliner
          title="大纲 · 处理后"
          :items="resultOutline"
          :expanded-uuids="expandedResult"
          :selected-uuid="selectedResultUuid"
          @toggle-expand="toggleResultExpand"
          @select="onSelectResult"
        />
      </aside>

      <main class="center">
        <DualViewport
          ref="dualRef"
          :show-source="showViewportSource"
          :show-result="showViewportResult"
          :viewport-maximized="viewportMaximized"
          @viewer-error="onViewerError"
          @status="onDualStatus"
          @source-loaded="onSourceLoaded"
          @result-updated="onResultUpdated"
          @outline-updated="onOutlineUpdated"
          @memory-stats="onMemoryStats"
        />
      </main>

      <aside class="right-dock" :class="{ collapsed: dockCollapsed }">
        <div class="dock-head">
          <span>属性</span>
          <button type="button" class="dock-toggle" :title="dockCollapsed ? '展开' : '折叠'" @click="dockCollapsed = !dockCollapsed">
            {{ dockCollapsed ? '⟨' : '⟩' }}
          </button>
        </div>
        <div v-show="!dockCollapsed" class="dock-body">
          <PropertyInspector
            :payload="inspectorPayload"
            :selection-panel="focusPanel"
            @open-lightbox="onPreviewLightbox"
            @action="onInspectorAction"
          />
        </div>
      </aside>
    </div>

    <!-- 处理 / 烘焙 / 工具：每项独立弹窗 -->
    <div v-if="activeDialog" class="modal-backdrop" @click.self="activeDialog = ''">
      <div class="modal-panel" role="dialog" :aria-labelledby="'dlg-' + activeDialog">
        <header class="modal-head">
          <h2 :id="'dlg-' + activeDialog">{{ dialogTitle }}</h2>
          <button type="button" class="modal-close" @click="activeDialog = ''">×</button>
        </header>
        <div class="modal-body">
          <template v-if="activeDialog === 'proc-mesh'">
            <p class="modal-hint">网格简化参数（占位，可接入 WASM / 后端）。</p>
            <label class="field">
              <span>目标三角面比例</span>
              <input v-model.number="meshTargetRatio" type="range" min="0.05" max="1" step="0.05" />
              <span class="mono">{{ meshTargetRatio.toFixed(2) }}</span>
            </label>
            <label class="check"><input v-model="meshPreserveBorder" type="checkbox" /> 保护边界</label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('网格简化'); activeDialog = ''">运行网格简化</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'proc-skeleton'">
            <p class="modal-hint">骨骼与权重简化（占位）。</p>
            <label class="field">
              <span>最大骨骼数</span>
              <input v-model.number="maxBones" class="num" type="number" min="1" max="512" />
            </label>
            <label class="field">
              <span>每顶点最大影响数</span>
              <input v-model.number="maxInfluences" class="num" type="number" min="1" max="8" />
            </label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('骨骼简化'); activeDialog = ''">运行骨骼 / 权重简化</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'proc-atlas'">
            <p class="modal-hint">合并材质贴图为 Atlas（占位）。</p>
            <label class="check"><input v-model="mergeTextures" type="checkbox" /> 合并材质贴图（Atlas）</label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('贴图合并'); activeDialog = ''">运行合并</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'proc-pbr'">
            <p class="modal-hint">由单张贴图推测 PBR 通道（占位）。</p>
            <label class="check"><input v-model="pbrFromSingle" type="checkbox" /> 单张贴图推测 PBR</label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('PBR 生成'); activeDialog = ''">运行 PBR 生成</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'bake-light'">
            <p class="modal-hint">灯光烘焙（占位）。</p>
            <label class="field">
              <span>贴图分辨率</span>
              <input v-model.number="bakeResolution" class="num" type="number" step="256" min="256" max="8192" />
            </label>
            <label class="field">
              <span>灯光采样</span>
              <input v-model.number="lightBakeSamples" class="num" type="number" min="1" max="4096" />
            </label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('灯光烘焙'); activeDialog = ''">开始灯光烘焙</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'bake-tex'">
            <p class="modal-hint">烘焙到贴图（占位）。</p>
            <label class="field">
              <span>贴图分辨率</span>
              <input v-model.number="bakeResolution" class="num" type="number" step="256" min="256" max="8192" />
            </label>
            <label class="field">
              <span>灯光采样</span>
              <input v-model.number="lightBakeSamples" class="num" type="number" min="1" max="4096" />
            </label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('烘焙到贴图'); activeDialog = ''">烘焙到贴图</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'bake-vertex'">
            <p class="modal-hint">烘焙到顶点属性（占位）。</p>
            <label class="field">
              <span>顶点通道</span>
              <input v-model="vertexBakeChannels" class="txt" type="text" placeholder="color, ao, …" />
            </label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('烘焙到顶点'); activeDialog = ''">烘焙到顶点</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'tool-tiles'">
            <p class="modal-hint">切割瓦片（占位）。</p>
            <label class="field">
              <span>瓦片尺寸</span>
              <input v-model.number="tileSize" class="num" type="number" min="0.1" step="0.1" />
            </label>
            <label class="field">
              <span>瓦片重叠</span>
              <input v-model.number="tileOverlap" class="num" type="number" min="0" step="0.01" />
            </label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('切割瓦片'); activeDialog = ''">运行切割</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'tool-mesh2pc'">
            <p class="modal-hint">Mesh → 点云（占位）。</p>
            <label class="field">
              <span>点云密度</span>
              <select v-model="pcDensity" class="sel">
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </label>
            <label class="check"><input v-model="pcNoiseRemove" type="checkbox" /> 点云去噪</label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('Mesh → 点云'); activeDialog = ''">转换</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'tool-pc'">
            <p class="modal-hint">点云处理（占位）。</p>
            <label class="field">
              <span>点云密度</span>
              <select v-model="pcDensity" class="sel">
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </label>
            <label class="check"><input v-model="pcNoiseRemove" type="checkbox" /> 点云去噪</label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('点云处理'); activeDialog = ''">处理</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'tool-pc2mesh'">
            <p class="modal-hint">点云 → Mesh（占位）。</p>
            <label class="field">
              <span>重建方法</span>
              <select v-model="meshFromPcMethod" class="sel">
                <option value="poisson">Poisson</option>
                <option value="ball_pivot">Ball pivot</option>
                <option value="alpha_shape">Alpha shape</option>
              </select>
            </label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('点云 → Mesh'); activeDialog = ''">重建</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'tool-gaussian'">
            <p class="modal-hint">Mesh → 高斯泼溅（占位）。</p>
            <label class="field">
              <span>模式</span>
              <select v-model="gaussianMode" class="sel">
                <option value="colmap-style">COLMAP 风格（占位）</option>
                <option value="instant-ngp">Instant-NGP 风格（占位）</option>
              </select>
            </label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('高斯泼溅'); activeDialog = ''">转换</button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 本地工作目录 -->
    <div v-if="showWorkspaceModal" class="modal-backdrop" @click.self="showWorkspaceModal = false">
      <div class="modal-panel modal-wide" role="dialog" aria-labelledby="dlg-ws-title">
        <header class="modal-head">
          <h2 id="dlg-ws-title">本地工作目录</h2>
          <button type="button" class="modal-close" @click="showWorkspaceModal = false">×</button>
        </header>
        <div class="modal-body">
          <p class="hint">Chrome / Edge 可选文件夹授权；纯浏览器无法访问任意磁盘路径。</p>
          <label class="field">
            <span>标签 / 备注</span>
            <input
              :value="workspaceLabel"
              class="txt"
              type="text"
              placeholder="手动填写工作区说明"
              @input="setManualLabel($event.target.value)"
            />
          </label>
          <label class="field">
            <span>递归深度</span>
            <input v-model.number="listMaxDepth" class="num" type="number" min="1" max="8" @change="refreshListing" />
          </label>
          <div class="btn-row">
            <button type="button" class="tool-btn" @click="pickWorkspace">选择文件夹…</button>
            <button type="button" class="tool-btn" @click="refreshListing">刷新列表</button>
            <button type="button" class="tool-btn" @click="clearWorkspace">清除</button>
          </div>
          <div v-if="workspaceError" class="err">{{ workspaceError }}</div>
          <ul class="file-mini">
            <li
              v-for="ent in workspaceEntries"
              :key="ent.path"
              class="file-line"
              :style="{ paddingLeft: 6 + ent.depth * 10 + 'px' }"
            >
              <span class="tag">{{ ent.kind === 'directory' ? 'DIR' : 'FILE' }}</span>
              <span class="path-text">{{ ent.path }}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>

    <PreviewLightbox
      :open="lightboxOpen"
      :kind="lightboxKind"
      :texture="lightboxTexture"
      :material="lightboxMaterial"
      :channel="lightboxChannel"
      @close="closeLightbox"
    />

    <UvEditorWindow
      v-model:open="uvWindowOpen"
      :mesh-object="uvWindowMesh"
      :mesh-label="uvWindowLabel"
      :read-only="uvWindowReadOnly"
      @edited="onUvWindowEdited"
    />

    <MemoryEstimateModal
      :open="showMemoryModal"
      :panel="memoryPanel"
      :get-estimate="getMemoryEst"
      @close="showMemoryModal = false"
      @update:panel="memoryPanel = $event"
    />

    <DuplicateResourceModal
      :open="showDuplicateModal"
      :scene-revision="dupSceneRevision"
      :get-analysis="getDupAnalysis"
      :get-resource-graph="getDupResourceGraph"
      @close="showDuplicateModal = false"
      @merge="onDuplicateMerge"
    />

    <div
      v-if="showMergeResultDialog"
      class="modal-backdrop merge-result-backdrop"
      @click.self="closeMergeResultDialog"
    >
      <div class="modal-panel merge-result-panel" role="alertdialog" aria-labelledby="merge-result-title" aria-modal="true">
        <header class="modal-head merge-result-head">
          <h2 id="merge-result-title">合并结果</h2>
          <button type="button" class="modal-close" aria-label="关闭" @click="closeMergeResultDialog">×</button>
        </header>
        <div class="modal-body merge-result-body">
          <p class="merge-result-lead">
            已写入<strong>处理后</strong>场景；<strong>处理前</strong>仍为只读对照，未修改。重复资源窗口保持打开，列表已刷新。
          </p>
          <ul class="merge-result-list">
            <li v-for="(line, idx) in mergeResultLines" :key="idx">{{ line }}</li>
          </ul>
        </div>
        <div class="merge-result-actions">
          <button type="button" class="tool-btn accent" @click="closeMergeResultDialog">确定</button>
        </div>
      </div>
    </div>

    <div v-if="showLogModal" class="modal-backdrop" @click.self="showLogModal = false">
      <div class="modal-panel log-modal" role="dialog">
        <header class="modal-head">
          <h2>日志</h2>
          <button type="button" class="modal-close" @click="showLogModal = false">×</button>
        </header>
        <div class="modal-body log-body">
          <pre class="log-pre">{{ logTextDisplay }}</pre>
        </div>
        <div class="log-actions">
          <button type="button" class="tool-btn" @click="copyLogText">复制文本</button>
        </div>
      </div>
    </div>

    <footer
      class="statusbar"
      :class="`st-${statusKind}`"
      title="双击打开日志查看完整记录；单行超长已省略"
      @dblclick="openLogModal"
    >
      <span class="status-msg" :title="statusText">{{ statusText }}</span>
      <div
        class="status-right"
        title="各视口格内左上角为左右独立「存储估」；此处为进程级 JS/GPU 粗估。双击状态栏打开日志。"
      >
        <span class="status-js-line">
          <template v-if="memStats.js">
            JS {{ fmtMemBar(memStats.js.used) }} / {{ fmtMemBar(memStats.js.limit) }}
          </template>
          <template v-else>JS —</template>
          · 合计 GPU 估 {{ fmtMemBar(memStats.gpuEst) }} · 峰值 {{ fmtMemBar(memStats.gpuPeakEst) }} · WebGL 纹理对象
          {{ memStats.textures }}
        </span>
      </div>
    </footer>
  </div>
</template>

<style scoped>
.workbench {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100vh;
  background: #0f1115;
  color: #e8eaed;
}
.menubar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  background: linear-gradient(#3a3a3a, #2f2f2f);
  border-bottom: 1px solid #222;
}
.menu-top {
  margin-right: 2px;
}
.title-bar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  font-size: 12px;
  background: linear-gradient(#2e3238, #262a30);
  border-bottom: 1px solid #1a1d22;
  color: #aeb6c4;
}
.title-app {
  font-weight: 600;
  color: #e2e8f0;
}
.title-sep {
  color: #5c6570;
}
.title-workspace {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #9fdfb8;
  font-family: ui-monospace, system-ui, sans-serif;
  font-size: 11px;
}
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.merge-result-backdrop {
  z-index: 400;
  background: rgba(0, 0, 0, 0.62);
}
.merge-result-body {
  padding-bottom: 8px;
}
.merge-result-lead {
  margin: 0 0 14px;
  font-size: 12px;
  line-height: 1.55;
  color: #c5cdd9;
}
.merge-result-lead strong {
  color: #e8c07e;
}
.merge-result-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  line-height: 1.65;
  color: #e2e8f0;
}
.merge-result-list li {
  margin-bottom: 6px;
}
.merge-result-list li:last-child {
  margin-bottom: 0;
}
.merge-result-actions {
  flex: 0 0 auto;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 14px 14px;
  border-top: 1px solid #3d4654;
}
.modal-panel {
  width: min(480px, 100%);
  max-height: min(90vh, 720px);
  display: flex;
  flex-direction: column;
  background: linear-gradient(#2c3138, #252a32);
  border: 1px solid #4a5568;
  border-radius: 8px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.45);
}
.modal-panel.modal-wide {
  width: min(560px, 100%);
}
.modal-panel.merge-result-panel {
  width: min(460px, 100%);
  border: 2px solid #4a9f7a;
  box-shadow:
    0 24px 64px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(74, 159, 122, 0.4);
}
.modal-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #3d4654;
}
.modal-head h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #d4dce8;
}
.modal-head.merge-result-head h2 {
  font-size: 16px;
  font-weight: 700;
  color: #9fdfb8;
}
.modal-close {
  border: none;
  background: transparent;
  color: #9aa3b0;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
  padding: 0 4px;
}
.modal-close:hover {
  color: #e8eaed;
}
.modal-body {
  flex: 1 1 auto;
  overflow: auto;
  padding: 12px 14px 16px;
}
.modal-hint {
  margin: 0 0 12px;
  font-size: 11px;
  color: #8e97a6;
  line-height: 1.45;
}
.menu-root {
  position: relative;
}
.menu-btn {
  border: 1px solid #3c3c3c;
  background: transparent;
  color: #cfcfcf;
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 3px;
  cursor: pointer;
}
.menu-btn:hover {
  border-color: #616161;
  background: #454545;
}
.menu-root:hover .menu-pop,
.menu-root:focus-within .menu-pop {
  display: block;
}
.menu-pop {
  display: none;
  position: absolute;
  top: 100%;
  left: 0;
  min-width: 200px;
  margin-top: 2px;
  padding: 4px;
  background: linear-gradient(#32353c, #2a2d33);
  border: 1px solid #535353;
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.35);
  z-index: 50;
}
.menu-item {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  background: transparent;
  color: #e2e6ee;
  font-size: 12px;
  padding: 6px 8px;
  border-radius: 3px;
  cursor: pointer;
}
.menu-item:hover {
  background: #3b4452;
  border-color: #5a6a82;
}
.menu-sep {
  height: 1px;
  margin: 4px 0;
  background: #4a5160;
}
.menu-hint {
  display: block;
  padding: 8px;
  font-size: 11px;
  color: #aeb6c4;
  max-width: 260px;
  line-height: 1.4;
}
.menu-pop-wide {
  min-width: 220px;
}
.toolbar {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: linear-gradient(#343434, #2b2b2b);
  border-bottom: 1px solid #1a1c20;
}
.tool-btn {
  border: 1px solid #5b626f;
  border-radius: 4px;
  background: linear-gradient(#4a5362, #3f4856);
  color: #edf2ff;
  font-size: 12px;
  padding: 5px 12px;
  cursor: pointer;
}
.tool-btn:hover {
  border-color: #7696c3;
}
.tool-btn.primary {
  background: linear-gradient(#4a6fa8, #3d5f90);
}
.tool-btn.accent {
  background: linear-gradient(#3d7a5c, #2f6349);
}
.tool-btn-active {
  border-color: #6b9fe0 !important;
  box-shadow: 0 0 0 1px rgba(107, 159, 224, 0.35);
}
.toolbar-gap {
  flex: 1 1 20px;
  min-width: 8px;
}
.toolbar-vp {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px 14px;
  padding: 2px 8px;
  border-left: 1px solid #4a5160;
  border-right: 1px solid #4a5160;
  font-size: 11px;
  color: #c5cdd9;
}
.toolbar-cb {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.toolbar-cb input {
  accent-color: #5a9fd4;
}
.toolbar-cb-wide {
  font-size: 11px;
  color: #c5cdd9;
}
.inline {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #b8c0cc;
}
.lbl {
  flex: 0 0 auto;
}
.url-field {
  width: min(360px, 40vw);
  padding: 5px 8px;
  border: 1px solid #586273;
  border-radius: 3px;
  background: #1b2029;
  color: #e6ebf3;
  font-size: 12px;
}
.hidden {
  display: none;
}
.main-row {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.main-row.viewport-max-mode .left-dock,
.main-row.viewport-max-mode .right-dock {
  display: none;
}
.main-row.viewport-max-mode .center {
  flex: 1 1 auto;
  max-width: 100%;
}
.left-dock {
  width: 260px;
  min-width: 200px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #2a3038;
  background: #1e2229;
}
.center {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 6px;
  min-height: 0;
}
.right-dock {
  width: 300px;
  min-width: 260px;
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  border-left: 1px solid #2a3038;
  background: #252a32;
}
.right-dock.collapsed {
  width: 36px;
  min-width: 36px;
}
.dock-head {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  font-size: 12px;
  color: #c9d0dc;
  background: linear-gradient(#363c46, #2c3138);
  border-bottom: 1px solid #1f242c;
}
.dock-toggle {
  border: 1px solid #555;
  background: #3a404a;
  color: #ddd;
  border-radius: 3px;
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
}
.dock-body {
  flex: 1 1 auto;
  overflow: auto;
  padding: 8px 10px 16px;
  font-size: 12px;
}
.sec {
  margin-bottom: 14px;
  padding-bottom: 10px;
  border-bottom: 1px solid #323842;
}
.sec-title {
  margin: 0 0 8px;
  font-size: 11px;
  font-weight: 600;
  color: #9fb3d6;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
.field {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
  color: #c5cdd9;
}
.field span:first-child {
  flex: 0 0 120px;
  font-size: 11px;
  color: #9aa3b0;
}
.num,
.txt,
.sel {
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid #4a5160;
  border-radius: 3px;
  background: #1b2029;
  color: #e6ebf3;
  font-size: 12px;
}
.check {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
  color: #c5cdd9;
  font-size: 12px;
}
.hint {
  margin: 0 0 8px;
  font-size: 11px;
  color: #8e97a6;
  line-height: 1.45;
}
.btn-row {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.err {
  font-size: 11px;
  color: #f0a8a8;
  margin-bottom: 6px;
}
.file-mini {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 140px;
  overflow: auto;
  font-size: 11px;
  font-family: ui-monospace, monospace;
}
.file-line {
  padding: 2px 0;
  color: #bfc8d8;
  border-bottom: 1px solid #2e3440;
}
.path-text {
  word-break: break-all;
}
.tag {
  display: inline-block;
  min-width: 28px;
  margin-right: 6px;
  font-size: 9px;
  color: #7a8a9e;
}
.mono {
  font-family: ui-monospace, monospace;
  font-size: 11px;
  color: #a8d4ff;
}
.statusbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: nowrap;
  gap: 10px 12px;
  padding: 6px 12px;
  min-height: 32px;
  max-height: 32px;
  box-sizing: border-box;
  font-size: 12px;
  line-height: 1.25;
  border-top: 1px solid #3a3f4a;
  background: linear-gradient(#333842, #2a2f38);
  cursor: pointer;
  overflow: hidden;
}
.status-msg {
  flex: 1 1 0;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.status-right {
  flex: 0 1 auto;
  min-width: 0;
  max-width: min(52vw, 560px);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  justify-content: center;
  overflow: hidden;
}
.status-js-line {
  display: block;
  font-size: 10px;
  line-height: 1.25;
  color: #9aa8bc;
  font-variant-numeric: tabular-nums;
  text-align: right;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.st-loading {
  color: #a8d4ff;
}
.st-ok {
  color: #9fdfb8;
}
.st-error {
  color: #ffb4b4;
}
.st-idle {
  color: #c9d0dc;
}
.log-modal {
  width: min(640px, 94vw);
  max-height: min(80vh, 560px);
  display: flex;
  flex-direction: column;
}
.log-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
.log-pre {
  margin: 0;
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-all;
  font-family: ui-monospace, monospace;
  color: #d0d8e6;
}
.log-actions {
  padding: 8px 14px 12px;
  border-top: 1px solid #3d4654;
}
</style>
