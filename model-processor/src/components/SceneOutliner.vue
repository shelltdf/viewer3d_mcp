<script setup>
const props = defineProps({
  title: { type: String, required: true },
  items: { type: Array, default: () => [] },
  expandedUuids: { type: Object, required: true },
  selectedUuid: { type: String, default: null },
})

const emit = defineEmits(['toggle-expand', 'select'])

function isExpanded(uuid) {
  return props.expandedUuids.has(uuid)
}

function isItemVisible(item) {
  let p = item.parentUuid
  while (p) {
    if (!props.expandedUuids.has(p)) return false
    const parent = props.items.find((x) => x.uuid === p)
    p = parent?.parentUuid || ''
  }
  return true
}
</script>

<template>
  <div class="outliner">
    <div class="outliner-title">{{ title }}</div>
    <ul class="outline-list">
      <li
        v-for="item in items"
        :key="item.uuid"
        v-show="isItemVisible(item)"
        class="outline-row"
        :class="{ 'is-selected': selectedUuid === item.uuid }"
        :style="{ paddingLeft: 8 + item.depth * 14 + 'px' }"
        @click="emit('select', item.uuid)"
      >
        <span
          class="twisty"
          :class="{ empty: !item.hasChildren }"
          @click.stop="item.hasChildren && emit('toggle-expand', item.uuid)"
        >
          {{ item.hasChildren ? (isExpanded(item.uuid) ? '▾' : '▸') : '·' }}
        </span>
        <span class="outline-label">{{ item.label }}</span>
      </li>
    </ul>
    <div v-if="!items.length" class="outline-empty">（无对象）</div>
  </div>
</template>

<style scoped>
.outliner {
  flex: 1 1 50%;
  min-height: 80px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.outliner-title {
  flex: 0 0 auto;
  padding: 6px 8px;
  font-size: 11px;
  color: #c9d0dc;
  background: linear-gradient(#363c46, #2c3138);
  border-bottom: 1px solid #1f242c;
}
.outline-list {
  list-style: none;
  margin: 0;
  padding: 6px;
  overflow: auto;
  flex: 1 1 auto;
  min-height: 0;
}
.outline-row {
  font-size: 11px;
  padding: 3px 4px;
  border-radius: 3px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 4px;
}
.outline-row:hover {
  background: #3d4654;
}
.outline-row.is-selected {
  background: #3d5a82;
  outline: 1px solid #5a8fd4;
}
.twisty {
  width: 12px;
  text-align: center;
  color: #aeb6c4;
  user-select: none;
  flex-shrink: 0;
}
.twisty.empty {
  color: #555;
}
.outline-label {
  color: #dde4f0;
}
.outline-empty {
  padding: 8px;
  font-size: 11px;
  color: #7a8494;
}
</style>
