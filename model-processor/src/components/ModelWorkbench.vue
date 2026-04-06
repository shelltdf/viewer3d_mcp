<script setup>
import { ref, computed, watch } from 'vue'
import DualViewport from './DualViewport.vue'
import SceneOutliner from './SceneOutliner.vue'
import PropertyInspector from './PropertyInspector.vue'
import { useLocalWorkspace } from '../composables/useLocalWorkspace.js'

const dualRef = ref(null)
const fileInputRef = ref(null)

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

const showProcessModal = ref(false)
const showBakeModal = ref(false)
const showToolsModal = ref(false)
const showWorkspaceModal = ref(false)

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

function setStatus(text, kind = 'idle') {
  statusText.value = text
  statusKind.value = kind
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
  setStatus(`已加载源模型 · 动画片段：${payload?.animations ?? 0}`, 'ok')
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

function previewOptimize() {
  setStatus('正在生成优化后预览…', 'loading')
  dualRef.value?.syncResultFromSource()
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
      <button class="menu-btn menu-top" type="button" @click="showProcessModal = true">处理</button>
      <button class="menu-btn menu-top" type="button" @click="showBakeModal = true">烘焙</button>
      <button class="menu-btn menu-top" type="button" @click="showToolsModal = true">工具</button>
      <button class="menu-btn menu-top" type="button" @click="openWorkspaceMenu">本地工作目录</button>
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
      <button type="button" class="tool-btn accent" @click="previewOptimize">预览优化</button>
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
        accept=".gltf,.glb,.bin,.obj,.mtl,image/*"
        @change="onPickFile"
      />
    </div>

    <div class="main-row">
      <aside class="left-dock">
        <SceneOutliner
          title="大纲 · 优化前"
          :items="sourceOutline"
          :expanded-uuids="expandedSource"
          :selected-uuid="selectedSourceUuid"
          @toggle-expand="toggleSourceExpand"
          @select="onSelectSource"
        />
        <SceneOutliner
          title="大纲 · 优化后"
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
          @viewer-error="onViewerError"
          @status="onDualStatus"
          @source-loaded="onSourceLoaded"
          @result-updated="onResultUpdated"
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
          <PropertyInspector :payload="inspectorPayload" />
        </div>
      </aside>
    </div>

    <!-- 处理 -->
    <div v-if="showProcessModal" class="modal-backdrop" @click.self="showProcessModal = false">
      <div class="modal-panel" role="dialog" aria-labelledby="dlg-process-title">
        <header class="modal-head">
          <h2 id="dlg-process-title">处理</h2>
          <button type="button" class="modal-close" @click="showProcessModal = false">×</button>
        </header>
        <div class="modal-body">
          <p class="modal-hint">以下为管线占位参数，可接入 WASM / 后端后生效。</p>
          <div class="btn-row">
            <button type="button" class="tool-btn accent" @click="previewOptimize(); showProcessModal = false">预览优化结果</button>
          </div>
          <section class="sec">
            <h3 class="sec-title">网格 / 骨骼简化</h3>
            <label class="field">
              <span>目标三角面比例</span>
              <input v-model.number="meshTargetRatio" type="range" min="0.05" max="1" step="0.05" />
              <span class="mono">{{ meshTargetRatio.toFixed(2) }}</span>
            </label>
            <label class="check"><input v-model="meshPreserveBorder" type="checkbox" /> 保护边界</label>
            <label class="field">
              <span>最大骨骼数</span>
              <input v-model.number="maxBones" class="num" type="number" min="1" max="512" />
            </label>
            <label class="field">
              <span>每顶点最大影响数</span>
              <input v-model.number="maxInfluences" class="num" type="number" min="1" max="8" />
            </label>
          </section>
          <section class="sec">
            <h3 class="sec-title">材质 / 贴图</h3>
            <label class="check"><input v-model="mergeTextures" type="checkbox" /> 合并材质贴图（Atlas）</label>
            <label class="check"><input v-model="pbrFromSingle" type="checkbox" /> 单张贴图推测 PBR（占位）</label>
          </section>
          <div class="btn-row">
            <button type="button" class="tool-btn" @click="runPlaceholder('网格简化')">网格简化</button>
            <button type="button" class="tool-btn" @click="runPlaceholder('骨骼简化')">骨骼 / 权重简化</button>
            <button type="button" class="tool-btn" @click="runPlaceholder('贴图合并')">材质贴图合并</button>
            <button type="button" class="tool-btn" @click="runPlaceholder('PBR 生成')">单贴图 → PBR</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 烘焙 -->
    <div v-if="showBakeModal" class="modal-backdrop" @click.self="showBakeModal = false">
      <div class="modal-panel" role="dialog" aria-labelledby="dlg-bake-title">
        <header class="modal-head">
          <h2 id="dlg-bake-title">烘焙</h2>
          <button type="button" class="modal-close" @click="showBakeModal = false">×</button>
        </header>
        <div class="modal-body">
          <section class="sec">
            <h3 class="sec-title">烘焙参数</h3>
            <label class="field">
              <span>模式</span>
              <select v-model="bakeMode" class="sel">
                <option value="light">灯光烘焙</option>
                <option value="texture">烘焙到贴图</option>
                <option value="vertex">烘焙到顶点</option>
              </select>
            </label>
            <label class="field">
              <span>贴图分辨率</span>
              <input v-model.number="bakeResolution" class="num" type="number" step="256" min="256" max="8192" />
            </label>
            <label class="field">
              <span>灯光采样</span>
              <input v-model.number="lightBakeSamples" class="num" type="number" min="1" max="4096" />
            </label>
            <label class="field">
              <span>顶点通道</span>
              <input v-model="vertexBakeChannels" class="txt" type="text" placeholder="color, ao, …" />
            </label>
          </section>
          <div class="btn-row">
            <button type="button" class="tool-btn" @click="runPlaceholder('灯光烘焙')">灯光烘焙</button>
            <button type="button" class="tool-btn" @click="runPlaceholder('烘焙到贴图')">烘焙到贴图</button>
            <button type="button" class="tool-btn" @click="runPlaceholder('烘焙到顶点')">烘焙到顶点属性</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 工具 -->
    <div v-if="showToolsModal" class="modal-backdrop" @click.self="showToolsModal = false">
      <div class="modal-panel" role="dialog" aria-labelledby="dlg-tools-title">
        <header class="modal-head">
          <h2 id="dlg-tools-title">工具</h2>
          <button type="button" class="modal-close" @click="showToolsModal = false">×</button>
        </header>
        <div class="modal-body">
          <section class="sec">
            <h3 class="sec-title">瓦片 / 点云 / 高斯</h3>
            <label class="field">
              <span>瓦片尺寸</span>
              <input v-model.number="tileSize" class="num" type="number" min="0.1" step="0.1" />
            </label>
            <label class="field">
              <span>瓦片重叠</span>
              <input v-model.number="tileOverlap" class="num" type="number" min="0" step="0.01" />
            </label>
            <label class="field">
              <span>点云密度</span>
              <select v-model="pcDensity" class="sel">
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </label>
            <label class="check"><input v-model="pcNoiseRemove" type="checkbox" /> 点云去噪</label>
            <label class="field">
              <span>点云 → Mesh</span>
              <select v-model="meshFromPcMethod" class="sel">
                <option value="poisson">Poisson</option>
                <option value="ball_pivot">Ball pivot</option>
                <option value="alpha_shape">Alpha shape</option>
              </select>
            </label>
            <label class="field">
              <span>高斯泼溅</span>
              <select v-model="gaussianMode" class="sel">
                <option value="colmap-style">COLMAP 风格（占位）</option>
                <option value="instant-ngp">Instant-NGP 风格（占位）</option>
              </select>
            </label>
          </section>
          <div class="btn-row">
            <button type="button" class="tool-btn" @click="runPlaceholder('切割瓦片')">切割瓦片</button>
            <button type="button" class="tool-btn" @click="runPlaceholder('Mesh → 点云')">Mesh → 点云</button>
            <button type="button" class="tool-btn" @click="runPlaceholder('点云处理')">点云处理</button>
            <button type="button" class="tool-btn" @click="runPlaceholder('点云 → Mesh')">点云 → Mesh</button>
            <button type="button" class="tool-btn" @click="runPlaceholder('高斯泼溅')">Mesh → 高斯泼溅</button>
          </div>
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

    <footer class="statusbar" :class="`st-${statusKind}`">
      <span>{{ statusText }}</span>
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
.toolbar-gap {
  flex: 1 1 20px;
  min-width: 8px;
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
  padding: 7px 12px;
  font-size: 12px;
  border-top: 1px solid #3a3f4a;
  background: linear-gradient(#333842, #2a2f38);
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
</style>
