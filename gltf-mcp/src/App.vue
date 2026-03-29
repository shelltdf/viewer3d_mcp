<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import GltfViewer from './components/GltfViewer.vue'
import { useGltfBridge } from './composables/useGltfBridge.js'

const viewerRef = ref(null)
const fileInputRef = ref(null)
const urlInput = ref('')
const lastLoadedUrl = ref('')
const error = ref('')
const statusText = ref('就绪')
const statusKind = ref('idle')
const transformTool = ref('move')
const panelCount = ref(2)
const activeShelf = ref('Modeling')
const currentFrame = ref(1)
const rangeStart = ref(1)
const rangeEnd = ref(120)
const focusMode = ref(false)
const shelfTabs = ['Curves', 'Surfaces', 'Modeling', 'Sculpting', 'Rigging', 'Animation', 'Rendering', 'FX', 'Arnold']

useGltfBridge(viewerRef, lastLoadedUrl)

function showError(msg) {
  const text = msg || '加载失败'
  error.value = text
  statusText.value = `加载失败：${text}`
  statusKind.value = 'error'
}

function applyQueryUrl() {
  const params = new URLSearchParams(window.location.search)
  const u = params.get('url')
  if (u) {
    urlInput.value = u
    queueMicrotask(() => loadFromUrl())
  }
}

onMounted(() => {
  applyQueryUrl()
  window.addEventListener('keydown', onGlobalKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeyDown)
})

function onGlobalKeyDown(e) {
  if (!(e.ctrlKey && e.code === 'Space')) return
  e.preventDefault()
  focusMode.value = !focusMode.value
}

async function loadFromUrl() {
  error.value = ''
  const u = urlInput.value.trim()
  if (!u) {
    error.value = '请输入模型 URL'
    statusText.value = '错误：请输入模型 URL'
    statusKind.value = 'error'
    return
  }
  statusText.value = '正在加载 URL 模型...'
  statusKind.value = 'loading'
  try {
    await viewerRef.value?.loadUrl(u)
    lastLoadedUrl.value = u
    statusText.value = `已加载：${u}`
    statusKind.value = 'ok'
  } catch (e) {
    error.value = e?.message || String(e)
    statusText.value = `加载失败：${error.value}`
    statusKind.value = 'error'
  }
}

async function onPickFile(e) {
  error.value = ''
  const selected = Array.from(e.target.files || [])
  e.target.value = ''
  if (selected.length === 0) {
    showError('未选择任何文件')
    return
  }
  statusText.value = '正在加载本地模型...'
  statusKind.value = 'loading'
  try {
    await viewerRef.value?.loadFiles(selected)
    lastLoadedUrl.value = ''
    const firstName = selected[0]?.name || '本地文件'
    statusText.value = `已加载本地文件：${firstName}`
    statusKind.value = 'ok'
  } catch (err) {
    showError(err?.message || String(err))
  }
}

function resetCamera() {
  viewerRef.value?.resetCamera()
}

function openLocalFiles() {
  fileInputRef.value?.click()
}

function setTransformTool(mode) {
  transformTool.value = mode
  viewerRef.value?.setTransformTool?.(mode)
}

function setPanelCount(count) {
  panelCount.value = count
  viewerRef.value?.applyPanelCount?.(count)
}

function onViewerState(payload) {
  if (!payload) return
  if (payload.transformTool) transformTool.value = payload.transformTool
  if (payload.panelCount) panelCount.value = payload.panelCount
}
</script>

<template>
  <div class="app">
    <nav class="main-menubar">
      <div class="main-menu file-menu">
        <button class="main-menu-item" type="button">File</button>
        <div class="file-menu-panel">
          <div class="file-menu-title">gltf-mcp</div>
          <p class="file-menu-hint">Vue + three.js，经 MCP 桥接由 AI 驱动加载模型</p>
          <div class="file-menu-row">
            <input
              v-model="urlInput"
              class="url"
              type="text"
              placeholder="模型 URL（.gltf / .glb）"
              @keydown.enter="loadFromUrl"
            />
          </div>
          <div class="file-menu-row">
            <button type="button" @click="loadFromUrl">加载 URL</button>
            <button type="button" class="ghost" @click="openLocalFiles">本地文件（可多选）</button>
            <button type="button" class="ghost" @click="resetCamera">重置相机</button>
          </div>
          <input
            ref="fileInputRef"
            class="hidden-file-input"
            type="file"
            multiple
            accept=".gltf,.glb,.bin,image/*"
            @change="onPickFile"
          />
        </div>
      </div>
      <button class="main-menu-item" type="button">Edit</button>
      <button class="main-menu-item" type="button">Create</button>
      <button class="main-menu-item" type="button">Select</button>
      <button class="main-menu-item" type="button">Modify</button>
      <button class="main-menu-item" type="button">Display</button>
      <button class="main-menu-item" type="button">Windows</button>
      <button class="main-menu-item" type="button">Help</button>
    </nav>
    <section v-show="!focusMode" class="shelf-bar">
      <div class="shelf-tabs">
        <button
          v-for="tab in shelfTabs"
          :key="tab"
          type="button"
          class="shelf-tab"
          :class="{ active: activeShelf === tab }"
          @click="activeShelf = tab"
        >
          {{ tab }}
        </button>
      </div>
      <div class="shelf-tools">
        <button type="button">Select</button>
        <button type="button">Move</button>
        <button type="button">Rotate</button>
        <button type="button">Scale</button>
        <button type="button">Frame</button>
      </div>
    </section>
    <div class="workspace">
      <aside v-show="!focusMode" class="tool-rail">
        <div class="tool-group">
          <div class="tool-group-title">Transform</div>
          <button class="rail-btn icon-btn" :class="{ active: transformTool === 'move' }" title="移动 (W)" @click="setTransformTool('move')">
            <span class="icon-cell icon-move" />
          </button>
          <button class="rail-btn icon-btn" :class="{ active: transformTool === 'rotate' }" title="旋转 (E)" @click="setTransformTool('rotate')">
            <span class="icon-cell icon-rotate" />
          </button>
          <button class="rail-btn icon-btn" :class="{ active: transformTool === 'scale' }" title="缩放 (R)" @click="setTransformTool('scale')">
            <span class="icon-cell icon-scale" />
          </button>
        </div>
        <div class="tool-group">
          <div class="tool-group-title">Viewport</div>
          <button class="rail-btn icon-btn" :class="{ active: panelCount === 1 }" title="1视图" @click="setPanelCount(1)">
            <span class="icon-cell icon-v1" />
          </button>
          <button class="rail-btn icon-btn" :class="{ active: panelCount === 2 }" title="2视图" @click="setPanelCount(2)">
            <span class="icon-cell icon-v2" />
          </button>
          <button class="rail-btn icon-btn" :class="{ active: panelCount === 3 }" title="3视图" @click="setPanelCount(3)">
            <span class="icon-cell icon-v3" />
          </button>
          <button class="rail-btn icon-btn" :class="{ active: panelCount === 4 }" title="4视图" @click="setPanelCount(4)">
            <span class="icon-cell icon-v4" />
          </button>
        </div>
      </aside>
      <GltfViewer
        ref="viewerRef"
        class="viewer"
        :focus-mode="focusMode"
        @viewer-error="showError"
        @viewer-state="onViewerState"
      />
    </div>
    <section v-show="!focusMode" class="timeline-bar">
      <div class="timeline-row time-main">
        <div class="timeline-left">
          <span class="timeline-label">Time Slider</span>
          <div class="play-controls">
            <button type="button" title="起始帧">|&lt;</button>
            <button type="button" title="上一帧">&lt;</button>
            <button type="button" title="播放">▶</button>
            <button type="button" title="下一帧">&gt;</button>
            <button type="button" title="结束帧">&gt;|</button>
          </div>
        </div>
        <input v-model.number="currentFrame" class="frame-input" type="number" min="1" :max="rangeEnd" />
        <div class="time-track-wrap">
          <div class="time-ticks" />
          <input v-model.number="currentFrame" class="time-slider" type="range" min="1" :max="rangeEnd" />
        </div>
        <span class="frame-text">{{ currentFrame }}</span>
      </div>
      <div class="timeline-row range-main">
        <span class="timeline-label">Range Slider</span>
        <input v-model.number="rangeStart" class="frame-input small" type="number" min="1" :max="rangeEnd" />
        <div class="range-track">
          <div class="range-fill" :style="{ left: ((rangeStart - 1) / Math.max(rangeEnd - 1, 1) * 100) + '%', width: ((rangeEnd - rangeStart) / Math.max(rangeEnd - 1, 1) * 100) + '%' }" />
        </div>
        <input v-model.number="rangeEnd" class="frame-input small" type="number" :min="rangeStart" max="20000" />
      </div>
    </section>
    <footer class="statusbar" :class="`status-${statusKind}`">
      <span>{{ statusText }}</span>
    </footer>
  </div>
</template>

<style>
*,
*::before,
*::after {
  box-sizing: border-box;
}
html,
body,
#app {
  height: 100%;
  margin: 0;
}
body {
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  background: #0f1115;
  color: #e8eaed;
}
</style>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 100vh;
}
.main-menubar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 8px;
  background: linear-gradient(#3a3a3a, #2f2f2f);
  border-top: 1px solid #4f4f4f;
  border-bottom: 1px solid #222;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
.main-menu-item {
  border: 1px solid #3c3c3c;
  background: transparent;
  color: #cfcfcf;
  font-size: 12px;
  padding: 3px 9px;
  border-radius: 3px;
  cursor: pointer;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
.main-menu-item:hover {
  border-color: #616161;
  background: #454545;
  color: #e8e8e8;
}
.main-menu:hover > .main-menu-item,
.main-menu:focus-within > .main-menu-item {
  border-color: #6e7a8f;
  background: #3a4350;
  color: #e9f2ff;
}
.main-menu {
  position: relative;
}
.shelf-bar {
  flex: 0 0 auto;
  border-top: 1px solid #4a4a4a;
  border-bottom: 1px solid #1f1f1f;
  background: linear-gradient(#343434, #2b2b2b);
}
.shelf-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px 3px;
  border-bottom: 1px solid #202020;
}
.shelf-tab {
  border: 1px solid #444;
  background: linear-gradient(#3d3d3d, #333);
  color: #cfd3da;
  border-radius: 3px;
  font-size: 11px;
  padding: 2px 8px;
}
.shelf-tab.active {
  border-color: #7c98bd;
  background: linear-gradient(#4d5f76, #435265);
  color: #eef5ff;
}
.shelf-tools {
  display: flex;
  gap: 6px;
  padding: 5px 8px;
}
.file-menu-panel {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  width: 520px;
  padding: 10px;
  border: 1px solid #535353;
  background: linear-gradient(#32353c, #2a2d33);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.25);
  display: none;
  z-index: 40;
}
.file-menu:hover .file-menu-panel,
.file-menu:focus-within .file-menu-panel {
  display: block;
}
.file-menu-title {
  margin-bottom: 4px;
  font-size: 12px;
  color: #dfdfdf;
  font-weight: 600;
}
.file-menu-hint {
  margin: 0 0 8px;
  font-size: 11px;
  color: #aeb5c0;
}
.file-menu-row {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-bottom: 8px;
}
.file-menu-row:last-child {
  margin-bottom: 0;
}
.url {
  flex: 1 1 auto;
  min-width: 0;
  padding: 6px 8px;
  border: 1px solid #586273;
  border-radius: 3px;
  background: #1b2029;
  color: #e6ebf3;
}
button {
  padding: 6px 10px;
  border: 1px solid #5b626f;
  border-radius: 4px;
  background: linear-gradient(#4a5362, #3f4856);
  color: #edf2ff;
  cursor: pointer;
  font-weight: 500;
  font-size: 12px;
}
button:hover {
  border-color: #7696c3;
  background: linear-gradient(#52617a, #46566c);
}
button.ghost {
  background: linear-gradient(#3d434c, #343a43);
  color: #f4f4f4;
  border-color: #525862;
}
.hidden-file-input {
  display: none;
}
.viewer {
  flex: 1 1 auto;
  min-height: 0;
}
.workspace {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.timeline-bar {
  flex: 0 0 auto;
  border-top: 1px solid #555;
  border-bottom: 1px solid #222;
  background: linear-gradient(#3a3a3a, #2f2f2f);
  padding: 4px 8px;
}
.timeline-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.timeline-row + .timeline-row {
  margin-top: 4px;
}
.timeline-label {
  width: 78px;
  color: #c7ccd4;
  font-size: 10px;
  letter-spacing: 0.1px;
}
.timeline-left {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 170px;
}
.play-controls {
  display: flex;
  align-items: center;
  gap: 3px;
}
.play-controls button {
  min-width: 22px;
  height: 20px;
  padding: 0 4px;
  font-size: 10px;
  border-radius: 2px;
}
.frame-input {
  width: 64px;
  height: 22px;
  padding: 2px 4px;
  border: 1px solid #5b5f68;
  border-radius: 2px;
  background: #262b35;
  color: #e4eaf4;
  font-size: 11px;
}
.frame-input.small {
  width: 58px;
}
.time-track-wrap {
  position: relative;
  flex: 1 1 auto;
  height: 22px;
  border: 1px solid #50545c;
  border-radius: 2px;
  background: #262a32;
  overflow: hidden;
}
.time-ticks {
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    to right,
    rgba(198, 205, 216, 0.2) 0px,
    rgba(198, 205, 216, 0.2) 1px,
    transparent 1px,
    transparent 16px
  );
  pointer-events: none;
}
.time-slider {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  background: transparent;
  -webkit-appearance: none;
  appearance: none;
}
.time-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 10px;
  height: 18px;
  border: 1px solid #8da9cc;
  border-radius: 2px;
  background: linear-gradient(#a9c1e2, #89a5c8);
}
.time-slider::-moz-range-thumb {
  width: 10px;
  height: 18px;
  border: 1px solid #8da9cc;
  border-radius: 2px;
  background: linear-gradient(#a9c1e2, #89a5c8);
}
.range-track {
  position: relative;
  flex: 1 1 auto;
  height: 18px;
  border: 1px solid #4f535c;
  border-radius: 2px;
  background: #252a33;
}
.range-fill {
  position: absolute;
  top: 1px;
  bottom: 1px;
  min-width: 2px;
  border: 1px solid #90a9cb;
  background: linear-gradient(#5f7490, #50627a);
  border-radius: 1px;
}
.frame-text {
  color: #bfc6d3;
  font-size: 10px;
  min-width: 28px;
  text-align: right;
}
.tool-rail {
  width: 58px;
  background: #2b2b2b;
  border-right: 1px solid #474747;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 6px 4px;
  gap: 8px;
}
.tool-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 2px 0;
}
.tool-group-title {
  font-size: 9px;
  color: #aeb4bf;
  text-align: center;
  letter-spacing: 0.1px;
  padding-bottom: 2px;
  border-bottom: 1px solid #454545;
}
.tool-group + .tool-group {
  margin-top: 2px;
  border-top: 1px solid #3b3b3b;
  padding-top: 6px;
}
.rail-btn {
  border: 1px solid #4f5560;
  background: linear-gradient(#49505d, #3e4551);
  color: #ececec;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1;
  padding: 0;
  cursor: pointer;
}
.rail-btn:hover {
  background: linear-gradient(#566073, #475366);
}
.rail-btn.active {
  background: linear-gradient(#4b79ad, #3e6693);
  border-color: #79a2d0;
  color: #fff;
}
.icon-btn {
  width: 100%;
  aspect-ratio: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px;
}
.icon-cell {
  width: 100%;
  height: 100%;
  border: 1px solid rgba(205, 218, 238, 0.28);
  border-radius: 2px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.2px;
  color: #e8eef9;
  background: rgba(0, 0, 0, 0.18);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  position: relative;
}
.icon-cell::before,
.icon-cell::after {
  content: '';
  position: absolute;
}
.icon-move::before {
  left: 3px;
  right: 3px;
  top: 9px;
  height: 2px;
  background: #cfe4ff;
}
.icon-move::after {
  top: 3px;
  bottom: 3px;
  left: 9px;
  width: 2px;
  background: #cfe4ff;
}
.icon-rotate::before {
  inset: 4px;
  border: 2px solid #cfe4ff;
  border-right-color: transparent;
  border-radius: 50%;
}
.icon-rotate::after {
  right: 3px;
  top: 5px;
  border-left: 4px solid #cfe4ff;
  border-top: 3px solid transparent;
  border-bottom: 3px solid transparent;
}
.icon-scale::before {
  left: 4px;
  top: 4px;
  width: 12px;
  height: 12px;
  border: 2px solid #cfe4ff;
}
.icon-v1::before {
  inset: 4px;
  border: 2px solid #cfe4ff;
}
.icon-v2::before {
  left: 3px;
  top: 4px;
  width: 14px;
  height: 12px;
  border: 2px solid #cfe4ff;
}
.icon-v2::after {
  top: 4px;
  bottom: 4px;
  left: 9px;
  width: 2px;
  background: #cfe4ff;
}
.icon-v3::before {
  left: 3px;
  top: 4px;
  width: 14px;
  height: 12px;
  border: 2px solid #cfe4ff;
}
.icon-v3::after {
  top: 4px;
  bottom: 4px;
  left: 9px;
  width: 2px;
  background: #cfe4ff;
  box-shadow: 0 4px 0 0 #cfe4ff;
}
.icon-v4::before {
  left: 3px;
  top: 4px;
  width: 14px;
  height: 12px;
  border: 2px solid #cfe4ff;
}
.icon-v4::after {
  top: 4px;
  bottom: 4px;
  left: 9px;
  width: 2px;
  background: #cfe4ff;
  box-shadow: -6px 6px 0 0 #cfe4ff, 6px 6px 0 0 #cfe4ff;
}
.statusbar {
  flex: 0 0 auto;
  border-top: 1px solid #545454;
  background: linear-gradient(#3a3a3a, #313131);
  color: #d8d8d8;
  font-size: 0.82rem;
  line-height: 1.2;
  padding: 8px 12px 7px;
  letter-spacing: 0.1px;
}
.status-loading {
  color: #b7d7ff;
}
.status-ok {
  color: #bfe7bf;
}
.status-error {
  color: #f2b2b2;
}
</style>
