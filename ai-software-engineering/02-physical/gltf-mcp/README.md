# gltf-mcp

## 产物

- **类型**：静态站点（`dist/`）+ **stdio MCP**（`mcp/index.mjs`）+ **HTTP 桥接**（`/gltf-mcp-bridge/v1/*`，开发时由 Vite 插件挂载，生产由 `bridge/server.mjs` 提供）。
- **入口页面**：`index.html`（构建后位于 `dist/index.html`）。

## 源码根路径

实现子项目根目录：`gltf-mcp/`（相对仓库根）。

## 与构建系统对应

- **包管理**：npm（`package.json`）。
- **构建命令**：`npm run build`（Vite）。
- **开发命令**：`npm run dev`（Vite + 桥接中间件，默认 `http://127.0.0.1:5173`）。
- **MCP**：`npm run mcp`（stdio；需设置 `GLTF_MCP_BRIDGE_URL`、`GLTF_MCP_BRIDGE_TOKEN`）。
- **生产联调**：`npm run build && npm run start`（`bridge/server.mjs`，默认 `8787`）。
