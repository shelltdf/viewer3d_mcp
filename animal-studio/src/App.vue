<script setup>
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import CreatureViewport from './components/CreatureViewport.vue'
import {
  CREATURE_KINDS,
  CREATURE_SUBSPECIES,
  defaultCreatureParams,
  applySubspeciesPreset,
} from './creature/proceduralCreature.js'
import { CREATURE_ANIMATIONS } from './creature/proceduralAnimations.js'

const LS_OPEN = 'animal-studio.dock.paramsOpen'
const LS_W = 'animal-studio.dock.paramsWidth'

function readLsBool(key, d) {
  try {
    const v = localStorage.getItem(key)
    if (v === null) return d
    return v === '1' || v === 'true'
  } catch {
    return d
  }
}

function readLsNum(key, d, min, max) {
  try {
    const n = Number(localStorage.getItem(key))
    if (!Number.isFinite(n)) return d
    return Math.min(max, Math.max(min, n))
  } catch {
    return d
  }
}

const params = reactive(defaultCreatureParams('quadruped'))
const viewportRef = ref(null)
const stats = ref({ parts: 0, bones: 0 })

const subspeciesOptions = computed(() => CREATURE_SUBSPECIES[params.kind] ?? [])

/** 与 params 分离，避免深度 watch 误判；由视口每帧对整模根节点应用 */
const animationPreset = ref('none')

const dockOpen = ref(readLsBool(LS_OPEN, true))
const dockWidth = ref(readLsNum(LS_W, 300, 220, 480))

function persistDock() {
  try {
    localStorage.setItem(LS_OPEN, dockOpen.value ? '1' : '0')
    localStorage.setItem(LS_W, String(Math.round(dockWidth.value)))
  } catch {
    /* ignore */
  }
}

/** @type {'left' | null} */
let drag = null
let dragStartX = 0
let dragStartW = 0

function startDrag(e) {
  if (!dockOpen.value) return
  drag = 'left'
  dragStartX = e.clientX
  dragStartW = dockWidth.value
  e.preventDefault()
}

function onMove(e) {
  if (drag !== 'left') return
  dockWidth.value = Math.min(480, Math.max(220, dragStartW + (e.clientX - dragStartX)))
}

function endDrag() {
  if (drag) {
    drag = null
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

function toggleDock() {
  dockOpen.value = !dockOpen.value
  persistDock()
}

watch(
  () => params.kind,
  (k, prev) => {
    if (prev === undefined) return
    const seed = params.seed
    Object.assign(params, defaultCreatureParams(k))
    params.seed = seed
  },
)

watch(
  () => params.subspecies,
  () => {
    applySubspeciesPreset(params)
  },
)

function randomizeSeed() {
  params.seed = Math.floor(Math.random() * 1e9)
}

function resetParams() {
  const k = params.kind
  const seed = params.seed
  Object.assign(params, defaultCreatureParams(k))
  params.seed = seed
}

function fitView() {
  viewportRef.value?.fitCameraToCreature?.()
}

function exportCreatureZip() {
  viewportRef.value?.exportCreatureZip?.()
}

function onStats(s) {
  stats.value = s
}
</script>

<template>
  <div class="app">
    <header class="bar">
      <div class="title-strip">
        <h1 class="title">动物生成器</h1>
        <p class="subtitle">Vue 单窗口 SDI · 参数化粗模（示意形体，非解剖级）</p>
      </div>
      <nav class="menu-bar" role="menubar" aria-label="主菜单">
        <details class="menu-dropdown">
          <summary class="menu-summary" title="视图（无全局快捷键）">视图</summary>
          <div class="menu-panel">
            <label class="menu-check">
              <input v-model="dockOpen" type="checkbox" @change="persistDock" />
              <span>参数 Dock</span>
            </label>
          </div>
        </details>
        <div class="menu-fill" />
        <button type="button" class="menu-btn" title="适配视图（无全局快捷键）" @click="fitView">适配视图</button>
      </nav>
    </header>

    <div class="workspace">
      <div class="dock-area dock-area-left" :class="{ 'dock-collapsed': !dockOpen }">
        <div class="dock-button-bar" role="toolbar" aria-label="停靠按钮条">
          <button
            type="button"
            class="dock-button"
            :class="{ 'dock-button-on': dockOpen }"
            :title="(dockOpen ? '折叠' : '展开') + '参数（无全局快捷键）'"
            @click="toggleDock"
          >
            参数
          </button>
        </div>
        <div v-show="dockOpen" class="dock-view" :style="{ width: dockWidth + 'px' }">
          <div class="dock-inner">
            <div class="dock-head">类型与随机</div>
            <label class="field">
              <span>动物类型</span>
              <select v-model="params.kind" class="select">
                <option v-for="c in CREATURE_KINDS" :key="c.id" :value="c.id">{{ c.label }}</option>
              </select>
            </label>
            <label v-if="subspeciesOptions.length" class="field">
              <span>子物种（比例预设）</span>
              <select v-model="params.subspecies" class="select">
                <option v-for="s in subspeciesOptions" :key="s.id" :value="s.id">{{ s.label }}</option>
              </select>
            </label>
            <div class="row-btns">
              <button type="button" class="primary" title="随机种子（无全局快捷键）" @click="randomizeSeed">
                随机种子
              </button>
              <button type="button" title="重置当前类型参数（无全局快捷键）" @click="resetParams">重置参数</button>
              <button type="button" title="ZIP：model.glb（SkinnedMesh）+ 各 preset 的 animation_<id>.glb + manifest" @click="exportCreatureZip">导出 ZIP</button>
            </div>
            <label class="field">
              <span>种子</span>
              <input v-model.number="params.seed" type="number" min="0" step="1" />
            </label>

            <div class="dock-head">动作（程序化）</div>
            <label class="field">
              <span>预览动作</span>
              <select v-model="animationPreset" class="select">
                <option v-for="a in CREATURE_ANIMATIONS" :key="a.id" :value="a.id">{{ a.label }}</option>
              </select>
            </label>
            <p class="stat-line hint">视口左上角也有同一菜单。已为自动蒙皮（SkinnedMesh）；导出 ZIP 内每个动作单独一个 animation_*.glb。</p>

            <div class="dock-head">外观</div>
            <label class="field">
              <span>整体缩放 {{ params.scale.toFixed(2) }}</span>
              <input v-model.number="params.scale" type="range" min="0.35" max="2.2" step="0.02" />
            </label>
            <label class="field">
              <span>色相 {{ params.hue.toFixed(2) }}</span>
              <input v-model.number="params.hue" type="range" min="0" max="1" step="0.01" />
            </label>
            <label class="field">
              <span>饱和度 {{ params.saturation.toFixed(2) }}</span>
              <input v-model.number="params.saturation" type="range" min="0" max="1" step="0.02" />
            </label>
            <label class="field">
              <span>明度 {{ params.lightness.toFixed(2) }}</span>
              <input v-model.number="params.lightness" type="range" min="0.15" max="0.85" step="0.02" />
            </label>
            <label class="field menu-check">
              <input v-model="params.showSkeleton" type="checkbox" />
              <span>显示骨骼（连线与关节）</span>
            </label>

            <template v-if="params.kind === 'biped'">
              <div class="dock-head">两足</div>
              <label class="field"><span>躯干高</span><input v-model.number="params.torsoHeight" type="range" min="0.4" max="1.4" step="0.02" /></label>
              <label class="field"><span>肩宽</span><input v-model.number="params.shoulderWidth" type="range" min="0.25" max="0.65" step="0.02" /></label>
              <label class="field"><span>腿长</span><input v-model.number="params.legLength" type="range" min="0.4" max="1.4" step="0.02" /></label>
              <label class="field"><span>臂长</span><input v-model.number="params.armLength" type="range" min="0.35" max="1.1" step="0.02" /></label>
              <label class="field"><span>头大小</span><input v-model.number="params.headSize" type="range" min="0.12" max="0.35" step="0.01" /></label>
              <label class="field"><span>肢体粗细</span><input v-model.number="params.limbRadius" type="range" min="0.04" max="0.14" step="0.005" /></label>
            </template>

            <template v-if="params.kind === 'quadruped'">
              <div class="dock-head">四足</div>
              <label class="field"><span>体长</span><input v-model.number="params.bodyLength" type="range" min="0.4" max="1.2" step="0.02" /></label>
              <label class="field"><span>体高</span><input v-model.number="params.bodyHeight" type="range" min="0.2" max="0.55" step="0.02" /></label>
              <label class="field"><span>腿长</span><input v-model.number="params.legLength" type="range" min="0.25" max="0.75" step="0.02" /></label>
              <label class="field"><span>颈长</span><input v-model.number="params.neckLen" type="range" min="0.15" max="0.55" step="0.02" /></label>
              <label class="field"><span>头大小</span><input v-model.number="params.headSize" type="range" min="0.1" max="0.28" step="0.01" /></label>
              <label class="field"><span>尾长</span><input v-model.number="params.tailLen" type="range" min="0" max="0.55" step="0.02" /></label>
            </template>

            <template v-if="params.kind === 'fish'">
              <div class="dock-head">鱼类</div>
              <label class="field"><span>体长</span><input v-model.number="params.bodyLen" type="range" min="0.5" max="1.8" step="0.02" /></label>
              <label class="field"><span>体高</span><input v-model.number="params.bodyHeight" type="range" min="0.15" max="0.55" step="0.02" /></label>
              <label class="field"><span>尾展</span><input v-model.number="params.tailSpread" type="range" min="0.2" max="0.75" step="0.02" /></label>
              <label class="field"><span>背鳍</span><input v-model.number="params.finHeight" type="range" min="0.1" max="0.45" step="0.02" /></label>
            </template>

            <template v-if="params.kind === 'insect'">
              <div class="dock-head">昆虫</div>
              <label class="field"><span>体节数</span><input v-model.number="params.segmentCount" type="range" min="2" max="5" step="1" /></label>
              <label class="field"><span>体节半径</span><input v-model.number="params.segmentRadius" type="range" min="0.06" max="0.2" step="0.01" /></label>
              <label class="field"><span>足展</span><input v-model.number="params.legSpan" type="range" min="0.3" max="0.85" step="0.02" /></label>
              <label class="field"><span>翅展</span><input v-model.number="params.wingSpan" type="range" min="0.35" max="1.2" step="0.02" /></label>
            </template>

            <template v-if="params.kind === 'bird'">
              <div class="dock-head">鸟类</div>
              <label class="field"><span>躯体</span><input v-model.number="params.bodySize" type="range" min="0.15" max="0.45" step="0.01" /></label>
              <label class="field"><span>颈长</span><input v-model.number="params.neckLen" type="range" min="0.05" max="0.35" step="0.01" /></label>
              <label class="field"><span>头</span><input v-model.number="params.headSize" type="range" min="0.08" max="0.2" step="0.01" /></label>
              <label class="field"><span>翅展</span><input v-model.number="params.wingSpan" type="range" min="0.45" max="1.4" step="0.02" /></label>
              <label class="field"><span>腿</span><input v-model.number="params.legLen" type="range" min="0.12" max="0.38" step="0.01" /></label>
              <label class="field"><span>尾羽</span><input v-model.number="params.tailLen" type="range" min="0.05" max="0.45" step="0.02" /></label>
            </template>

            <template v-if="params.kind === 'reptile'">
              <div class="dock-head">爬行类</div>
              <label class="field"><span>躯干长</span><input v-model.number="params.bodyLen" type="range" min="0.5" max="1.4" step="0.02" /></label>
              <label class="field"><span>躯干高</span><input v-model.number="params.bodyH" type="range" min="0.12" max="0.38" step="0.01" /></label>
              <label class="field"><span>腿</span><input v-model.number="params.legLen" type="range" min="0.15" max="0.45" step="0.01" /></label>
              <label class="field"><span>尾长</span><input v-model.number="params.tailLen" type="range" min="0.3" max="1.4" step="0.02" /></label>
              <label class="field"><span>颈</span><input v-model.number="params.neckLen" type="range" min="0.1" max="0.4" step="0.02" /></label>
              <label class="field"><span>头长</span><input v-model.number="params.headLen" type="range" min="0.12" max="0.38" step="0.02" /></label>
            </template>

            <template v-if="params.kind === 'amphibian'">
              <div class="dock-head">两栖类</div>
              <label class="field"><span>体宽</span><input v-model.number="params.bodyW" type="range" min="0.35" max="0.85" step="0.02" /></label>
              <label class="field"><span>体高</span><input v-model.number="params.bodyH" type="range" min="0.12" max="0.38" step="0.01" /></label>
              <label class="field"><span>腿</span><input v-model.number="params.legLen" type="range" min="0.08" max="0.32" step="0.01" /></label>
              <label class="field"><span>头</span><input v-model.number="params.headSize" type="range" min="0.1" max="0.26" step="0.01" /></label>
            </template>

            <div class="dock-head">统计</div>
            <p class="stat-line">几何片数：{{ stats.parts }}</p>
            <p class="stat-line">骨骼关节数：{{ stats.bones }}</p>
          </div>
        </div>
        <div
          v-show="dockOpen"
          class="splitter"
          title="拖动调宽（无全局快捷键）"
          @mousedown="startDrag"
        />
      </div>

      <div class="client-area">
        <CreatureViewport
          ref="viewportRef"
          v-model:animation-preset="animationPreset"
          class="view"
          :params="params"
          @stats="onStats"
        />
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
  gap: 6px;
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
  z-index: 40;
  min-width: 200px;
  padding: 8px 10px;
  background: #1a1f2a;
  border: 1px solid #2a3140;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.menu-check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.85rem;
  color: #b4bcc9;
  cursor: pointer;
}

.menu-btn {
  padding: 6px 12px;
  border-radius: 4px;
  border: 1px solid #3d4a60;
  background: #252b38;
  color: #e8eaef;
  font-size: 0.875rem;
  cursor: pointer;
}

.menu-btn:hover {
  background: #323a4d;
}

.workspace {
  flex: 1;
  display: flex;
  flex-direction: row;
  min-height: 0;
  min-width: 0;
}

.dock-area {
  display: flex;
  flex-direction: row;
  flex-shrink: 0;
  align-items: stretch;
  min-height: 0;
}

.dock-button-bar {
  display: flex;
  flex-direction: column;
  width: 30px;
  flex-shrink: 0;
  background: #0e1117;
  border-right: 1px solid #2a3140;
  padding: 6px 0;
  align-items: center;
}

.dock-button {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  padding: 10px 4px;
  border: none;
  border-radius: 4px;
  background: #1e2430;
  color: #8a93a8;
  font-size: 0.72rem;
  font-weight: 600;
  cursor: pointer;
}

.dock-button-on {
  background: #2d4a6e;
  color: #e8eef5;
}

.dock-view {
  flex-shrink: 0;
  background: #12161c;
  border-right: 1px solid #2a3140;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.dock-inner {
  flex: 1;
  overflow: auto;
  padding: 10px 12px 16px;
}

.dock-head {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: #5c6578;
  margin: 12px 0 8px;
  padding-bottom: 4px;
  border-bottom: 1px solid #2a3140;
}

.dock-head:first-child {
  margin-top: 0;
}

.field {
  display: block;
  margin-bottom: 10px;
}

.field span {
  display: block;
  font-size: 0.78rem;
  margin-bottom: 4px;
  color: #b4bcc9;
}

.row-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 10px;
}

.row-btns button {
  flex: 1 1 auto;
  min-width: 4.5rem;
}

.stat-line {
  margin: 0;
  font-size: 0.85rem;
  color: #8a93a8;
}

.stat-line.hint {
  font-size: 0.72rem;
  line-height: 1.4;
  margin-top: 4px;
  opacity: 0.95;
}

.splitter {
  width: 5px;
  flex-shrink: 0;
  cursor: col-resize;
  background: #1a1f2a;
  border-right: 1px solid #2a3140;
}

.splitter:hover {
  background: #2d5a8a;
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

@media (max-width: 800px) {
  .workspace {
    flex-direction: column;
  }

  .dock-area {
    flex-direction: column;
    width: 100%;
  }

  .dock-button-bar {
    flex-direction: row;
    width: 100%;
    border-right: none;
    border-bottom: 1px solid #2a3140;
  }

  .dock-button {
    writing-mode: horizontal-tb;
    transform: none;
    padding: 8px 14px;
  }

  .dock-view {
    width: 100% !important;
    max-height: 40vh;
  }

  .splitter {
    display: none;
  }

  .client-area {
    min-height: 45vh;
  }
}
</style>
