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
const hierarchyTree = ref([])
const selectedText = ref('未选择对象')
const selectedPath = ref('')
const expandedTree = reactive({})

const subspeciesOptions = computed(() => CREATURE_SUBSPECIES[params.kind] ?? [])

/** 与 params 分离，避免深度 watch 误判；由视口每帧对整模根节点应用 */
const animationPreset = ref('none')

/** 是否启动物理解算（刚体在生成角色时已创建；与视口 v-model 同步） */
const ragdollEnabled = ref(false)

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

async function screenshotToClipboard() {
  try {
    await viewportRef.value?.captureScreenshotToClipboard?.()
    alert('截图已复制到剪贴板，可直接粘贴给 AI。')
  } catch (e) {
    alert('截图失败：' + (e?.message || String(e)))
  }
}

function onStats(s) {
  stats.value = s
}

function onHierarchy(tree) {
  hierarchyTree.value = Array.isArray(tree) ? tree : []
  function mark(nodes) {
    for (const n of nodes || []) {
      if (expandedTree[n.id] == null) expandedTree[n.id] = n.depth == null ? true : n.depth < 1
      if (n.children?.length) mark(n.children)
    }
  }
  mark(hierarchyTree.value)
}

function onSelection(sel) {
  selectedPath.value = sel?.path || ''
  selectedText.value = sel?.text || '未选择对象'
}

const flatHierarchy = computed(() => {
  const out = []
  function walk(nodes, depth) {
    for (const n of nodes || []) {
      out.push({ ...n, depth })
      if (n.children?.length && expandedTree[n.id] !== false) walk(n.children, depth + 1)
    }
  }
  walk(hierarchyTree.value, 0)
  return out
})

function toggleTreeNode(node, ev) {
  ev?.stopPropagation?.()
  if (!node?.children?.length) return
  expandedTree[node.id] = expandedTree[node.id] === false
}

function selectHierarchyNode(node) {
  const id = node?.id
  if (!id) return
  viewportRef.value?.selectByPath?.(id)
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
        <button
          type="button"
          class="menu-btn"
          :class="{ 'menu-btn-on': ragdollEnabled }"
          :title="
            (ragdollEnabled ? '停止' : '启动') +
            '物理解算（刚体已在生成时建立；关闭时刚体仍随骨骼运动，可与「物理显示」看线框）'
          "
          @click="ragdollEnabled = !ragdollEnabled"
        >
          物理布娃娃
        </button>
        <button type="button" class="menu-btn" title="截图到剪贴板（PNG）" @click="screenshotToClipboard">
          截图到剪贴板
        </button>
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
            <p class="stat-line hint" style="margin-top: 6px">
              角色显示（与视口右上角同源）：蒙皮模型、骨骼辅助体、物理碰撞线框。
            </p>
            <label class="field menu-check">
              <input v-model="params.showCreatureModel" type="checkbox" />
              <span>显示模型（SkinnedMesh）</span>
            </label>
            <label class="field menu-check">
              <input v-model="params.showSkeleton" type="checkbox" />
              <span>显示骨骼（关节球与骨线）</span>
            </label>
            <label class="field menu-check">
              <input v-model="params.showCreaturePhysics" type="checkbox" />
              <span>显示物理（布娃娃碰撞线框）</span>
            </label>
            <label class="field menu-check">
              <input v-model="params.showCreatureHitbox" type="checkbox" />
              <span>显示 hitbox（每关节）</span>
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
              <label v-if="params.subspecies === 'horse'" class="field">
                <span>马模型来源</span>
                <select v-model="params.horseWorkflow" class="select">
                  <option value="procedural">程序图元（当前）</option>
                  <option value="zbrush">ZBrush 风格球团（算法）</option>
                </select>
              </label>
              <p v-if="params.subspecies === 'horse' && params.horseWorkflow === 'zbrush'" class="stat-line hint">
                根据骨骼节点关系生成重叠球团体块（类似 ZBrush blocking），再自动蒙皮。
              </p>
              <label v-if="params.subspecies === 'horse' && params.horseWorkflow === 'zbrush'" class="field">
                <span>Quad 重建密度</span>
                <select v-model="params.zbrushQuadDensity" class="select">
                  <option value="auto">自动（推荐）</option>
                  <option value="low">低（更快）</option>
                  <option value="medium">中（默认）</option>
                  <option value="high">高（更细）</option>
                </select>
              </label>
              <label v-if="params.subspecies === 'horse' && params.horseWorkflow === 'zbrush'" class="field menu-check">
                <input v-model="params.zbrushUseClosedSurface" type="checkbox" />
                <span>使用连续闭合壳体（关闭可观察原始球团）</span>
              </label>
              <label v-if="params.subspecies === 'horse' && params.horseWorkflow === 'zbrush' && params.zbrushUseClosedSurface" class="field">
                <span>壳体融合强度</span>
                <select v-model="params.zbrushSurfaceBlend" class="select">
                  <option value="low">低（更贴球团）</option>
                  <option value="medium">中（默认）</option>
                  <option value="high">高（更平滑）</option>
                </select>
              </label>
              <label v-if="params.subspecies === 'horse' && params.horseWorkflow === 'zbrush' && params.zbrushUseClosedSurface" class="field">
                <span>壳体膨胀值 {{ Number(params.zbrushShellInflate || 0).toFixed(2) }}</span>
                <input v-model.number="params.zbrushShellInflate" type="range" min="-0.2" max="0.2" step="0.01" />
              </label>
              <label v-if="params.subspecies === 'horse' && params.horseWorkflow === 'zbrush' && params.zbrushUseClosedSurface" class="field menu-check">
                <input v-model="params.zbrushAutoMatchVolume" type="checkbox" />
                <span>自动匹配体积</span>
              </label>
              <label v-if="params.subspecies === 'horse' && params.horseWorkflow === 'zbrush' && params.zbrushUseClosedSurface && params.zbrushAutoMatchVolume" class="field">
                <span>体积误差目标 ±{{ Number(params.zbrushVolumeErrorTarget || 0).toFixed(1) }}%</span>
                <input v-model.number="params.zbrushVolumeErrorTarget" type="range" min="2" max="20" step="0.5" />
              </label>
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
            <p v-if="stats.volumeErrorPct != null" class="stat-line">
              壳体体积误差：{{ Number(stats.volumeErrorPct).toFixed(2) }}%
              <span v-if="stats.volumeAutoMatched">（已自动匹配）</span>
            </p>
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
          v-model:ragdoll-enabled="ragdollEnabled"
          class="view"
          :params="params"
          @stats="onStats"
          @hierarchy="onHierarchy"
          @selection="onSelection"
        />
      </div>
      <aside class="dock-area-right">
        <div class="dock-right">
          <div class="dock-inner">
            <div class="dock-head">层级</div>
            <button
              v-for="n in flatHierarchy"
              :key="n.id"
              type="button"
              class="tree-row"
              :class="{ 'tree-row-active': selectedPath === n.id || selectedPath.endsWith('/' + n.name) }"
              :style="{ paddingLeft: 8 + n.depth * 14 + 'px' }"
              @click="selectHierarchyNode(n)"
            >
              <span
                class="tree-twisty"
                :class="{ 'tree-twisty-empty': !n.children?.length }"
                @click="toggleTreeNode(n, $event)"
              >
                {{ n.children?.length ? (expandedTree[n.id] === false ? '▸' : '▾') : '·' }}
              </span>
              {{ n.kind === 'bone' ? '🦴' : n.kind?.includes('hitbox') || n.kind === 'physics' ? '📦' : '◼' }} {{ n.name }}
            </button>
            <div class="dock-head">当前选中</div>
            <pre class="selected-text">{{ selectedText }}</pre>
          </div>
        </div>
      </aside>
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

.menu-btn-on {
  background: #2d4a6e;
  border-color: #4a7ab0;
  color: #e8eef5;
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

.dock-area-right {
  width: 280px;
  flex-shrink: 0;
  border-left: 1px solid #2a3140;
  background: #12161c;
  min-height: 0;
}

.dock-right {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.tree-row {
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: #c8d0dc;
  font-size: 12px;
  line-height: 1.35;
  padding: 3px 8px;
  cursor: pointer;
}

.tree-row:hover {
  background: rgba(80, 98, 126, 0.25);
}

.tree-row-active {
  background: rgba(54, 106, 168, 0.38);
  color: #edf3fb;
}

.tree-twisty {
  display: inline-block;
  width: 1rem;
  margin-right: 2px;
  color: #8ea0bb;
}

.tree-twisty-empty {
  opacity: 0.45;
}

.selected-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 12px;
  color: #d2dae7;
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

  .dock-area-right {
    width: 100%;
    max-height: 40vh;
    border-left: none;
    border-top: 1px solid #2a3140;
  }
}
</style>
