import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const BASE = '/gltf-mcp-bridge'

/**
 * 与 HTTP 桥接同步：心跳 + 拉取 MCP 注入的命令（模式同 mindmap 扩展桥接）。
 * @param {import('vue').Ref} viewerRef
 * @param {import('vue').Ref<string>} lastUrlRef
 */
export function useGltfBridge(viewerRef, lastUrlRef) {
  const stopped = ref(false)

  async function sendPing() {
    try {
      await fetch(`${BASE}/v1/viewer/ping`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastUrl: lastUrlRef.value || null }),
      })
    } catch {
      /* dev 时桥未就绪可忽略 */
    }
  }

  async function pingLoop() {
    while (!stopped.value) {
      await sendPing()
      await new Promise((r) => setTimeout(r, 2000))
    }
  }

  async function pollLoop() {
    while (!stopped.value) {
      try {
        const r = await fetch(`${BASE}/v1/next`)
        const j = await r.json()
        const cmd = j.command
        if (cmd) {
          const { id, method, args } = cmd
          try {
            if (method === 'load_gltf_url' && args?.url) {
              lastUrlRef.value = String(args.url).trim()
              await viewerRef.value?.loadUrl(lastUrlRef.value)
            } else if (method === 'reset_camera') {
              viewerRef.value?.resetCamera()
            }
            await fetch(`${BASE}/v1/complete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, ok: true, result: { ok: true } }),
            })
          } catch (e) {
            await fetch(`${BASE}/v1/complete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                id,
                ok: false,
                error: String(e?.message || e),
              }),
            })
          }
        }
      } catch {
        /* ignore */
      }
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  onMounted(() => {
    stopped.value = false
    pingLoop()
    pollLoop()
  })

  onBeforeUnmount(() => {
    stopped.value = true
  })

  watch(lastUrlRef, () => {
    sendPing()
  })
}
