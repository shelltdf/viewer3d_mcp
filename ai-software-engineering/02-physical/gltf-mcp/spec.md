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
  - 贴图分组：按「内容身份键」分桶（有 `HTMLImageElement.src` 时用 **`FILE:`+规范化 URL**，避免 Wavefront **MTL 多 `newmtl` 共用同一 `map_Kd`** 时，因解码前后 `PIX`/`SRC`/宽高变化而拆桶）；桶内可产生**多个**可合并子簇；属性面板「贴图哈希」（含采样摘要）**不要求逐字相同**，请以弹窗内贴图分组为准。
  - **「无重复」含义**：场景中可有 N 张互不相同贴图、M 份互不相同材质，此时**不会**出现任何可合并分组；弹窗空状态会带出 `sceneResourceCounts`（唯一贴图/材质数量）以免与「没加载」混淆。
  - 场景节点分组：与属性面板 **Object3D「哈希值」** 使用同一规则（Mesh 为几何公差指纹 + 材质内容键；非 Mesh 为类型/可见性/layers/frustumCulled/renderOrder/本地矩阵）；**不少于 2 个节点同哈希** 才出现在「场景节点」列表；合并会 `remove` 多余节点及其子树。
- **内存估算**：`estimateSceneMemory` 按解压后分辨率、通道与 mipmap 粗算显存类占用，**不等于**磁盘压缩文件体积。

## 错误语义

- 桥接不可达、token 错误、超时（页面未 `complete`）须向 MCP 返回可读错误（与 mindmap 桥接失败提示同级体验）。
- 本地资源依赖缺失时（buffer/texture 404）需返回可读提示，指导用户多选依赖文件或改用 GLB。
