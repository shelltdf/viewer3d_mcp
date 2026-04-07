# 详细设计：plant-studio（程序化植物编辑器）

## 壳层

- **SDI**：单页单会话；三维客户区为唯一主工作区；与 IDE 侧栏互不替代。
- **Dock**：左右各一 **Dock Area**；**Dock Button Bar** 与 **Dock View** 为兄弟节点；折叠后仅缘条按钮可见，**视图** 菜单可重新勾选显示 Dock。

## 用例

- 调整树干、分枝、叶片参数，实时预览三维形态。
- 更换随机种子以在同一参数族内探索形态。
- 将当前植物导出为 `.glb` 供外部 DCC / 游戏引擎使用。
- 通过缘条 **场景 / 生成** 或 **视图** 菜单折叠、展开侧栏；拖动分割条调宽。

## 状态与数据流

- **植物参数**：`App.vue` 中 `reactive(defaultPlantParams())`，与 `buildProceduralPlant` 字段一致。
- **环境与风**：`reactive(defaultEnvSettings())`、`reactive(defaultWindSettings())`，经 props 传入 `PlantViewport`；**左侧 Dock**（`dock-left`）集中环境与风控件，**右侧 Dock**（`panel-right`）首块为「生成」（含随机种子、恢复默认、导出 GLB、种子），其下「形态」为树干/分枝/叶片与统计；顶栏仅保留适配视图等轻量操作；中间为视口三列网格布局（窄屏改为纵向堆叠）。
- 环境对象深度 `watch` 调用 `applyEnv()` 写回 Three 光源与渲染器；风对象在 `requestAnimationFrame` 循环中读取。
- **重建策略**：仅 `params` 变化时 `dispose` 植物子图并 `buildProceduralPlant`；重建后重新遍历捕获 `Wood` 与 `Leaves` 并缓存叶片实例的静止变换矩阵供风动叠加。

## 关键交互

- **OrbitControls**：旋转、缩放、平移；阻尼开启。
- **适配视图**：对当前植物 `Box3` 估算相机距离与目标点。
- **导出 GLB**：若风动开启，导出流程内先恢复静止姿态，避免资产带帧态变形。

## 扩展留口

- 可将 `proceduralTree` 替换为 L 系统 / 空间殖民等算法，保持 `params` 与 `Group` 输出契约（`Wood` / `Leaves` 命名建议保留以便风与导出逻辑复用）。
- 风动可升级为顶点着色器或骨骼方案；环境可接 `RoomEnvironment` / HDRI，需在物理规格中单独描述资源路径与色调映射约定。
