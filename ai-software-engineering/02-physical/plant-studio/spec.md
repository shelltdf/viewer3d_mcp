# 物理规格：plant-studio

## 产物与入口

- **开发**：在 `plant-studio/` 执行 `npm install`、`npm run dev`（Vite 默认端口见终端输出）；或 **`python run_web.py`**（同目录，启动 dev 并可选打开 Simple Browser / 系统浏览器；支持 `--port`、`--no-open`、`--external-only`）。
- **构建**：`npm run build` → 输出 `plant-studio/dist/`，`base: './'` 便于相对路径托管。

## 行为概要

- **程序化树木**：`src/plant/proceduralTree.js` 中 `buildProceduralPlant(params)` 基于**有种子随机**的递归分枝生成圆柱段网格（`mergeGeometries` 合并为单 `Mesh`），梢部用 `InstancedMesh` 平面作为叶片占位。
- **编辑 UI（页内 SDI，对齐 window-gui-documentation 之 Dock Area）**：`src/App.vue` 顶区 **标题条** 与 **菜单栏** 分行；菜单栏含 **视图**（`details` 下拉）：勾选恢复 **场景 Dock** / **生成 Dock**（与折叠后「找不回」相对）。**客户区** 中央为 `PlantViewport`。**左侧 Dock Area** = **折叠按钮条**（贴左缘，`Dock Button`「场景」，展开/折叠态样式区分，始终可见）+ **Dock View**（环境与光照、风，可滚动）+ **分割条**（仅 Dock 展开时渲染，`col-resize` 拖宽 200–520px）。**右侧 Dock Area** = **分割条** + **Dock View**（生成、形态、统计，宽 240–600px）+ **折叠按钮条**（贴右缘，`Dock Button`「生成」）。Dock 展开与宽度持久化 `localStorage` 键：`plant-studio.dock.leftOpen`、`rightOpen`、`leftWidth`、`rightWidth`。绑定 `defaultPlantParams()`、`defaultEnvSettings()`、`defaultWindSettings()`（见 `sceneSettings.js`）；植物参数变更触发 `PlantViewport` 重建。
- **环境与光照**：可配背景色、地面色、`toneMappingExposure`、色调映射（ACES / Neutral / Linear / Reinhard / Cineon）、方向光阴影开关、环境光/半球光/主光（含方位角与高度角）/补光的颜色与强度。
- **风动**：启用时按时间正弦组合对 **Wood** 网格施加小幅 `rotation`（强度受 `trunkSway` 权重）；对 **Leaves** `InstancedMesh` 在每帧基于缓存的静止 `Matrix4` 分解后叠加局部摆动再写回 `instanceMatrix`。**导出 GLB** 前若风动开启，短暂恢复静止姿态再 `GLTFExporter.parse`，结束后在 `finally` 中恢复风动显示。
- **视口**：`PlantViewport.vue` 初始化 `WebGLRenderer`、`OrbitControls`、上述光源与地面；**导出**为二进制 glTF。

## 约束与边界

- 非 SpeedTree 级：风动为 CPU 级实例矩阵动画 + 树干刚体摇摆，非顶点着色器风场；无 LOD、节点图、树皮/叶脉贴图管线。
- 导出 glTF 依赖 Three 对 `InstancedMesh` / 合并几何的支持；超大叶片实例数可能导致每帧矩阵更新与导出体积上升。

## 与仓库其它目标关系

- 独立子项目，**不**依赖 `gltf-mcp` 或 `model-processor` 运行时；生成网格可在外部查看器中打开导出的 `.glb`。
