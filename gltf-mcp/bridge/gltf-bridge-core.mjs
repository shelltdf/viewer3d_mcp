import express from 'express'

/** MCP 工具与桥接命令的简要 schema（供 get_viewer_state.include_schema） */
export const GLTF_MCP_TOOLS_SCHEMA = {
  tools: [
    {
      name: 'get_viewer_state',
      arguments: { include_schema: 'boolean (required)' },
    },
    {
      name: 'load_gltf_url',
      arguments: { url: 'string (required, http(s) gltf/glb)' },
    },
    {
      name: 'reset_camera',
      arguments: {},
    },
  ],
}

/**
 * @param {() => string} getToken
 * @returns {import('express').Router}
 */
export function createGltfBridgeRouter(getToken) {
  const router = express.Router()
  router.use(express.json({ limit: '4mb' }))

  let cmdId = 0
  /** @type {Map<number, { resolve: (v: unknown) => void, reject: (e: Error) => void }>} */
  const pending = new Map()
  const commandQueue = []

  let viewerState = {
    lastHeartbeat: 0,
    lastUrl: null,
  }

  router.post('/v1/viewer/ping', (req, res) => {
    const { lastUrl } = req.body || {}
    viewerState = {
      lastHeartbeat: Date.now(),
      lastUrl: lastUrl ?? null,
    }
    res.json({ ok: true })
  })

  router.post('/v1/call', async (req, res) => {
    const { token, method, arguments: args } = req.body || {}
    if (token !== getToken()) {
      return res.status(401).json({ ok: false, error: 'invalid token' })
    }
    if (!method || typeof method !== 'string') {
      return res.status(400).json({ ok: false, error: 'missing method' })
    }

    if (method === 'get_viewer_state') {
      const alive = Date.now() - viewerState.lastHeartbeat < 6000
      const result = {
        viewerConnected: alive,
        lastUrl: viewerState.lastUrl,
      }
      if (args?.include_schema) {
        result.toolsSchema = GLTF_MCP_TOOLS_SCHEMA
      }
      return res.json({ ok: true, result })
    }

    if (method === 'load_gltf_url') {
      const url = typeof args?.url === 'string' ? args.url.trim() : ''
      if (!url) {
        return res.json({ ok: false, error: 'load_gltf_url requires url' })
      }
    }

    const id = ++cmdId
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      commandQueue.push({ id, method, args: args || {} })
    })
    const t = setTimeout(() => {
      const entry = pending.get(id)
      if (!entry) return
      pending.delete(id)
      const idx = commandQueue.findIndex((c) => c.id === id)
      if (idx >= 0) commandQueue.splice(idx, 1)
      entry.reject(new Error('bridge timeout: viewer did not complete in 120s'))
    }, 120000)
    try {
      const result = await promise
      clearTimeout(t)
      res.json({ ok: true, result })
    } catch (e) {
      clearTimeout(t)
      res.json({ ok: false, error: String(e?.message || e) })
    }
  })

  router.get('/v1/next', (req, res) => {
    const cmd = commandQueue.shift()
    if (!cmd) return res.json({ command: null })
    res.json({ command: cmd })
  })

  router.post('/v1/complete', (req, res) => {
    const { id, ok, result, error } = req.body || {}
    const entry = pending.get(id)
    if (!entry) {
      return res.status(400).json({ ok: false, error: 'unknown command id' })
    }
    pending.delete(id)
    if (ok) entry.resolve(result ?? {})
    else entry.reject(new Error(error || 'tool failed'))
    res.json({ ok: true })
  })

  return router
}
