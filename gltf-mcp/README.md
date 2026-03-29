# gltf-mcp

浏览器内加载 **glTF / GLB** 并交互观察；通过 **stdio MCP** + **HTTP 桥接** 与 Cursor 协作（模式与 mindmap 扩展的 `MINDMAP_BRIDGE_URL` / token 一致）。

## 依赖

- **Node.js**：建议 LTS（v20+）。
- 安装：`npm install`（需联网）。

## 三种开发启动（推荐 Python 入口）

在 **`gltf-mcp/`** 目录执行：

| 方式 | 命令 | 说明 |
|------|------|------|
| ① 本地扩展 | `python dev_plugin.py` | 将 `cursor-extension/` 打成 `.vsix` 并 `cursor`/`code --install-extension`；命令面板运行 **「GLTF MCP: 在内嵌浏览器中打开查看器」**（需另开 `npm run dev`） |
| ② 网页 + 内嵌浏览器 | `python dev_web.py` | 启动 `npm run dev`，尝试 `vscode://` Simple Browser 并打开系统浏览器 |
| ③ 桌面 exe 壳 | `python dev_exe.py` | 默认优先启动已有 exe，必要时自动重编译；`python dev_exe.py --build` 产出 Windows **安装版(NSIS)** + **便携版(Portable)** 到 `electron-release/` |

详见各脚本内 `--help`。

## npm 命令

| 脚本 | 说明 |
|------|------|
| `npm run dev` | Vite 开发服务器 + `/gltf-mcp-bridge`（默认端口见终端） |
| `npm run build` | 产出 `dist/` |
| `npm run preview` | 预览构建（含桥接插件） |
| `npm run test` | Vitest 冒烟测试 |
| `npm run mcp` | 仅启动 MCP（stdio，供 Cursor 调用） |
| `npm run start` | `build` 后：静态文件 + 桥接（默认 `http://127.0.0.1:8787`） |
| `npm run electron:dev` | 仅 Electron（需已 `npm run dev` 且端口一致） |
| `npm run electron:dist` | `build` + `electron-builder` 生成安装版 + 便携版 exe |

## 环境变量（桥接 / MCP）

| 变量 | 说明 |
|------|------|
| `GLTF_MCP_BRIDGE_URL` | 桥接根 URL，无尾斜杠。开发一般为 `http://127.0.0.1:5173`；`npm run start` 为 `http://127.0.0.1:8787` |
| `GLTF_MCP_BRIDGE_TOKEN` | 与桥接校验一致；**MCP 要求非空**。未设置时插件默认 `dev-gltf-mcp-token` |

## Cursor

见 [MCP_CONFIG.md](./MCP_CONFIG.md)。使用前请先 **`npm run dev` 并打开页面**，否则 `viewerConnected` 为 false、队列可能超时。

## 查询参数

- `?url=<编码后的模型地址>`：打开时自动尝试加载。
