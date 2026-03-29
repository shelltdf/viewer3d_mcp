# 接口设计（程序间）

## 适用性说明

本仓库 **无业务后端 REST API**。程序间接口包括：

## MCP（stdio）

- **进程**：`node gltf-mcp/mcp/index.mjs`（由 Cursor `mcp.json` 配置启动）。
- **工具**：`get_viewer_state`、`load_gltf_url`、`reset_camera`（详见 `02-physical/gltf-mcp/spec.md`）。

## HTTP 桥接（MCP ↔ 浏览器）

- **模式**：与 mindmap 扩展一致——MCP 通过 `fetch` 调用本地 **桥接 URL**，由已打开的 **Vue 页面**轮询执行命令。
- **路径前缀**：`/gltf-mcp-bridge/v1/`
- **鉴权**：请求体/query 携带 `token`，与 `GLTF_MCP_BRIDGE_TOKEN` 一致。

**GUI 操作（画布、鼠标）不属于本文件**，见 `product-design.md` 与 `02-physical/gltf-mcp/spec.md`。
