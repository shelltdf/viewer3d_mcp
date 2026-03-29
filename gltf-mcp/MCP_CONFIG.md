# Cursor MCP 配置说明（gltf-mcp）

## 1. 启动桥接与页面

1. 在仓库根下的 `gltf-mcp/` 执行：`npm install`（首次）、`npm run dev`。
2. 浏览器打开终端里提示的地址（一般为 `http://127.0.0.1:5173`），**保持页签打开**。

## 2. 选择 token

开发默认 token 为 **`dev-gltf-mcp-token`**（与 `vite-plugin-gltf-bridge.mjs` 一致）。若需自定义：

```powershell
$env:GLTF_MCP_BRIDGE_TOKEN="your-secret"
npm run dev
```

`npm run start`（生产联调）同样读取该环境变量。

## 3. 合并到 `.cursor/mcp.json`

在 `mcpServers` 中增加（请把 `args` 换成**你机器上**本仓库的绝对路径）：

```json
"gltf-mcp": {
  "command": "node",
  "args": [
    "E:/ai_dev/ai_rules_template_3dviewer/gltf-mcp/mcp/index.mjs"
  ],
  "env": {
    "GLTF_MCP_BRIDGE_URL": "http://127.0.0.1:5173",
    "GLTF_MCP_BRIDGE_TOKEN": "dev-gltf-mcp-token"
  }
}
```

若使用 `npm run start`（默认 **8787** 端口），将 `GLTF_MCP_BRIDGE_URL` 改为 `http://127.0.0.1:8787`。

## 4. 工具一览

- `get_viewer_state`（`include_schema`）
- `load_gltf_url`（`url`）
- `reset_camera`
