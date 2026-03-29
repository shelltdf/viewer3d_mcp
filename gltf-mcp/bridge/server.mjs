/**
 * 生产/预览：单端口提供静态 dist + 与 MCP 一致的桥接 API。
 * 用法：先 npm run build，再 GLTF_MCP_BRIDGE_TOKEN=xxx node bridge/server.mjs
 */
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { createGltfBridgeRouter } from './gltf-bridge-core.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT || 8787)
const TOKEN = process.env.GLTF_MCP_BRIDGE_TOKEN || 'dev-gltf-mcp-token'
const dist = path.join(__dirname, '..', 'dist')

const app = express()
app.use(express.static(dist))
app.use('/gltf-mcp-bridge', createGltfBridgeRouter(() => TOKEN))

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/gltf-mcp-bridge')) return next()
  res.sendFile(path.join(dist, 'index.html'))
})

app.listen(PORT, '127.0.0.1', () => {
  console.log(`gltf-mcp bridge + static: http://127.0.0.1:${PORT}`)
  console.log(`Set Cursor MCP: GLTF_MCP_BRIDGE_URL=http://127.0.0.1:${PORT}`)
})
