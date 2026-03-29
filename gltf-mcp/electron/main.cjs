'use strict'

const { app, BrowserWindow } = require('electron')
const path = require('path')
const { createGltfBridgeRouter } = require('../bridge/gltf-bridge-core.cjs')

let mainWindow

function startEmbeddedServer() {
  const express = require('express')
  const expressApp = express()
  const token = process.env.GLTF_MCP_BRIDGE_TOKEN || 'dev-gltf-mcp-token'
  expressApp.use('/gltf-mcp-bridge', createGltfBridgeRouter(() => token))
  const dist = path.join(__dirname, '..', 'dist')
  expressApp.use(express.static(dist))
  expressApp.get('*', (req, res, next) => {
    if (req.path.startsWith('/gltf-mcp-bridge')) return next()
    res.sendFile(path.join(dist, 'index.html'))
  })
  return new Promise((resolve, reject) => {
    const s = expressApp.listen(0, '127.0.0.1', () => resolve(s))
    s.on('error', reject)
  })
}

async function createWindow() {
  const isDev = process.env.GLTF_MCP_ELECTRON_DEV === '1'
  if (isDev) {
    const port = process.env.VITE_DEV_PORT || '5173'
    const url = `http://127.0.0.1:${port}/`
    mainWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    })
    await mainWindow.loadURL(url)
    return
  }

  const server = await startEmbeddedServer()
  const port = server.address().port
  const url = `http://127.0.0.1:${port}/`
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  await mainWindow.loadURL(url)
}

app.whenReady().then(() => {
  createWindow().catch((err) => {
    console.error(err)
    process.exit(1)
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
