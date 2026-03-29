# 详细设计：GLTF 查看器

## 用例

### UC1：通过 URL 加载模型

1. 用户在输入框填入可访问的 `.gltf` / `.glb` URL。
2. 用户点击「加载」。
3. 系统请求资源；成功则替换场景中当前模型并适配相机；失败则显示可读错误信息。

### UC2：通过本地文件加载

1. 用户选择本地 `.gltf` / `.glb`（及可能的外部资源时，MVP 以 **GLB** 或自包含 glTF 为主）。
2. 系统用 `URL.createObjectURL` 或 ArrayBuffer 传入加载器。
3. 成功则同上展示；失败则提示。

### UC3：观察模型（Maya 交互）

1. 用户按 `Alt+LMB/MMB/RMB` 进行旋转/平移/推拉。
2. 系统根据当前激活子视口切换 active camera 与 controls。
3. 动画若存在，在渲染循环中 `mixer.update`。

### UC4：Panel 布局切换

1. 用户在左侧 Viewport 工具组点击 `1/2/3/4`。
2. 系统根据 panel 数切换中心布局（Outliner/Graph/多 3D 子视口组合）。
3. 切换后保持工具状态与激活视口状态可追踪。

### UC5：选择与属性查看

1. 用户在 3D、Outliner 或 Graph 中选择对象。
2. 系统同步更新：选择高亮、TransformControls 附着、右侧 Attribute Editor。
3. 用户点击 3D 空白区域，系统清空选择。

### UC6：焦点框选与全屏

1. 用户按 `F`：若场景非空，系统保持当前相机姿态（不改朝向），以平移/推拉方式平滑过渡（约 1 秒）到最大化显示目标；若场景为空，恢复默认视图。
2. 用户按 `F10`：系统切换为系统级全屏（Fullscreen API），仅显示 3D 内容；`Esc` 退出。

### UC7：渲染环境与辅助显示调参

1. 用户在右侧 Dock 的 `Environment / Display / Camera` 折叠分栏中调整渲染参数（背景色、灯光强度、网格平面、辅助可见性等）。
2. 用户可调选择线框深度参数：`Sel Offset F/U`（polygon offset 两参数）与 `Sel Depth N/F`（depth range 两参数）。
3. 用户可调骨骼辅助大小与线粗；骨骼颜色默认黄色，选中高亮蓝色。

## 状态与生命周期

- **未初始化** → **场景就绪** → **加载中** → **已加载** / **错误**。
- 切换模型前移除旧根节点并释放 `renderer` 相关几何/材质（按 three 惯例遍历 dispose）。
- 视口容器在布局切换时会重建；系统需将 renderer DOM 重新挂载到新容器并 resize。
- 视口尺寸变化由 `ResizeObserver + resize` 双通道保障，避免 `2 -> 1` 等切换后的边界计算漂移。
- `Origin`（世界原点）与 `View Pivot`（相机观察中心）是两个独立对象与状态。

## MCP 与桥接（逻辑）

- **Cursor** 通过 stdio MCP 调用工具；MCP 转发到 **HTTP 桥接**（`/gltf-mcp-bridge/v1/call`）。
- **Vue** 轮询 `GET /v1/next` 执行 `load_gltf_url` / `reset_camera`，完成后 `POST /v1/complete`。
- **心跳** `POST /v1/viewer/ping` 供 `get_viewer_state` 判断 `viewerConnected`（与 mindmap 的在线面板概念类似）。

## 数据流（逻辑层）

- URL 字符串 / File → Loader → `scene` 子图 → 渲染循环。
- MCP 侧：工具参数 → 桥接队列 → 浏览器执行 → 结果返回 AI。
- 选择数据流：3D/Outliner/Graph 输入 → `selectedUuid` → TransformControls + Attribute Editor + 可见性菜单。
- 选中数据流补充：`Mesh` 选中时生成独立线框辅助对象（可随 skinned/morph 变形同步）；骨骼/灯光/摄像机按 helper 类型做默认色与高亮色映射。
