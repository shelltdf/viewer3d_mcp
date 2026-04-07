<script setup>
import { onMounted, onUnmounted, reactive, ref } from 'vue'
import PlantViewport from './components/PlantViewport.vue'
import { defaultPlantParams } from './plant/proceduralTree.js'
import { defaultEnvSettings, defaultWindSettings } from './plant/sceneSettings.js'

const LS_LEFT_OPEN = 'plant-studio.dock.leftOpen'
const LS_RIGHT_OPEN = 'plant-studio.dock.rightOpen'
const LS_LEFT_W = 'plant-studio.dock.leftWidth'
const LS_RIGHT_W = 'plant-studio.dock.rightWidth'

function readLsBool(key, defaultVal) {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return defaultVal
    return v === '1' || v === 'true'
  } catch {
    return defaultVal
  }
}

function readLsNum(key, defaultVal, min, max) {
  try {
    const n = Number(localStorage.getItem(key))
    if (!Number.isFinite(n)) return defaultVal
    return Math.min(max, Math.max(min, n))
  } catch {
    return defaultVal
  }
}

const params = reactive(defaultPlantParams())
const env = reactive(defaultEnvSettings())
const wind = reactive(defaultWindSettings())
const viewportRef = ref(null)
const stats = ref({ branchSegments: 0, leafInstances: 0 })

const leftDockOpen = ref(readLsBool(LS_LEFT_OPEN, true))
const rightDockOpen = ref(readLsBool(LS_RIGHT_OPEN, true))
const leftDockWidth = ref(readLsNum(LS_LEFT_W, 280, 200, 520))
const rightDockWidth = ref(readLsNum(LS_RIGHT_W, 360, 240, 600))

function persistDock() {
  try {
    localStorage.setItem(LS_LEFT_OPEN, leftDockOpen.value ? '1' : '0')
    localStorage.setItem(LS_RIGHT_OPEN, rightDockOpen.value ? '1' : '0')
    localStorage.setItem(LS_LEFT_W, String(Math.round(leftDockWidth.value)))
    localStorage.setItem(LS_RIGHT_W, String(Math.round(rightDockWidth.value)))
  } catch {
    /* ignore */
  }
}

/** @type {'left' | 'right' | null} */
let dragKind = null
let dragStartX = 0
let dragStartW = 0

function startDragLeft(e) {
  if (!leftDockOpen.value) return
  dragKind = 'left'
  dragStartX = e.clientX
  dragStartW = leftDockWidth.value
  e.preventDefault()
}

function startDragRight(e) {
  if (!rightDockOpen.value) return
  dragKind = 'right'
  dragStartX = e.clientX
  dragStartW = rightDockWidth.value
  e.preventDefault()
}

function onMove(e) {
  if (!dragKind) return
  if (dragKind === 'left') {
    const next = dragStartW + (e.clientX - dragStartX)
    leftDockWidth.value = Math.min(520, Math.max(200, next))
  } else {
    const next = dragStartW - (e.clientX - dragStartX)
    rightDockWidth.value = Math.min(600, Math.max(240, next))
  }
}

function endDrag() {
  if (dragKind) {
    dragKind = null
    persistDock()
  }
}

onMounted(() => {
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', endDrag)
  window.addEventListener('blur', endDrag)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', endDrag)
  window.removeEventListener('blur', endDrag)
})

function toggleLeftDock() {
  leftDockOpen.value = !leftDockOpen.value
  persistDock()
}

function toggleRightDock() {
  rightDockOpen.value = !rightDockOpen.value
  persistDock()
}

function onStats(s) {
  stats.value = s
}

function randomizeSeed() {
  params.seed = Math.floor(Math.random() * 1_000_000_000)
}

function resetDefaults() {
  Object.assign(params, defaultPlantParams())
  Object.assign(env, defaultEnvSettings())
  Object.assign(wind, defaultWindSettings())
}

function fitView() {
  viewportRef.value?.fitCameraToPlant?.()
}

function exportGlb() {
  viewportRef.value?.exportGlb?.()
}
</script>

<template>
  <div class="app">
    <header class="bar">
      <div class="title-strip">
        <h1 class="title">植物工作室</h1>
        <p class="subtitle">单窗口 SDI · 页内客户区为三维视口；左右 Dock Area 与 IDE 侧栏独立</p>
      </div>
      <nav class="menu-bar" role="menubar" aria-label="主菜单">
        <details class="menu-dropdown">
          <summary class="menu-summary" title="视图菜单（无全局快捷键）">视图</summary>
          <div class="menu-panel" role="menu">
            <label class="menu-check">
              <input v-model="leftDockOpen" type="checkbox" @change="persistDock" />
              <span>场景 Dock（环境与光照、风）</span>
            </label>
            <label class="menu-check">
              <input v-model="rightDockOpen" type="checkbox" @change="persistDock" />
              <span>生成 Dock（生成、形态、统计）</span>
            </label>
          </div>
        </details>
        <div class="menu-fill" />
        <button type="button" class="menu-action" title="适配视图（无全局快捷键）" @click="fitView">
          适配视图
        </button>
      </nav>
    </header>

    <div class="workspace">
      <!-- 左侧 Dock Area：折叠按钮条 → Dock View → 分割条（规范阅读顺序） -->
      <div
        class="dock-area dock-area-left"
        :class="{ 'dock-area-all-collapsed': !leftDockOpen }"
        data-dock-area="left"
      >
        <div class="dock-button-bar dock-button-bar-left" role="toolbar" aria-label="左侧停靠按钮条">
          <button
            type="button"
            class="dock-button"
            :class="{ 'dock-button-expanded': leftDockOpen }"
            :title="
              (leftDockOpen ? '折叠' : '展开') + '场景 Dock（无全局快捷键）'
            "
            @click="toggleLeftDock"
          >
            场景
          </button>
        </div>
        <div
          v-show="leftDockOpen"
          class="dock-view dock-view-left"
          :style="{ width: leftDockWidth + 'px' }"
        >
          <div class="dock-view-inner">
            <div class="dock-title">场景</div>
            <section class="section">
              <h2>环境与光照</h2>
              <label class="field">
                <span>背景色</span>
                <input v-model="env.background" type="color" class="color" />
              </label>
              <label class="field">
                <span>地面色</span>
                <input v-model="env.groundColor" type="color" class="color" />
              </label>
              <label class="field">
                <span>曝光 {{ env.exposure.toFixed(2) }}</span>
                <input v-model.number="env.exposure" type="range" min="0.2" max="3" step="0.02" />
              </label>
              <label class="field">
                <span>色调映射</span>
                <select v-model="env.toneMapping" class="select">
                  <option value="aces">ACES 电影</option>
                  <option value="neutral">Neutral</option>
                  <option value="linear">Linear</option>
                  <option value="reinhard">Reinhard</option>
                  <option value="cineon">Cineon</option>
                </select>
              </label>
              <label class="field check">
                <input v-model="env.shadowEnabled" type="checkbox" />
                <span>方向光阴影</span>
              </label>
              <label class="field">
                <span>环境光颜色</span>
                <input v-model="env.ambientColor" type="color" class="color" />
              </label>
              <label class="field">
                <span>环境光强度 {{ env.ambientIntensity.toFixed(2) }}</span>
                <input v-model.number="env.ambientIntensity" type="range" min="0" max="1.5" step="0.02" />
              </label>
              <label class="field">
                <span>半球天空</span>
                <input v-model="env.hemiSky" type="color" class="color" />
              </label>
              <label class="field">
                <span>半球地面反射</span>
                <input v-model="env.hemiGround" type="color" class="color" />
              </label>
              <label class="field">
                <span>半球光强度 {{ env.hemiIntensity.toFixed(2) }}</span>
                <input v-model.number="env.hemiIntensity" type="range" min="0" max="1.5" step="0.02" />
              </label>
              <label class="field">
                <span>主光颜色</span>
                <input v-model="env.sunColor" type="color" class="color" />
              </label>
              <label class="field">
                <span>主光强度 {{ env.sunIntensity.toFixed(2) }}</span>
                <input v-model.number="env.sunIntensity" type="range" min="0" max="3" step="0.05" />
              </label>
              <label class="field">
                <span>主光方位角 {{ env.sunAzimuthDeg }}°</span>
                <input v-model.number="env.sunAzimuthDeg" type="range" min="0" max="360" step="1" />
              </label>
              <label class="field">
                <span>主光高度角 {{ env.sunElevationDeg }}°</span>
                <input v-model.number="env.sunElevationDeg" type="range" min="5" max="89" step="1" />
              </label>
              <label class="field">
                <span>补光颜色</span>
                <input v-model="env.fillColor" type="color" class="color" />
              </label>
              <label class="field">
                <span>补光强度 {{ env.fillIntensity.toFixed(2) }}</span>
                <input v-model.number="env.fillIntensity" type="range" min="0" max="2" step="0.02" />
              </label>
            </section>

            <section class="section">
              <h2>风</h2>
              <label class="field check">
                <input v-model="wind.enabled" type="checkbox" />
                <span>启用风动</span>
              </label>
              <label class="field">
                <span>强度 {{ wind.strength.toFixed(2) }}</span>
                <input v-model.number="wind.strength" type="range" min="0" max="1.5" step="0.02" />
              </label>
              <label class="field">
                <span>速度 {{ wind.speed.toFixed(2) }}</span>
                <input v-model.number="wind.speed" type="range" min="0.1" max="3" step="0.05" />
              </label>
              <label class="field">
                <span>树干参与 {{ (wind.trunkSway * 100).toFixed(0) }}%</span>
                <input v-model.number="wind.trunkSway" type="range" min="0" max="1" step="0.02" />
              </label>
              <p class="hint">叶片按实例叠加摆动；导出 GLB 前会短暂恢复静止姿态。</p>
            </section>
          </div>
        </div>
        <div
          v-show="leftDockOpen"
          class="splitter splitter-left"
          title="拖动调整场景 Dock 宽度（无全局快捷键）"
          @mousedown="startDragLeft"
        />
      </div>

      <div class="client-area">
        <PlantViewport ref="viewportRef" class="view" :params="params" :env="env" :wind="wind" @stats="onStats" />
      </div>

      <!-- 右侧 Dock Area：分割条 → Dock View → 折叠按钮条（贴窗口右缘） -->
      <div
        class="dock-area dock-area-right"
        :class="{ 'dock-area-all-collapsed': !rightDockOpen }"
        data-dock-area="right"
      >
        <div
          v-show="rightDockOpen"
          class="splitter splitter-right"
          title="拖动调整生成 Dock 宽度（无全局快捷键）"
          @mousedown="startDragRight"
        />
        <div
          v-show="rightDockOpen"
          class="dock-view dock-view-right"
          :style="{ width: rightDockWidth + 'px' }"
        >
          <div class="dock-view-inner">
            <div class="dock-title">生成</div>
            <section class="section">
              <div class="dock-actions">
                <button type="button" class="primary" title="随机种子（无全局快捷键）" @click="randomizeSeed">
                  随机种子
                </button>
                <button type="button" title="恢复默认（无全局快捷键）" @click="resetDefaults">恢复默认</button>
                <button type="button" title="导出 GLB（无全局快捷键）" @click="exportGlb">导出 GLB</button>
              </div>
              <label class="field">
                <span>种子</span>
                <input v-model.number="params.seed" type="number" min="0" step="1" />
              </label>
              <p class="hint">同一组参数下，种子决定分枝随机形态。</p>
            </section>

            <div class="dock-title dock-title-sub">形态</div>
            <section class="section">
              <h2>树干</h2>
              <label class="field">
                <span>高度 {{ params.trunkHeight.toFixed(2) }}</span>
                <input v-model.number="params.trunkHeight" type="range" min="0.5" max="12" step="0.1" />
              </label>
              <label class="field">
                <span>底半径 {{ params.trunkRadiusBottom.toFixed(3) }}</span>
                <input v-model.number="params.trunkRadiusBottom" type="range" min="0.02" max="0.6" step="0.01" />
              </label>
              <label class="field">
                <span>顶半径 {{ params.trunkRadiusTop.toFixed(3) }}</span>
                <input v-model.number="params.trunkRadiusTop" type="range" min="0.01" max="0.35" step="0.005" />
              </label>
              <label class="field">
                <span>冠下主枝数 {{ params.trunkSplits }}</span>
                <input v-model.number="params.trunkSplits" type="range" min="1" max="12" step="1" />
              </label>
            </section>

            <section class="section">
              <h2>分枝</h2>
              <label class="field">
                <span>最大递归深度 {{ params.maxDepth }}</span>
                <input v-model.number="params.maxDepth" type="range" min="0" max="12" step="1" />
              </label>
              <label class="field">
                <span>每节最大子枝 {{ params.maxBranches }}</span>
                <input v-model.number="params.maxBranches" type="range" min="1" max="6" step="1" />
              </label>
              <label class="field">
                <span>子枝长度比例 {{ params.lengthFactor.toFixed(2) }}</span>
                <input v-model.number="params.lengthFactor" type="range" min="0.35" max="0.95" step="0.01" />
              </label>
              <label class="field">
                <span>半径衰减 {{ params.radiusTaper.toFixed(2) }}</span>
                <input v-model.number="params.radiusTaper" type="range" min="0.35" max="0.95" step="0.01" />
              </label>
              <label class="field">
                <span>开张角 {{ params.spreadDeg }}°</span>
                <input v-model.number="params.spreadDeg" type="range" min="5" max="85" step="1" />
              </label>
              <label class="field">
                <span>向上偏好 {{ params.upBias.toFixed(2) }}</span>
                <input v-model.number="params.upBias" type="range" min="0" max="0.8" step="0.02" />
              </label>
              <label class="field">
                <span>首枝长度 {{ params.firstBranchLength.toFixed(2) }}</span>
                <input v-model.number="params.firstBranchLength" type="range" min="0.2" max="4" step="0.05" />
              </label>
              <label class="field">
                <span>最短枝长 {{ params.minBranchLength.toFixed(2) }}</span>
                <input v-model.number="params.minBranchLength" type="range" min="0.02" max="0.5" step="0.01" />
              </label>
            </section>

            <section class="section">
              <h2>叶片</h2>
              <label class="field">
                <span>每梢叶片数 {{ params.leavesPerTip }}</span>
                <input v-model.number="params.leavesPerTip" type="range" min="0" max="10" step="1" />
              </label>
              <label class="field">
                <span>叶片大小 {{ params.leafSize.toFixed(2) }}</span>
                <input v-model.number="params.leafSize" type="range" min="0.1" max="1.2" step="0.02" />
              </label>
              <label class="field">
                <span>大小随机 {{ params.leafSizeJitter.toFixed(2) }}</span>
                <input v-model.number="params.leafSizeJitter" type="range" min="0" max="1" step="0.05" />
              </label>
            </section>

            <section class="section stats">
              <h2>统计</h2>
              <p>树干+枝段：{{ stats.branchSegments }}</p>
              <p>叶片实例数：{{ stats.leafInstances }}</p>
            </section>
          </div>
        </div>
        <div class="dock-button-bar dock-button-bar-right" role="toolbar" aria-label="右侧停靠按钮条">
          <button
            type="button"
            class="dock-button"
            :class="{ 'dock-button-expanded': rightDockOpen }"
            :title="
              (rightDockOpen ? '折叠' : '展开') + '生成 Dock（无全局快捷键）'
            "
            @click="toggleRightDock"
          >
            生成
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.bar {
  flex: 0 0 auto;
  border-bottom: 1px solid #2a3140;
  background: #161b24;
}

.title-strip {
  padding: 10px 16px 6px;
}

.title {
  margin: 0;
  font-size: 1.15rem;
  font-weight: 600;
}

.subtitle {
  margin: 4px 0 0;
  font-size: 0.8rem;
  color: #8a93a8;
}

.menu-bar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px 8px;
  border-top: 1px solid #252b38;
}

.menu-fill {
  flex: 1;
}

.menu-dropdown {
  position: relative;
}

.menu-summary {
  list-style: none;
  cursor: pointer;
  padding: 6px 12px;
  border-radius: 4px;
  font-size: 0.875rem;
  color: #c8d0dc;
  user-select: none;
}

.menu-summary::-webkit-details-marker {
  display: none;
}

.menu-summary:hover {
  background: #252b38;
}

.menu-panel {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 50;
  min-width: 220px;
  margin-top: 2px;
  padding: 8px 10px;
  background: #1a1f2a;
  border: 1px solid #2a3140;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.menu-check {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 4px;
  font-size: 0.85rem;
  color: #b4bcc9;
  cursor: pointer;
}

.menu-check input {
  margin-top: 2px;
}

.menu-action {
  padding: 6px 12px;
  border-radius: 4px;
  border: 1px solid #3d4a60;
  background: #252b38;
  color: #e8eaef;
  font-size: 0.875rem;
  cursor: pointer;
}

.menu-action:hover {
  background: #323a4d;
}

.workspace {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  min-width: 0;
}

/* Dock Area：按钮条与 Dock View 为兄弟，排版正交 */
.dock-area {
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
  min-height: 0;
  align-items: stretch;
}

.dock-area-left {
  border-right: none;
}

.dock-area-right {
  flex-direction: row;
}

.dock-button-bar {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  width: 30px;
  background: #0e1117;
  border-color: #2a3140;
  border-style: solid;
  align-items: center;
  padding: 6px 0;
  gap: 6px;
}

.dock-button-bar-left {
  border-right-width: 1px;
}

.dock-button-bar-right {
  border-left-width: 1px;
}

.dock-button {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  transform: rotate(180deg);
  padding: 10px 4px;
  margin: 0;
  border: none;
  border-radius: 4px;
  background: #1e2430;
  color: #8a93a8;
  font-size: 0.72rem;
  font-weight: 600;
  letter-spacing: 0.06em;
  cursor: pointer;
  line-height: 1.2;
}

.dock-button:hover {
  background: #2a3148;
  color: #c8d0dc;
}

.dock-button-expanded {
  background: #2d4a6e;
  color: #e8eef5;
}

.dock-view {
  flex-shrink: 0;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dock-view-left {
  background: #12161c;
  border-right: 1px solid #2a3140;
}

.dock-view-right {
  background: #141820;
  border-left: 1px solid #2a3140;
}

.dock-view-inner {
  flex: 1;
  overflow: auto;
  padding: 10px 12px;
}

.splitter {
  flex-shrink: 0;
  width: 5px;
  cursor: col-resize;
  background: #1a1f2a;
  border-left: 1px solid #2a3140;
  border-right: 1px solid #2a3140;
}

.splitter:hover {
  background: #2d6a4f;
}

/* 全折叠：不展示可调分割条（由 v-show 控制，此类可留作语义） */
.dock-area-all-collapsed .splitter {
  display: none;
}

.client-area {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
}

.view {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.dock-title {
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #5c6578;
  margin: 0 0 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid #2a3140;
}

.dock-title-sub {
  margin-top: 4px;
  margin-bottom: 6px;
  padding-bottom: 4px;
  font-size: 0.65rem;
  color: #6b7588;
}

.dock-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}

.dock-actions button {
  flex: 1 1 auto;
  min-width: 5.5rem;
}

.section {
  margin-bottom: 18px;
}

.section h2 {
  margin: 0 0 10px;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #6b7588;
}

.field {
  display: block;
  margin-bottom: 10px;
}

.field span {
  display: block;
  font-size: 0.8rem;
  margin-bottom: 4px;
  color: #b4bcc9;
}

.hint {
  margin: 6px 0 0;
  font-size: 0.75rem;
  color: #6b7588;
  line-height: 1.4;
}

.stats p {
  margin: 4px 0;
  font-size: 0.85rem;
  color: #9aa3b2;
}

.select {
  width: 100%;
  padding: 0.4rem 0.5rem;
  border-radius: 6px;
  border: 1px solid #2a3140;
  background: #1a1f2a;
  color: inherit;
  font-size: 0.875rem;
}

input.color {
  width: 100%;
  height: 32px;
  padding: 2px;
  border-radius: 6px;
  border: 1px solid #2a3140;
  background: #1a1f2a;
  cursor: pointer;
}

.field.check {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-direction: row;
}

.field.check span {
  margin-bottom: 0;
}

.field.check input[type='checkbox'] {
  width: auto;
  margin: 0;
}

@media (max-width: 900px) {
  .workspace {
    flex-direction: column;
  }

  .dock-area {
    flex-direction: column;
    width: 100% !important;
  }

  .dock-button-bar {
    flex-direction: row;
    width: 100%;
    height: auto;
    padding: 6px 8px;
    justify-content: flex-start;
  }

  .dock-button {
    writing-mode: horizontal-tb;
    transform: none;
    padding: 8px 14px;
  }

  .dock-view {
    width: 100% !important;
    max-height: 38vh;
  }

  .splitter {
    display: none;
  }

  .client-area {
    flex: 1;
    min-height: 42vh;
  }
}
</style>
