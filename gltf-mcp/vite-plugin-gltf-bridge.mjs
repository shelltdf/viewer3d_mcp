import express from 'express'
import { createGltfBridgeRouter } from './bridge/gltf-bridge-core.mjs'

function getTokenFromEnv() {
  return process.env.GLTF_MCP_BRIDGE_TOKEN || 'dev-gltf-mcp-token'
}

export function gltfMcpBridgePlugin() {
  const app = express()
  app.use('/gltf-mcp-bridge', createGltfBridgeRouter(getTokenFromEnv))

  return {
    name: 'gltf-mcp-bridge',
    configureServer(server) {
      server.middlewares.use(app)
    },
    configurePreviewServer(server) {
      server.middlewares.use(app)
    },
  }
}
