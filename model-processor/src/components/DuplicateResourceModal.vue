<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  open: { type: Boolean, default: false },
  panel: { type: String, default: 'source' },
  getAnalysis: { type: Function, required: true },
})

const emit = defineEmits(['close', 'update:panel', 'merge'])

const selectedTexture = ref({})
const selectedMaterial = ref({})
const selectedMesh = ref({})

const analysis = computed(() => {
  try {
    return props.getAnalysis(props.panel) || null
  } catch {
    return null
  }
})

function resetSelectionsFromAnalysis() {
  const a = analysis.value
  const st = {}
  const sm = {}
  const sh = {}
  for (const g of a?.textureGroups || []) {
    st[g.id] = { on: false, keep: g.textures[0]?.uuid || '' }
  }
  for (const g of a?.materialGroups || []) {
    sm[g.id] = { on: false, keep: g.materials[0]?.uuid || '' }
  }
  for (const g of a?.meshGroups || []) {
    sh[g.id] = { on: false, keep: g.items[0]?.uuid || '' }
  }
  selectedTexture.value = st
  selectedMaterial.value = sm
  selectedMesh.value = sh
}

watch(
  () => [props.open, props.panel, analysis.value],
  () => {
    if (props.open) resetSelectionsFromAnalysis()
  },
  { immediate: true },
)

function fmtShortUuid(u) {
  return u ? u.slice(0, 8) : '—'
}

function onMerge() {
  const ops = []
  const a = analysis.value
  if (!a) return

  for (const g of a.textureGroups || []) {
    if (!selectedTexture.value[g.id]?.on) continue
    const keep = g.textures.find((t) => t.uuid === selectedTexture.value[g.id]?.keep) || g.textures[0]
    ops.push({ kind: 'texture', groupId: g.id, keepUuid: keep.uuid, textures: g.textures })
  }
  for (const g of a.materialGroups || []) {
    if (!selectedMaterial.value[g.id]?.on) continue
    const keep =
      g.materials.find((m) => m.uuid === selectedMaterial.value[g.id]?.keep) || g.materials[0]
    ops.push({ kind: 'material', groupId: g.id, keepUuid: keep.uuid, materials: g.materials })
  }
  for (const g of a.meshGroups || []) {
    if (!selectedMesh.value[g.id]?.on) continue
    const keepUuid = selectedMesh.value[g.id]?.keep || g.items[0]?.uuid
    ops.push({ kind: 'mesh', groupId: g.id, keepUuid, items: g.items })
  }

  if (!ops.length) return
  emit('merge', { panel: props.panel, ops })
}

</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="dup-root">
      <div class="dup-back" @click.self="emit('close')" />
      <div class="dup-panel" role="dialog">
        <header class="dup-head">
          <h2>重复资源共享</h2>
          <button type="button" class="dup-x" @click="emit('close')">×</button>
        </header>
        <div class="dup-toggle">
          <button
            type="button"
            class="dup-tab"
            :class="{ on: panel === 'source' }"
            @click="emit('update:panel', 'source')"
          >
            处理前
          </button>
          <button
            type="button"
            class="dup-tab"
            :class="{ on: panel === 'result' }"
            @click="emit('update:panel', 'result')"
          >
            处理后
          </button>
        </div>

        <div v-if="analysis" class="dup-body">
          <p class="dup-hint">
            以下为可合并分组：勾选要执行合并的分组，并在组内选择保留项（其余引用将指向保留资源或删除重复节点）。
          </p>

          <section v-if="analysis.textureGroups.length" class="dup-sec">
            <h3>贴图（{{ analysis.textureGroups.length }}）</h3>
            <div v-for="g in analysis.textureGroups" :key="g.id" class="grp">
              <label class="grp-head">
                <input v-model="selectedTexture[g.id].on" type="checkbox" />
                <span>分组 {{ g.id }}</span>
                <span class="grp-n">· {{ g.textures.length }} 张不同 Texture</span>
              </label>
              <p class="grp-reason">{{ g.reason }}</p>
              <div class="grp-keep">
                <span>保留</span>
                <select v-model="selectedTexture[g.id].keep" class="dup-sel">
                  <option v-for="t in g.textures" :key="t.uuid" :value="t.uuid">
                    {{ t.name || fmtShortUuid(t.uuid) }}（{{ t.uuid.slice(0, 8) }}）
                  </option>
                </select>
              </div>
              <ul class="grp-list">
                <li v-for="it in g.items" :key="it.uuid + it.slot + it.meshName">
                  {{ it.label }} · {{ it.meshName || 'mesh' }}
                </li>
              </ul>
            </div>
          </section>

          <section v-if="analysis.materialGroups.length" class="dup-sec">
            <h3>材质（{{ analysis.materialGroups.length }}）</h3>
            <div v-for="g in analysis.materialGroups" :key="g.id" class="grp">
              <label class="grp-head">
                <input v-model="selectedMaterial[g.id].on" type="checkbox" />
                <span>分组 {{ g.id }}</span>
                <span class="grp-n">· {{ g.materials.length }} 份等价 Material</span>
              </label>
              <p class="grp-reason">{{ g.reason }}</p>
              <div class="grp-keep">
                <span>保留</span>
                <select v-model="selectedMaterial[g.id].keep" class="dup-sel">
                  <option v-for="m in g.materials" :key="m.uuid" :value="m.uuid">
                    {{ m.name || m.type }}（{{ m.uuid.slice(0, 8) }}）
                  </option>
                </select>
              </div>
              <ul class="grp-list">
                <li v-for="it in g.items" :key="it.uuid + it.label">{{ it.label }}</li>
              </ul>
            </div>
          </section>

          <section v-if="analysis.meshGroups.length" class="dup-sec">
            <h3>Mesh 节点（{{ analysis.meshGroups.length }}）</h3>
            <p class="dup-warn">
              共享同一几何的多个节点：合并将从场景移除多余对象，不自动释放仍被其他 Mesh 使用的材质。
            </p>
            <div v-for="g in analysis.meshGroups" :key="g.id" class="grp">
              <label class="grp-head">
                <input v-model="selectedMesh[g.id].on" type="checkbox" />
                <span>分组 {{ g.id }}</span>
                <span class="grp-n">· geometry {{ g.geometryUuid.slice(0, 8) }}… · {{ g.items.length }} 个节点</span>
              </label>
              <p class="grp-reason">{{ g.reason }}</p>
              <div class="grp-keep">
                <span>保留</span>
                <select v-model="selectedMesh[g.id].keep" class="dup-sel">
                  <option v-for="it in g.items" :key="it.uuid" :value="it.uuid">
                    {{ it.label }}（{{ it.uuid.slice(0, 8) }}）
                  </option>
                </select>
              </div>
            </div>
          </section>

          <div v-if="!analysis.textureGroups.length && !analysis.materialGroups.length && !analysis.meshGroups.length" class="dup-empty">
            当前场景未发现可合并的重复项（或尚未加载模型）。
          </div>

          <div class="dup-actions">
            <button type="button" class="tool-btn accent" @click="onMerge">执行合并</button>
            <button type="button" class="tool-btn" @click="emit('close')">关闭</button>
          </div>
        </div>
        <div v-else class="dup-empty">当前侧无场景。</div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dup-root {
  position: fixed;
  inset: 0;
  z-index: 360;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dup-back {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
}
.dup-panel {
  position: relative;
  z-index: 1;
  width: min(720px, 96vw);
  max-height: min(88vh, 760px);
  overflow: auto;
  background: linear-gradient(#2c3138, #252a32);
  border: 1px solid #4a5568;
  border-radius: 8px;
  padding: 0 0 14px;
}
.dup-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid #3d4654;
}
.dup-head h2 {
  margin: 0;
  font-size: 15px;
  color: #e2e8f0;
}
.dup-x {
  border: none;
  background: transparent;
  color: #9aa3b0;
  font-size: 22px;
  cursor: pointer;
}
.dup-toggle {
  display: flex;
  gap: 8px;
  padding: 10px 14px 0;
}
.dup-tab {
  flex: 1;
  padding: 8px;
  border: 1px solid #4a5568;
  border-radius: 4px;
  background: #2a3038;
  color: #aeb6c4;
  cursor: pointer;
  font-size: 12px;
}
.dup-tab.on {
  background: #3d5a82;
  border-color: #6b94c9;
  color: #f0f4fc;
}
.dup-body {
  padding: 12px 14px 0;
  font-size: 12px;
  color: #c5cdd9;
}
.dup-hint {
  margin: 0 0 12px;
  font-size: 11px;
  color: #8e97a6;
  line-height: 1.45;
}
.dup-warn {
  margin: 0 0 10px;
  font-size: 10px;
  color: #e0c08a;
  line-height: 1.4;
}
.dup-sec {
  margin-bottom: 16px;
}
.dup-sec h3 {
  margin: 0 0 8px;
  font-size: 12px;
  color: #9fb3d6;
}
.grp {
  border: 1px solid #3a4558;
  border-radius: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
  background: #1e2229;
}
.grp-head {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #d0d8e6;
  cursor: pointer;
}
.grp-n {
  font-weight: 400;
  color: #8e97a6;
  font-size: 11px;
}
.grp-reason {
  margin: 6px 0 6px 22px;
  font-size: 10px;
  color: #7a8a9e;
  line-height: 1.4;
}
.grp-keep {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 6px 0 6px 22px;
  font-size: 11px;
  color: #aeb6c4;
}
.dup-sel {
  flex: 1;
  min-width: 0;
  padding: 4px 6px;
  border: 1px solid #4a5160;
  border-radius: 3px;
  background: #1b2029;
  color: #e6ebf3;
  font-size: 11px;
}
.grp-list {
  margin: 4px 0 0 22px;
  padding: 0;
  list-style: disc;
  font-size: 10px;
  color: #8e97a6;
  max-height: 100px;
  overflow: auto;
}
.dup-empty {
  padding: 20px;
  text-align: center;
  color: #8e97a6;
  font-size: 12px;
}
.dup-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 14px;
  padding-top: 10px;
  border-top: 1px solid #3d4654;
}
.tool-btn {
  border: 1px solid #5b626f;
  border-radius: 4px;
  background: linear-gradient(#4a5362, #3f4856);
  color: #edf2ff;
  font-size: 12px;
  padding: 6px 14px;
  cursor: pointer;
}
.tool-btn.accent {
  background: linear-gradient(#3d7a5c, #2f6349);
}
</style>
