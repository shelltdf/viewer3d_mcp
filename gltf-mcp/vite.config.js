import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { gltfMcpBridgePlugin } from './vite-plugin-gltf-bridge.mjs'

export default defineConfig({
  base: './',
  plugins: [vue(), gltfMcpBridgePlugin()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
})
