# 物理规格：gltf-mcp

## 运行时环境

- **浏览器**：支持 WebGL2 的现代浏览器。
- **Node.js**：运行 MCP（stdio）与可选的生产桥接服务器。

## 桥接与 MCP（程序间接口）

与 **mindmap MCP** 一致：**MCP 进程不直接操作 WebGL**，而是通过 HTTP 调用本项目的 **桥接层**，由已打开的 **Vue 页面**轮询执行命令。

### 环境变量

| 变量 | 说明 |
|------|------|
| `GLTF_MCP_BRIDGE_URL` | 桥接根 URL（无尾斜杠），如 `http://127.0.0.1:5173`（dev）或 `http://127.0.0.1:8787`（`npm run start`） |
| `GLTF_MCP_BRIDGE_TOKEN` | 与桥接校验一致的密钥；**不得为空**（MCP 会拒绝调用） |

### 桥接 HTTP（相对路径前缀 `/gltf-mcp-bridge`）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/call` | body：`{ token, method, arguments }`；`get_viewer_state` 同步返回；`load_gltf_url` / `reset_camera` 进入队列直至页面 `complete` |
| GET | `/v1/next` | 页面拉取下一条待执行命令 |
| POST | `/v1/complete` | body：`{ id, ok, result?, error? }` |
| POST | `/v1/viewer/ping` | body：`{ lastUrl? }`；心跳，用于 `viewerConnected` |

### MCP 工具名

- `get_viewer_state`（`include_schema`）
- `load_gltf_url`（`url`）
- `reset_camera`

## 浏览器内行为（当前实现）

- **model-processor 双视口语义**：`处理前` 与 `处理后` 为**两套独立场景图**；加载 GLTF/OBJ 等后，右侧默认由 `cloneSkinned(源)` **自动深度克隆**。克隆后**再对每个 Mesh 的几何执行 `BufferGeometry.clone()`**（`deepCloneMeshGeometries`），使 LOD 的 `setDrawRange` 与顶点缓冲编辑**不**影响左侧；随后 `isolateResultBranchResources` 再克隆材质与各贴图槽，避免编辑右侧镜像到左侧。**工具、LOD、重复资源合并及属性面板所暗示的可写操作**仅作用于 `处理后`；**处理前**为只读对照（源侧 LOD 固定 100%，不在此侧写网格/材质）。
- **视口显示**：左右**各自**六类下拉——实体/线框/点云、**顶点属性**（关 / 三角法线 / 各 `geometry.attributes` 名）、光照（影棚/柔和/平铺）、贴图（采样 / 无光照 / 隐藏槽）、材质（原始 / 法线 / UV 格）、骨骼（关 / 骨架 / 权重示意色）；其中**顶点属性**紧接实体类下拉，点云模式下顶点属性着色不生效。选定某属性时，调试材质在顶点着色器把该缓冲的**前三分量**线性映射为 RGB（`position` 用 `fract` 避免大坐标裁切），经 `varying` 在三角形内**平滑插值**到片元。由 `applyViewportViewState` + `applySceneLighting` 组合应用。工具栏可对「处理前 / 处理后」视口格子**单独或同时**开关显示；**每格左上角**展示该侧独立的 **存储粗估**（CPU/VRAM 相关字节与 GL 计数摘要）。
- **切线计算（属性面板）**：Three `BufferGeometry.computeTangents()` 需要 **index、position、normal、uv**；若缺索引则自动写入**顺序索引**（须为 `BufferAttribute`，Three r174 下 `setIndex(typedArray)` 会把 `geometry.index` 设为裸 TypedArray，渲染绑定读 `index.array.byteLength` 会抛错）；若 UV 全相同/退化则暂用**位置投影**写入可计算的 UV（便于调试，导出前应使用真实展 UV）。计算后对 `tangent` 缓冲做 **NaN / 零长** 清理；仅对 **Standard / Physical / Phong / Lambert / Toon** 等待 **`vertexTangents`** 的材质开启 **`vertexTangents=true` + `needsUpdate`**（勿对 `ShaderMaterial` 写入该字段）；刷新包围球；并通过工作台触发 **丢弃 LOD  WeakMap 缓存后重算 drawRange + 重应用右侧视口显示**，避免加索引后 LOD 与索引语义不一致导致整模不画。属性解析侧对 `resolveOutlineItem` 内存表等做 **try/catch**，避免单项异常导致整面板退化为「未选择」。
- **UV 视窗**：属性面板 Mesh 区块提供「UV 视窗…」，以浮动层展示 **uv → uv0、uv2 → uv1、uv3 → uv2** 命名下的二维三角拓扑；支持平移视图、滚轮缩放、适配范围；**处理后**可对该通道全体顶点应用 **Δu/Δv** 平移（处理前只读）。底层仍使用 Three 惯例属性名 `uv` / `uv2` / `uv3`，以免材质采样键失效。
- **顶点属性下拉**：列表过滤掉非合法 GLSL 标识符的属性名；**SkinnedMesh** 使用带骨骼的 `meshbasic_vert` 注入路径，避免沿用 `modelViewMatrix * position` 导致网格被变到视锥外而「消失」。调试 **tangent** 时 **`ShaderMaterial` 不得传入 `vertexTangents`**（非该类型字段，会触发 `setValues` 警告）；须在 **`defines` 中设 `USE_TANGENT`**，以便 Three 顶点前缀注入 `attribute vec4 tangent`，否则片元前顶点阶段引用 `tangent` 会编译失败。
- **状态栏**：**固定单行高度**（约 32px）；左侧为当前状态文案、右侧为 JS 堆与合计 GPU 等；超出宽度用省略号截断，**完整历史以双击打开日志**为准（悬停左侧可看到本条完整 `statusText`）。
- **属性面板（model-processor）**：大纲当前焦点为「处理前」时，面板顶部展示**只读**高对比提示；焦点为「处理后」时展示**可编辑**提示，避免用户对错误一侧产生可写预期。
- **渲染与后期（model-processor 双视口）**：**每个 3D 格内**各自一行「渲染与效果」，**左右 `renderSettingsSource` / `renderSettingsResult` 互不联动**：**管线**（固定流水线 / PBR / 光追占位）、**阴影**、**HDR**（ACES）、**SSAO**（`EffectComposer` + `SSAOPass`）。`onResize` 时同步 `renderer.setPixelRatio`、`EffectComposer.setPixelRatio` + `setSize`，并对各 **canvas 外包一层** 挂 `ResizeObserver`，避免仅 flex/最大化导致尺寸变化而 **window 未触发 resize** 时后期分辨率错位。载入新网格后按当前阴影选项刷新投射体。
- **打开模型流程**：载入入口在 **卸载当前处理前/处理后场景**、广播**空大纲**之后，再叠加**居中进度条**（glTF 走 `LoadingManager.onProgress`；OBJ 多文件同理用独立 `LoadingManager`）；结束或失败后关闭遮罩并再次触发尺寸对齐。
- **3D 最大化**：工作台工具栏切换「3D 最大化」时隐藏左/右侧 Dock，中央区域独占横向空间；若双视口均可见则两格**横向等分**，若仅一侧可见则该格在纵向上铺满可用高度。
- **联动观察**：仅**相机**可选同步（`linkCameras` 在工作台工具栏）；与「渲染与效果」、显示类下拉无关。
- **材质槽导入（属性面板）**：按槽位设置 `Texture.colorSpace`——**法线 / 粗糙度 / 金属度 / AO / bump 等数据贴图**用 `NoColorSpace`，**map / emissiveMap** 等用 `sRGB`；法线图若误用 sRGB 会解码错误，表现为光照**折线、不连续**。导入或清除槽位后对引用该材质的网格做 **`vertexTangents`（有几何 `tangent` 时）** 与 **`flatShading=false`（有法线贴图时）** 等与法线管线一致的同步；**贴图槽变更后立即对该侧视口调用 `refreshOutline`**，使大纲中「材质 / 贴图」节计数与列表与场景一致。
- **辅助地面（工具栏）**：可选「**辅助地面**」：`DualViewport` 在每侧 `Scene` 中、与根模型并列添加 **`CircleGeometry` 圆片** + **`MeshStandardMaterial`（`#cccccc` 约 80% 灰）**，置于该侧根节点包围盒 **底面略下方**，**仅 `receiveShadow`**，半径随包围盒尺度估算，便于无环境地平面时观察**平行光阴影**；关闭或卸载模型时移除并 `dispose` 几何与材质。
- **视口角落统计**：各 3D 格左上角除存储粗估外，展示该侧场景的 **三角面 / 顶点 / Mesh / 唯一材质数 / 唯一贴图槽实例数**（与 WebGL `info.memory` 几何/纹理计数分列）。
- 支持 glTF 2.0 / GLB；URL 与本地文件（含 `.gltf + .bin + 贴图` 多文件映射）；查询参数 `?url=` 初始加载。
- Maya 风格 UI：主菜单、视口菜单、Outliner panel 菜单、右侧 Attribute Editor dock。
- Panel 数量映射：
  - `1` -> `single` 3D view
  - `2` -> Outliner + `single` 3D view
  - `3` -> Outliner + `single` 3D + Graph(2D scene graph)
  - `4` -> `quad` 四视口 3D（无 Outliner）
- 选择与可见性：
  - 3D 空白点击取消选择
  - 支持对象显隐切换、`Show All Objects`
  - 取消选择时同时 detach TransformControls 与属性面板清空
- 交互稳定性保护：
  - 视口切换后 renderer 重新挂载到新的 `viewportEl`
  - 变换值出现 `NaN/Infinity` 时回滚到最后有效 transform
  - 模型节点默认禁用 frustum culling 以避免异常误裁剪
  - 材质默认 `DoubleSide`，降低背面剔除导致的“消失”风险
- 全屏与框选：
  - `F10` 使用 Fullscreen API 进入/退出系统级全屏（`Esc` 退出）
  - `F` 在场景非空时保持当前相机姿态并平滑过渡（约 1s）到目标框选结果；场景为空时恢复默认视角
- 原点与中心：
  - `Origin`：世界坐标 `(0,0,0)`，固定不动（默认关闭）
  - `View Pivot`：相机观察中心标记（默认关闭），与 `Origin` 解耦
- 网格：
  - 提供 `XZ/XY/YZ` 三平面开关，每平面含黑色中线（对应坐标 0 线）
- 右侧 Dock：
  - 增加 `Render Environment` 折叠分栏：`Environment / Display / Camera`
  - 可调背景色、Ambient/Key/Fill 光强、辅助对象显示开关、当前相机参数
- 选择可视化：
  - Mesh 选中生成独立单色线框辅助 Mesh（非原场景节点），并随 skinned/morph 变形同步
  - 线框参数可调：`Sel Offset F/U`、`Sel Depth N/F`、`Sel Wire`
  - 骨骼辅助默认黄色，选中高亮蓝色；仅高亮“当前骨骼到父骨骼”单段连线
  - 骨骼辅助对象独立于模型层级，不修改原始场景树结构
- **重复资源共享（model-processor / 工作台）**：
  - **范围**：弹窗**仅**分析与合并「**处理后**」场景；不提供「处理前 / 处理后」选项卡；「处理前」仅在大纲与双视口对照。
  - **资源引用关系图**：弹窗内提供基于 SVG 的四列图（场景节点 → Mesh → 材质 → 贴图），边表示父子层次、Mesh→材质、材质→贴图槽（槽位列表同 `MATERIAL_MAP_KEYS`）；多对多引用以多重边展示；画布区域可滚动以适配大场景。
  - **合并后行为**：合并**仅修改 `resultRoot`**；执行合并后不关闭弹窗并刷新「处理后」分析；`applyDuplicateMerges` 返回计数；通过 `sceneRevision` 刷新弹窗分析/关系图。工作台另起**高 z-index 结果对话框**（绿色强调边框）汇总贴图/材质/节点合并条数，与状态栏短提示并存。
  - **共享资源与 dispose**：`cloneSkinned(源)` 后「处理前 / 处理后」仍可能**共享同一 Texture / Material 对象**。合并贴图/材质后对「移除」实例调用 `dispose()` 时，须检测 **「处理前」根**是否仍引用该对象；若仍引用则**跳过 dispose**，避免左侧对照场景显存估算骤降或贴图失效。
  - 贴图分组：按「内容身份键」分桶（有 `HTMLImageElement.src` 时用 **`FILE:`+规范化 URL**，避免 Wavefront **MTL 多 `newmtl` 共用同一 `map_Kd`** 时，因解码前后 `PIX`/`SRC`/宽高变化而拆桶）；桶内可产生**多个**可合并子簇；属性面板「贴图哈希」（含采样摘要）**不要求逐字相同**，请以弹窗内贴图分组为准。
  - **「无重复」含义**：场景中可有 N 张互不相同贴图、M 份互不相同材质，此时**不会**出现任何可合并分组；弹窗空状态会带出 `sceneResourceCounts`（唯一贴图/材质数量）以免与「没加载」混淆。
  - 场景节点分组：与属性面板 **Object3D「哈希值」** 使用同一规则（Mesh 为几何公差指纹 + 材质内容键；非 Mesh 为类型/可见性/layers/frustumCulled/renderOrder/本地矩阵）；**不少于 2 个节点同哈希** 才出现在「场景节点」列表；合并会 `remove` 多余节点及其子树。
- **内存估算**：`estimateSceneMemory` 按解压后分辨率、通道与 mipmap 粗算显存类占用，**不等于**磁盘压缩文件体积。

## 错误语义

- 桥接不可达、token 错误、超时（页面未 `complete`）须向 MCP 返回可读错误（与 mindmap 桥接失败提示同级体验）。
- 本地资源依赖缺失时（buffer/texture 404）需返回可读提示，指导用户多选依赖文件或改用 GLB。
