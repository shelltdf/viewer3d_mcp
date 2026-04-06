<script setup>
import { computed } from 'vue'
import { layoutSceneResourceGraph } from '../utils/sceneResourceGraph.js'

const props = defineProps({
  panel: { type: String, default: 'source' },
  sceneRevision: { type: Number, default: 0 },
  /** () => buildSceneResourceGraph root 的原始结果 */
  getGraph: { type: Function, required: true },
})

const rawGraph = computed(() => {
  void props.sceneRevision
  try {
    return props.getGraph?.(props.panel) ?? null
  } catch {
    return null
  }
})

const laidOut = computed(() => {
  const raw = rawGraph.value
  if (!raw?.nodes?.length) return null
  try {
    return layoutSceneResourceGraph(raw)
  } catch {
    return null
  }
})

const edgeStyle = {
  hierarchy: { stroke: '#6b94c4', opacity: 0.65 },
  meshMat: { stroke: '#7fbc7a', opacity: 0.55 },
  matTex: { stroke: '#d4a85c', opacity: 0.55 },
}

const kindStyle = {
  scene: { fill: '#283547', stroke: '#5a6d8a' },
  mesh: { fill: '#243d32', stroke: '#5a8f72' },
  material: { fill: '#322838', stroke: '#8a6d9a' },
  texture: { fill: '#3d3528', stroke: '#a88b45' },
}

function edgePath(fromId, toId, kind, pos) {
  const a = pos.get(fromId)
  const b = pos.get(toId)
  if (!a || !b) return ''

  if (Math.abs(a.cx - b.cx) < 8) {
    const ox = a.xR + 14
    return `M ${a.xR} ${a.cy} L ${ox} ${a.cy} L ${ox} ${b.cy} L ${b.x} ${b.cy}`
  }

  const mid = (a.xR + b.x) * 0.5
  return `M ${a.xR} ${a.cy} C ${mid} ${a.cy}, ${mid} ${b.cy}, ${b.x} ${b.cy}`
}
</script>

<template>
  <section class="refg-sec">
    <h3 class="refg-title">资源引用关系图</h3>
    <p class="refg-hint">
      左→右：场景节点（至 Mesh 的祖先链与子层）→ 可渲染 Mesh → 材质 → 贴图槽。同一贴图可连多条边到不同材质；同一材质可连多条边到不同
      Mesh。单条 Mesh 在 Three.js 中仅有一个父节点；若导出层叠了多个 Mesh，则表现为父 Mesh → 子 Mesh。
    </p>
    <p v-if="rawGraph && !laidOut" class="refg-empty">
      当前侧无场景或未找到带几何体的 Mesh，无可绘制引用关系。
    </p>
    <template v-else-if="laidOut">
    <div class="refg-stats">
      场景节点 {{ laidOut.stats.sceneNodes }} · Mesh {{ laidOut.stats.meshes }} · 材质
      {{ laidOut.stats.materials }} · 贴图 {{ laidOut.stats.textures }} · 边
      {{ laidOut.edges.length }}
    </div>
    <div class="refg-scroll">
      <svg
        class="refg-svg"
        :viewBox="`0 0 ${laidOut.layout.width} ${laidOut.layout.height}`"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <marker
            id="refg-arrow"
            markerWidth="8"
            markerHeight="8"
            refX="7"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L8,4 L0,8 z" fill="#7a8699" opacity="0.85" />
          </marker>
        </defs>

        <g v-for="(e, i) in laidOut.edges" :key="i" class="refg-edge-g">
          <path
            :d="edgePath(e.from, e.to, e.kind, laidOut.layout.pos)"
            fill="none"
            :stroke="edgeStyle[e.kind]?.stroke || '#888'"
            stroke-width="1.1"
            :opacity="edgeStyle[e.kind]?.opacity ?? 0.5"
            marker-end="url(#refg-arrow)"
          />
        </g>

        <g v-for="n in laidOut.nodes" :key="n.id" class="refg-node-g">
          <title>{{ n.type }} · {{ n.uuid }}</title>
          <rect
            :x="n.x"
            :y="n.y"
            :width="n.w"
            :height="n.h"
            rx="4"
            :fill="kindStyle[n.kind]?.fill || '#333'"
            :stroke="kindStyle[n.kind]?.stroke || '#666'"
            stroke-width="1"
          />
          <text
            :x="n.x + 6"
            :y="n.y + 15"
            fill="#d8dee9"
            font-size="10"
            font-family="system-ui, Segoe UI, sans-serif"
          >
            {{ n.label }}
          </text>
        </g>

        <g class="refg-col-hdrs">
          <text
            v-for="(lbl, c) in laidOut.columnLabels"
            :key="c"
            :x="18 + c * (188 + 32)"
            y="14"
            fill="#9fb3d6"
            font-size="11"
            font-weight="600"
            font-family="system-ui, Segoe UI, sans-serif"
          >
            {{ lbl }}
          </text>
        </g>
      </svg>
    </div>
    <div class="refg-legend">
      <span><i class="lg hierarchy" /> 场景 / Mesh 层链</span>
      <span><i class="lg meshMat" /> Mesh → 材质</span>
      <span><i class="lg matTex" /> 材质 → 贴图</span>
    </div>
    </template>
  </section>
</template>

<style scoped>
.refg-sec {
  margin-bottom: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid #3d4654;
}
.refg-title {
  margin: 0 0 6px;
  font-size: 12px;
  color: #9fb3d6;
}
.refg-hint {
  margin: 0 0 8px;
  font-size: 10px;
  color: #7a8699;
  line-height: 1.45;
}
.refg-stats {
  margin-bottom: 8px;
  font-size: 10px;
  color: #8e97a6;
}
.refg-scroll {
  overflow: auto;
  max-height: 420px;
  border: 1px solid #3a4558;
  border-radius: 6px;
  background: #161a20;
}
.refg-svg {
  display: block;
  min-width: 100%;
  min-height: 120px;
}
.refg-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 10px;
  font-size: 10px;
  color: #8e97a6;
}
.refg-legend .lg {
  display: inline-block;
  width: 22px;
  height: 3px;
  margin-right: 4px;
  vertical-align: middle;
  border-radius: 1px;
}
.refg-legend .lg.hierarchy {
  background: #6b94c4;
}
.refg-legend .lg.meshMat {
  background: #7fbc7a;
}
.refg-legend .lg.matTex {
  background: #d4a85c;
}
.refg-empty {
  margin: 0 0 8px;
  font-size: 11px;
  color: #8e97a6;
}
</style>
