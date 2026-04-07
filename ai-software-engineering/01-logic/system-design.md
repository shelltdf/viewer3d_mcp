# 系统设计

## 子系统划分

1. **应用壳（Vue）**：路由与布局（MVP 单页）、工具栏状态、错误提示。
2. **三维运行时（Three.js）**：场景图、相机、灯光、渲染循环、资源加载与释放。
3. **输入**：指针与滚轮 → `OrbitControls`（与物理规格一致）。

## 与物理阶段映射

| 子系统 | 物理目标 |
|--------|----------|
| 上述 1～3 均运行于浏览器 | `02-physical/gltf-mcp/`（另含 Node MCP 与 HTTP 桥接进程） |
| 同构 Vue + Three 独立应用（程序化植物编辑） | `02-physical/plant-studio/`（仅静态 SPA，无 MCP） |
| Vue SDI + Three 独立应用（动物粗模生成） | `02-physical/animal-studio/` |

## 依赖关系

- 应用壳 **拥有** 三维运行时生命周期（挂载时初始化，卸载时 `dispose`）。
- 无后端依赖；远程模型依赖 HTTP(S) 与 CORS 策略。
