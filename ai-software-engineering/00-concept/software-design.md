# 软件设计

## 总体结构

- **表现层**：Vue 3 组件封装 Three.js 场景生命周期（创建渲染器、相机、灯光、加载器、动画循环）。
- **资源层**：glTF/GLB 通过 `GLTFLoader` 加载；贴图与二进制自包含于 glTF 或并行请求。
- **无后端**：纯静态前端；不涉及业务数据库。

## 与构建目标对应关系

| 逻辑模块 | 物理构建目标 |
|----------|----------------|
| 单页应用壳 + 查看器组件 + MCP 桥接客户端 | `gltf-mcp`（见 `02-physical/gltf-mcp/`） |

## 技术选型（约定）

- 构建：Vite。
- 运行时：Vue 3（Composition API / `<script setup>`）。
- 三维：three.js，`GLTFLoader` + `OrbitControls`。
- MCP：stdio 服务（`@modelcontextprotocol/sdk`）+ HTTP 桥接（Express，开发时挂入 Vite）。
