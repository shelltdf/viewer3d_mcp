import { ref, shallowRef } from 'vue'

const STORAGE_LABEL = 'model-processor-workspace-label'

/**
 * 递归列出目录条目（File System Access API）。
 * @param {FileSystemDirectoryHandle} dirHandle
 * @param {string} prefix 相对工作区根的路径前缀
 * @param {number} depth 当前深度（从 0 开始）
 * @param {number} maxDepth 最大递归深度
 */
async function listDirectoryRecursive(dirHandle, prefix = '', depth = 0, maxDepth = 4) {
  const rows = []
  const entries = []
  try {
    for await (const entry of dirHandle.values()) {
      entries.push(entry)
    }
  } catch (e) {
    throw e
  }
  entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const entry of entries) {
    const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
    rows.push({
      name: entry.name,
      path: relPath,
      kind: entry.kind,
      depth,
    })
    if (entry.kind === 'directory' && depth < maxDepth) {
      try {
        const sub = await listDirectoryRecursive(entry, relPath, depth + 1, maxDepth)
        rows.push(...sub)
      } catch {
        /* 权限或沙箱限制时跳过子树 */
      }
    }
  }
  return rows
}

export function useLocalWorkspace() {
  const workspaceLabel = ref(typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_LABEL) || '' : '')
  const dirHandle = shallowRef(null)
  const entries = ref([])
  const lastError = ref('')
  const listMaxDepth = ref(4)

  function persistLabel() {
    try {
      localStorage.setItem(STORAGE_LABEL, workspaceLabel.value || '')
    } catch {
      /* ignore */
    }
  }

  async function pickFolder() {
    lastError.value = ''
    if (typeof window === 'undefined' || !window.showDirectoryPicker) {
      lastError.value = '当前环境不支持目录选择（需 Chrome / Edge 等）。可手动填写工作目录标签。'
      throw new Error(lastError.value)
    }
    const handle = await window.showDirectoryPicker()
    dirHandle.value = handle
    workspaceLabel.value = handle.name || '(folder)'
    persistLabel()
    await refreshListing()
  }

  async function refreshListing() {
    const handle = dirHandle.value
    if (!handle) {
      entries.value = []
      return
    }
    try {
      const list = await listDirectoryRecursive(handle, '', 0, Math.min(8, Math.max(1, listMaxDepth.value)))
      lastError.value = ''
      entries.value = list
    } catch (e) {
      lastError.value = e?.message || String(e)
      entries.value = []
    }
  }

  function setManualLabel(text) {
    workspaceLabel.value = text
    persistLabel()
  }

  function clearHandle() {
    dirHandle.value = null
    entries.value = []
  }

  return {
    workspaceLabel,
    dirHandle,
    entries,
    lastError,
    listMaxDepth,
    pickFolder,
    refreshListing,
    setManualLabel,
    clearHandle,
  }
}
