# 开发维护说明书

## 仓库结构（与本项目相关）

- `ai-software-engineering/`：四阶段工程文档（**不含**业务源码）。
- `gltf-mcp/`：Vue + MCP + 桥接实现子项目（**文档外**）。

## 依赖

- **Node.js**：建议当前 LTS；包管理使用 **npm**（见 `gltf-mcp/package.json`）。

## 常用命令

在 `gltf-mcp/` 目录：

| 操作 | 命令 |
|------|------|
| 安装依赖 | `npm install` |
| 开发（Vite + 桥接） | `npm run dev` 或 **`python dev_web.py`**（自动打开浏览器） |
| 本地扩展安装 | **`python dev_plugin.py`**（打包 `.vsix` 并安装到 Cursor/VS Code） |
| Electron 桌面壳 | **`python dev_exe.py`**（无参数，自动判断是否需要重编译后运行） |
| 构建 | `npm run build` |
| 预览构建 | `npm run preview` |
| 测试 | `npm run test` |
| 仅启动 MCP（stdio） | `npm run mcp` |
| 生产：静态 + 桥接 | `npm run build && npm run start` |

## Cursor MCP 配置

1. 先启动 `npm run dev`（或 `npm run start`），并设置 `GLTF_MCP_BRIDGE_TOKEN`（与 `vite-plugin-gltf-bridge` / `bridge/server.mjs` 默认一致，如 `dev-gltf-mcp-token`）。
2. 在 `.cursor/mcp.json` 中增加 `gltf-mcp` 服务器：`command` 为 `node`，`args` 指向 `gltf-mcp/mcp/index.mjs`，`env` 设置 `GLTF_MCP_BRIDGE_URL`、`GLTF_MCP_BRIDGE_TOKEN`。
3. 详细片段见 `gltf-mcp/MCP_CONFIG.md`。

## Python 封装脚本

同目录提供 `build.py`、`test.py`、`run.py`、`publish.py`、`dev_web.py`、`dev_plugin.py`、`dev_exe.py`、`mcp.py`。

## 发布

- `npm run build` 生成 `dist/`；将 `dist/` 上传至静态托管即可。
- 若需 MCP 联调，需同时运行 `bridge/server.mjs` 或等价反向代理，使 `GLTF_MCP_BRIDGE_URL` 可达。

## 配置说明

- 开发服务器端口等见 Vite CLI 输出；桥接与 Vite 同端口（见 `vite-plugin-gltf-bridge.mjs`）。
- Draco 解码器已内置到 `gltf-mcp/public/draco/`，运行时使用本地路径 `/draco/`，离线环境可解码 Draco 压缩 glTF。
- `GltfViewer` 新增系统级全屏（`F10`）与平滑框选（`F`）逻辑；全屏依赖浏览器 Fullscreen API，嵌入式环境需允许该 API。
- 选择线框辅助对象参数：
  - `Sel Offset F/U` -> `polygonOffsetFactor/Units`
  - `Sel Depth N/F` -> `gl.depthRange(near, far)`（仅对选择线框对象生效）
  - `Sel Wire` -> 线框外扩系数
- 骨骼辅助对象默认作为独立 helper 层对象挂在 `scene` 下，不应注入原模型节点层级。
