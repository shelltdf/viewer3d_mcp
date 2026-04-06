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
import { useUiLocale } from '../composables/useUiLocale.js'
import { useUiTheme } from '../composables/useUiTheme.js'

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
const showUrlModal = ref(false)
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
/** 每侧场景添加圆形浅灰地面，便于显示平行光阴影 */
const helperGroundEnabled = ref(false)
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

const { locale, t, setLocale } = useUiLocale()
const { themeMode, resolvedTheme, setThemeMode } = useUiTheme()

const DIALOG_TITLE_KEYS = {
  'proc-mesh': 'dlgMesh',
  'proc-skeleton': 'dlgSkeleton',
  'proc-atlas': 'dlgAtlas',
  'proc-pbr': 'dlgPbr',
  'bake-light': 'dlgBakeLight',
  'bake-tex': 'dlgBakeTex',
  'bake-vertex': 'dlgBakeVertex',
  'tool-tiles': 'dlgTiles',
  'tool-mesh2pc': 'dlgMesh2pc',
  'tool-pc': 'dlgPc',
  'tool-pc2mesh': 'dlgPc2mesh',
  'tool-gaussian': 'dlgGaussian',
}

const dialogTitle = computed(() => {
  const key = DIALOG_TITLE_KEYS[activeDialog.value]
  return key ? t(key) : ''
})

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
  dirHandle.value ? workspaceLabel.value || t('workspaceSelectedFallback') : t('workspaceNone'),
)

watch(
  [workspaceTitle, locale],
  () => {
    document.title = `${t('titleApp')} ${t('titleSep')} ${workspaceTitle.value}`
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
/** @type {import('vue').Ref<'qem' | 'cluster' | 'incremental' | 'attribute_aware'>} */
const meshSimplifyAlgorithm = ref('qem')

const MESH_ALGO_KEYS = {
  qem: 'meshAlgoQem',
  cluster: 'meshAlgoCluster',
  incremental: 'meshAlgoIncremental',
  attribute_aware: 'meshAlgoAttribute',
}

const meshAlgorithmOptions = computed(() =>
  Object.entries(MESH_ALGO_KEYS).map(([value, key]) => ({ value, label: t(key) })),
)
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

const logLocaleTag = computed(() => (locale.value === 'zh' ? 'zh-CN' : 'en-US'))

const logTextDisplay = computed(() =>
  logLines.value
    .map((l) => {
      const d = new Date(l.t)
      const ts = d.toLocaleTimeString(logLocaleTag.value, { hour12: false })
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
  logPush(t('statusReady'), 'idle')
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
  } else if (e?.type === 'material-updated' && e.material) {
    dualRef.value?.syncMeshesUsingMaterial?.(e.material)
    const panel = e.panel === 'source' || e.panel === 'result' ? e.panel : focusPanel.value
    dualRef.value?.refreshOutline?.(panel)
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
    setStatus(t('urlEmptyError'), 'error')
    return
  }
  setStatus(t('urlLoading'), 'loading')
  try {
    await dualRef.value?.loadUrl(u)
    showUrlModal.value = false
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

function openUrlModal() {
  showUrlModal.value = true
}

function meshAlgoShortLabel() {
  const key = MESH_ALGO_KEYS[meshSimplifyAlgorithm.value]
  return key ? t(key) : meshSimplifyAlgorithm.value
}

function runMeshSimplify() {
  setStatus(
    `「${t('dlgMesh')}」${meshAlgoShortLabel()} · ${t('meshTargetRatio')}=${meshTargetRatio.value.toFixed(2)} — ${t('dlgPlaceholderLead')}`,
    'ok',
  )
  activeDialog.value = ''
}
</script>

<template>
  <div class="workbench" :data-shell-theme="resolvedTheme">
    <nav class="menubar">
      <div class="menu-root">
        <button class="menu-btn" type="button">{{ t('menuFile') }}</button>
        <div class="menu-pop">
          <button class="menu-item" type="button" @click="openFiles">{{ t('fileOpenModel') }}</button>
          <button class="menu-item" type="button" @click="openUrlModal">{{ t('fileOpenFromUrl') }}</button>
          <div class="menu-sep" />
          <button class="menu-item" type="button" @click="runPlaceholder('导出 glTF')">{{ t('fileExportGltf') }}</button>
        </div>
      </div>
      <div class="menu-root">
        <button class="menu-btn menu-top" type="button">{{ t('menuProcess') }}</button>
        <div class="menu-pop menu-pop-wide">
          <button class="menu-item" type="button" @click="activeDialog = 'proc-mesh'">{{ t('dlgMesh') }}…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'proc-skeleton'">{{ t('dlgSkeleton') }}…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'proc-atlas'">{{ t('dlgAtlas') }}…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'proc-pbr'">{{ t('dlgPbr') }}…</button>
          <div class="menu-sep" />
          <button class="menu-item" type="button" @click="showDuplicateModal = true">{{ t('menuDuplicateResources') }}</button>
        </div>
      </div>
      <div class="menu-root">
        <button class="menu-btn menu-top" type="button">{{ t('menuBake') }}</button>
        <div class="menu-pop menu-pop-wide">
          <button class="menu-item" type="button" @click="activeDialog = 'bake-light'">{{ t('dlgBakeLight') }}…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'bake-tex'">{{ t('dlgBakeTex') }}…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'bake-vertex'">{{ t('dlgBakeVertex') }}…</button>
        </div>
      </div>
      <div class="menu-root">
        <button class="menu-btn menu-top" type="button">{{ t('menuTools') }}</button>
        <div class="menu-pop menu-pop-wide">
          <button class="menu-item" type="button" @click="activeDialog = 'tool-tiles'">{{ t('dlgTiles') }}…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'tool-mesh2pc'">{{ t('dlgMesh2pc') }}…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'tool-pc'">{{ t('dlgPc') }}…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'tool-pc2mesh'">{{ t('dlgPc2mesh') }}…</button>
          <button class="menu-item" type="button" @click="activeDialog = 'tool-gaussian'">{{ t('dlgGaussian') }}…</button>
        </div>
      </div>
      <div class="menu-root">
        <button class="menu-btn menu-top" type="button">{{ t('menuLanguage') }}</button>
        <div class="menu-pop">
          <button
            class="menu-item menu-check"
            :class="{ checked: locale === 'zh' }"
            type="button"
            @click="setLocale('zh')"
          >
            {{ t('langZh') }}
          </button>
          <button
            class="menu-item menu-check"
            :class="{ checked: locale === 'en' }"
            type="button"
            @click="setLocale('en')"
          >
            {{ t('langEn') }}
          </button>
        </div>
      </div>
      <div class="menu-root">
        <button class="menu-btn menu-top" type="button">{{ t('menuTheme') }}</button>
        <div class="menu-pop">
          <button
            class="menu-item menu-check"
            :class="{ checked: themeMode === 'system' }"
            type="button"
            @click="setThemeMode('system')"
          >
            {{ t('themeSystem') }}
          </button>
          <button
            class="menu-item menu-check"
            :class="{ checked: themeMode === 'light' }"
            type="button"
            @click="setThemeMode('light')"
          >
            {{ t('themeLight') }}
          </button>
          <button
            class="menu-item menu-check"
            :class="{ checked: themeMode === 'dark' }"
            type="button"
            @click="setThemeMode('dark')"
          >
            {{ t('themeDark') }}
          </button>
        </div>
      </div>
      <button class="menu-btn menu-top" type="button" @click="openWorkspaceMenu">{{ t('workspaceBtn') }}</button>
      <button class="menu-btn menu-top" type="button" @click="showMemoryModal = true">{{ t('memoryBtn') }}</button>
      <div class="menu-root">
        <button class="menu-btn" type="button">{{ t('menuHelp') }}</button>
        <div class="menu-pop">
          <span class="menu-hint">{{ t('helpHint') }}</span>
        </div>
      </div>
    </nav>

    <div class="title-bar">
      <span class="title-app">{{ t('titleApp') }}</span>
      <span class="title-sep">{{ t('titleSep') }}</span>
      <span class="title-workspace" :title="workspaceTitle">{{ workspaceTitle }}</span>
    </div>

    <div class="toolbar">
      <button type="button" class="tool-btn primary" @click="openFiles">{{ t('toolbarOpen') }}</button>
      <button type="button" class="tool-btn" @click="dualRef?.resetCameras?.()">{{ t('toolbarResetCam') }}</button>
      <button
        type="button"
        class="tool-btn"
        :class="{ 'tool-btn-active': viewportMaximized }"
        :title="viewportMaximized ? t('toolbarViewportMaxTitleOn') : t('toolbarViewportMaxTitleOff')"
        @click="viewportMaximized = !viewportMaximized"
      >
        {{ t('toolbarViewportMax') }}
      </button>
      <label class="toolbar-cb toolbar-cb-wide" :title="t('toolbarLinkCamTitle')">
        <input v-model="linkCamerasLinked" type="checkbox" />
        {{ t('toolbarLinkCam') }}
      </label>
      <label class="toolbar-cb toolbar-cb-wide" :title="t('toolbarGroundTitle')">
        <input v-model="helperGroundEnabled" type="checkbox" />
        {{ t('toolbarGround') }}
      </label>
      <div class="toolbar-vp" :title="t('toolbarVpGroupTitle')">
        <label class="toolbar-cb"
          ><input v-model="showViewportSource" type="checkbox" /> {{ t('toolbarShowSource') }}</label
        >
        <label class="toolbar-cb"
          ><input v-model="showViewportResult" type="checkbox" /> {{ t('toolbarShowResult') }}</label
        >
      </div>
      <span class="toolbar-gap" />
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
          :title="t('outlinerSource')"
          :items="sourceOutline"
          :expanded-uuids="expandedSource"
          :selected-uuid="selectedSourceUuid"
          @toggle-expand="toggleSourceExpand"
          @select="onSelectSource"
        />
        <SceneOutliner
          :title="t('outlinerResult')"
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
          :helper-ground="helperGroundEnabled"
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
          <span>{{ t('dockProps') }}</span>
          <button
            type="button"
            class="dock-toggle"
            :title="dockCollapsed ? t('dockExpand') : t('dockCollapse')"
            @click="dockCollapsed = !dockCollapsed"
          >
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
            <p class="modal-hint">{{ t('meshHint') }}</p>
            <label class="field">
              <span>{{ t('meshAlgoLabel') }}</span>
              <select v-model="meshSimplifyAlgorithm" class="sel mesh-algo-sel">
                <option v-for="opt in meshAlgorithmOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
              </select>
            </label>
            <p class="modal-hint sub-hint">{{ t('dlgPlaceholderLead') }}</p>
            <label class="field">
              <span>{{ t('meshTargetRatio') }}</span>
              <input v-model.number="meshTargetRatio" type="range" min="0.05" max="1" step="0.05" />
              <span class="mono">{{ meshTargetRatio.toFixed(2) }}</span>
            </label>
            <label class="check"><input v-model="meshPreserveBorder" type="checkbox" /> {{ t('meshPreserveBorder') }}</label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runMeshSimplify">{{ t('meshRun') }}</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'proc-skeleton'">
            <p class="modal-hint">{{ t('dlgPlaceholderLead') }}</p>
            <label class="field">
              <span>{{ t('maxBonesLabel') }}</span>
              <input v-model.number="maxBones" class="num" type="number" min="1" max="512" />
            </label>
            <label class="field">
              <span>{{ t('maxInfluencesLabel') }}</span>
              <input v-model.number="maxInfluences" class="num" type="number" min="1" max="8" />
            </label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('骨骼简化'); activeDialog = ''">{{ t('skeletonRun') }}</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'proc-atlas'">
            <p class="modal-hint">{{ t('dlgPlaceholderLead') }}</p>
            <label class="check"><input v-model="mergeTextures" type="checkbox" /> {{ t('mergeTexturesLabel') }}</label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('贴图合并'); activeDialog = ''">{{ t('atlasRun') }}</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'proc-pbr'">
            <p class="modal-hint">{{ t('dlgPlaceholderLead') }}</p>
            <label class="check"><input v-model="pbrFromSingle" type="checkbox" /> {{ t('pbrSingleLabel') }}</label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('PBR 生成'); activeDialog = ''">{{ t('pbrRun') }}</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'bake-light'">
            <p class="modal-hint">{{ t('dlgPlaceholderLead') }}</p>
            <label class="field">
              <span>{{ t('bakeResLabel') }}</span>
              <input v-model.number="bakeResolution" class="num" type="number" step="256" min="256" max="8192" />
            </label>
            <label class="field">
              <span>{{ t('lightSamplesLabel') }}</span>
              <input v-model.number="lightBakeSamples" class="num" type="number" min="1" max="4096" />
            </label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('灯光烘焙'); activeDialog = ''">{{ t('bakeLightRun') }}</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'bake-tex'">
            <p class="modal-hint">{{ t('dlgPlaceholderLead') }}</p>
            <label class="field">
              <span>{{ t('bakeResLabel') }}</span>
              <input v-model.number="bakeResolution" class="num" type="number" step="256" min="256" max="8192" />
            </label>
            <label class="field">
              <span>{{ t('lightSamplesLabel') }}</span>
              <input v-model.number="lightBakeSamples" class="num" type="number" min="1" max="4096" />
            </label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('烘焙到贴图'); activeDialog = ''">{{ t('bakeTexRun') }}</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'bake-vertex'">
            <p class="modal-hint">{{ t('dlgPlaceholderLead') }}</p>
            <label class="field">
              <span>{{ t('vertexChannelsLabel') }}</span>
              <input v-model="vertexBakeChannels" class="txt" type="text" :placeholder="t('vertexChannelsPh')" />
            </label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('烘焙到顶点'); activeDialog = ''">{{ t('bakeVertexRun') }}</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'tool-tiles'">
            <p class="modal-hint">{{ t('dlgPlaceholderLead') }}</p>
            <label class="field">
              <span>{{ t('tileSizeLabel') }}</span>
              <input v-model.number="tileSize" class="num" type="number" min="0.1" step="0.1" />
            </label>
            <label class="field">
              <span>{{ t('tileOverlapLabel') }}</span>
              <input v-model.number="tileOverlap" class="num" type="number" min="0" step="0.01" />
            </label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('切割瓦片'); activeDialog = ''">{{ t('tilesRun') }}</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'tool-mesh2pc'">
            <p class="modal-hint">{{ t('dlgPlaceholderLead') }}</p>
            <label class="field">
              <span>{{ t('pcDensityLabel') }}</span>
              <select v-model="pcDensity" class="sel">
                <option value="low">{{ t('pcLow') }}</option>
                <option value="medium">{{ t('pcMedium') }}</option>
                <option value="high">{{ t('pcHigh') }}</option>
              </select>
            </label>
            <label class="check"><input v-model="pcNoiseRemove" type="checkbox" /> {{ t('pcDenoiseLabel') }}</label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('Mesh → 点云'); activeDialog = ''">{{ t('mesh2pcRun') }}</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'tool-pc'">
            <p class="modal-hint">{{ t('dlgPlaceholderLead') }}</p>
            <label class="field">
              <span>{{ t('pcDensityLabel') }}</span>
              <select v-model="pcDensity" class="sel">
                <option value="low">{{ t('pcLow') }}</option>
                <option value="medium">{{ t('pcMedium') }}</option>
                <option value="high">{{ t('pcHigh') }}</option>
              </select>
            </label>
            <label class="check"><input v-model="pcNoiseRemove" type="checkbox" /> {{ t('pcDenoiseLabel') }}</label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('点云处理'); activeDialog = ''">{{ t('pcProcRun') }}</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'tool-pc2mesh'">
            <p class="modal-hint">{{ t('dlgPlaceholderLead') }}</p>
            <label class="field">
              <span>{{ t('meshFromPcLabel') }}</span>
              <select v-model="meshFromPcMethod" class="sel">
                <option value="poisson">{{ t('poisson') }}</option>
                <option value="ball_pivot">{{ t('ballPivot') }}</option>
                <option value="alpha_shape">{{ t('alphaShape') }}</option>
              </select>
            </label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('点云 → Mesh'); activeDialog = ''">{{ t('pc2meshRun') }}</button>
            </div>
          </template>

          <template v-else-if="activeDialog === 'tool-gaussian'">
            <p class="modal-hint">{{ t('dlgPlaceholderLead') }}</p>
            <label class="field">
              <span>{{ t('gaussianModeLabel') }}</span>
              <select v-model="gaussianMode" class="sel">
                <option value="colmap-style">{{ t('colmapStyle') }}</option>
                <option value="instant-ngp">{{ t('instantNgp') }}</option>
              </select>
            </label>
            <div class="btn-row">
              <button type="button" class="tool-btn" @click="runPlaceholder('高斯泼溅'); activeDialog = ''">{{ t('gaussianRun') }}</button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 从 URL 打开 -->
    <div v-if="showUrlModal" class="modal-backdrop" @click.self="showUrlModal = false">
      <div class="modal-panel modal-url" role="dialog" aria-labelledby="dlg-url-title">
        <header class="modal-head">
          <h2 id="dlg-url-title">{{ t('urlModalTitle') }}</h2>
          <button type="button" class="modal-close" @click="showUrlModal = false">×</button>
        </header>
        <div class="modal-body">
          <p class="modal-hint">{{ t('urlModalHint') }}</p>
          <label class="field field-block">
            <span class="sr-only">URL</span>
            <input
              v-model="urlInput"
              class="txt url-modal-input"
              type="text"
              :placeholder="t('urlPlaceholder')"
              @keydown.enter="loadFromUrl"
            />
          </label>
          <div class="btn-row">
            <button type="button" class="tool-btn primary" @click="loadFromUrl">{{ t('urlLoad') }}</button>
            <button type="button" class="tool-btn" @click="showUrlModal = false">{{ t('urlCancel') }}</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 本地工作目录 -->
    <div v-if="showWorkspaceModal" class="modal-backdrop" @click.self="showWorkspaceModal = false">
      <div class="modal-panel modal-wide" role="dialog" aria-labelledby="dlg-ws-title">
        <header class="modal-head">
          <h2 id="dlg-ws-title">{{ t('dlgWsTitle') }}</h2>
          <button type="button" class="modal-close" @click="showWorkspaceModal = false">×</button>
        </header>
        <div class="modal-body">
          <p class="hint">{{ t('wsHint') }}</p>
          <label class="field">
            <span>{{ t('wsLabel') }}</span>
            <input
              :value="workspaceLabel"
              class="txt"
              type="text"
              :placeholder="t('wsLabelPh')"
              @input="setManualLabel($event.target.value)"
            />
          </label>
          <label class="field">
            <span>{{ t('wsDepth') }}</span>
            <input v-model.number="listMaxDepth" class="num" type="number" min="1" max="8" @change="refreshListing" />
          </label>
          <div class="btn-row">
            <button type="button" class="tool-btn" @click="pickWorkspace">{{ t('wsPick') }}</button>
            <button type="button" class="tool-btn" @click="refreshListing">{{ t('wsRefresh') }}</button>
            <button type="button" class="tool-btn" @click="clearWorkspace">{{ t('wsClear') }}</button>
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
          <h2 id="merge-result-title">{{ t('dlgMergeTitle') }}</h2>
          <button type="button" class="modal-close" aria-label="关闭" @click="closeMergeResultDialog">×</button>
        </header>
        <div class="modal-body merge-result-body">
          <p class="merge-result-lead" v-html="t('mergeLeadHtml')" />
          <ul class="merge-result-list">
            <li v-for="(line, idx) in mergeResultLines" :key="idx">{{ line }}</li>
          </ul>
        </div>
        <div class="merge-result-actions">
          <button type="button" class="tool-btn accent" @click="closeMergeResultDialog">{{ t('dlgMergeOk') }}</button>
        </div>
      </div>
    </div>

    <div v-if="showLogModal" class="modal-backdrop" @click.self="showLogModal = false">
      <div class="modal-panel log-modal" role="dialog">
        <header class="modal-head">
          <h2>{{ t('dlgLogTitle') }}</h2>
          <button type="button" class="modal-close" @click="showLogModal = false">×</button>
        </header>
        <div class="modal-body log-body">
          <pre class="log-pre">{{ logTextDisplay }}</pre>
        </div>
        <div class="log-actions">
          <button type="button" class="tool-btn" @click="copyLogText">{{ t('logCopy') }}</button>
        </div>
      </div>
    </div>

    <footer
      class="statusbar"
      :class="`st-${statusKind}`"
      :title="t('statusBarTitle')"
      @dblclick="openLogModal"
    >
      <span class="status-msg" :title="statusText">{{ statusText }}</span>
      <div class="status-right" :title="t('statusMemTitle')">
        <span class="status-js-line">
          <template v-if="memStats.js">
            {{ t('statusJs') }} {{ fmtMemBar(memStats.js.used) }} / {{ fmtMemBar(memStats.js.limit) }}
          </template>
          <template v-else>{{ t('statusJs') }} —</template>
          · {{ t('statusGpuTotal') }} {{ fmtMemBar(memStats.gpuEst) }} · {{ t('statusGpuPeak') }}
          {{ fmtMemBar(memStats.gpuPeakEst) }} · {{ t('statusTexObjects') }}
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
.workbench[data-shell-theme='light'] {
  background: #e4e6eb;
  color: #1a1f28;
}
.workbench[data-shell-theme='light'] .menubar {
  background: linear-gradient(#f0f2f5, #e2e5ea);
  border-bottom: 1px solid #c5cad4;
}
.workbench[data-shell-theme='light'] .menu-btn {
  border-color: #b8c0cc;
  color: #2d3748;
  background: rgba(255, 255, 255, 0.35);
}
.workbench[data-shell-theme='light'] .menu-btn:hover {
  border-color: #8b96a8;
  background: #fff;
}
.workbench[data-shell-theme='light'] .menu-pop {
  background: linear-gradient(#fafbfc, #eef0f4);
  border-color: #aeb6c4;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}
.workbench[data-shell-theme='light'] .menu-item {
  color: #1e293b;
}
.workbench[data-shell-theme='light'] .menu-item:hover {
  background: #dde3ec;
  border-color: #9aa8bc;
}
.workbench[data-shell-theme='light'] .menu-sep {
  background: #c5cad4;
}
.workbench[data-shell-theme='light'] .menu-hint {
  color: #475569;
}
.workbench[data-shell-theme='light'] .title-bar {
  background: linear-gradient(#f4f6f9, #e8ebf0);
  border-bottom: 1px solid #cfd6e0;
  color: #475569;
}
.workbench[data-shell-theme='light'] .title-app {
  color: #0f172a;
}
.workbench[data-shell-theme='light'] .title-workspace {
  color: #166534;
}
.workbench[data-shell-theme='light'] .toolbar {
  background: linear-gradient(#eceef2, #e0e3e9);
  border-bottom: 1px solid #c5cad4;
}
.workbench[data-shell-theme='light'] .tool-btn {
  border-color: #9aa8bc;
  background: linear-gradient(#f8f9fb, #e8ecf2);
  color: #1e293b;
}
.workbench[data-shell-theme='light'] .tool-btn:hover {
  border-color: #5b7a9e;
}
.workbench[data-shell-theme='light'] .tool-btn.primary {
  background: linear-gradient(#5b8fc7, #4a7ab0);
  color: #fff;
}
.workbench[data-shell-theme='light'] .left-dock {
  background: #f0f2f6;
  border-right-color: #c5cad4;
}
.workbench[data-shell-theme='light'] .right-dock {
  background: #ebeff5;
  border-left-color: #c5cad4;
}
.workbench[data-shell-theme='light'] .dock-head {
  background: linear-gradient(#e8ecf2, #dde3ec);
  border-bottom-color: #c5cad4;
  color: #334155;
}
.workbench[data-shell-theme='light'] .statusbar {
  background: linear-gradient(#e8ecf2, #dde3ec);
  border-top-color: #c5cad4;
}
.workbench[data-shell-theme='light'] .status-js-line {
  color: #475569;
}
.workbench[data-shell-theme='light'] .modal-panel {
  background: linear-gradient(#fafbfc, #eef1f6);
  border-color: #aeb6c4;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.15);
}
.workbench[data-shell-theme='light'] .modal-head {
  border-bottom-color: #c5cad4;
}
.workbench[data-shell-theme='light'] .modal-head h2 {
  color: #0f172a;
}
.workbench[data-shell-theme='light'] .modal-hint,
.workbench[data-shell-theme='light'] .hint {
  color: #64748b;
}
.workbench[data-shell-theme='light'] .num,
.workbench[data-shell-theme='light'] .txt,
.workbench[data-shell-theme='light'] .sel {
  background: #fff;
  border-color: #aeb6c4;
  color: #1e293b;
}
.workbench[data-shell-theme='light'] .field,
.workbench[data-shell-theme='light'] .check {
  color: #334155;
}
.workbench[data-shell-theme='light'] .field span:first-child {
  color: #64748b;
}
.workbench[data-shell-theme='light'] .log-pre {
  color: #1e293b;
}
.workbench[data-shell-theme='light'] .menu-item.menu-check.checked {
  background: #d4e4f7;
  border-color: #5b8fc7;
}
.workbench[data-shell-theme='light'] .merge-result-lead strong {
  color: #b45309;
}
.workbench[data-shell-theme='light'] .merge-result-list {
  color: #0f172a;
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
.menu-item.menu-check.checked {
  background: #2a3f5c;
  border-color: #5a9fd4;
  border-left: 3px solid #6b9fe0;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.modal-panel.modal-url {
  width: min(520px, 100%);
}
.field.field-block {
  flex-direction: column;
  align-items: stretch;
}
.field.field-block .txt.url-modal-input {
  width: 100%;
  max-width: none;
}
.modal-hint.sub-hint {
  margin-top: -4px;
  font-size: 10px;
  opacity: 0.92;
}
.mesh-algo-sel {
  flex: 1 1 100%;
  max-width: 100%;
  min-width: 0;
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
