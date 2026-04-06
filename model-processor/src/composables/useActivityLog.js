import { ref } from 'vue'

const MAX = 500

export function useActivityLog() {
  const lines = ref(/** @type {{ t: number, text: string, kind: string }[]} */ ([]))

  function push(text, kind = 'info') {
    const entry = { t: Date.now(), text: String(text), kind }
    lines.value = [...lines.value, entry].slice(-MAX)
  }

  function clear() {
    lines.value = []
  }

  function formatAll() {
    return lines.value
      .map((l) => {
        const d = new Date(l.t)
        const ts = d.toLocaleTimeString('zh-CN', { hour12: false })
        return `[${ts}] ${l.text}`
      })
      .join('\n')
  }

  return { lines, push, clear, formatAll }
}
