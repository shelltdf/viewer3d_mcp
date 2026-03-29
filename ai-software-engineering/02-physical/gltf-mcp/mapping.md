# 模型元素 → 源码映射

| 元素 | 源码路径（`gltf-mcp/`） |
|------|-------------------------|
| 应用入口 | `src/main.js` |
| 根组件 / MCP 桥接客户端 | `src/App.vue`、`src/composables/useGltfBridge.js` |
| 三维查看器 | `src/components/GltfViewer.vue` |
| Vite + 桥接插件 | `vite.config.js`、`vite-plugin-gltf-bridge.mjs` |
| 桥接核心 | `bridge/gltf-bridge-core.mjs` |
| 生产静态+桥接 | `bridge/server.mjs` |
| stdio MCP | `mcp/index.mjs` |
| HTML 壳 | `index.html` |
