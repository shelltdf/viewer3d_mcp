# model-processor（模型处理工作台）

基于 **Vue 3 + Vite + three.js** 的本地模型处理界面壳层：双视口对比（**处理前 / 处理后**）、菜单栏与工具栏、左侧大纲（场景 / 材质 / 贴图 / 动画）、右侧属性（含预览）、底部状态栏（双击打开日志）；并集成 **File System Access API** 作为「本地工作目录」转接（Chrome / Edge 下可选文件夹并递归列出条目）。

## 功能范围（界面与占位）

- 打开 `.glb` / `.gltf`（多选依赖文件）、**Wavefront `.obj` / `.mtl`**（含 `mtllib` 时请多选 `.obj`、`.mtl` 及贴图）、或从 URL 加载上述格式；glTF 依赖贴图支持 **`.dds` / `.ktx` / `.ktx2`**（`public/basis/` 提供 Basis 转码器，`KTX2Loader` 需要 `basis_transcoder.wasm`）
- 网格简化、骨骼与蒙皮影响数量、材质合并、单贴图 → PBR 等：**参数面板已就绪**，具体算法需接入 WASM / 原生后端 / MCP 等
- 烘焙（灯光 / 贴图 / 顶点）、瓦片切割、点云与 Mesh 互转、高斯泼溅：**菜单与属性占位**，同上
- **加载后自动克隆**：源场景加载完成后自动深度克隆至「处理后」视口（非真实减面 / 烘焙管线）
- **渲染与效果**：每个 3D 格内一行控制（与另一侧同步）；含固定流水线 / PBR / 光追（占位）、阴影、ACES HDR、SSAO；随容器缩放自动对齐后期分辨率
- **打开模型**：先卸载当前场景并清空大纲，再显示加载进度条（glTF 可显示字节级进度）
- **3D 最大化**：工具栏可隐藏左右 Dock，仅放大中央视口区；双视口开启时为左右等分，单侧开启时单格纵向铺满
- **内存预览**（菜单）：按几何 / 贴图 / 材质粗估占用，可在处理前、处理后之间切换；含对齐余量说明（估算值）
- **日志**：状态栏双击打开历史记录，支持复制

## 运行

```bash
cd model-processor
npm install
npm run dev
```

构建：

```bash
npm run build
```

`npm run preview` 可预览生产构建。

## Draco

`public/draco/` 来自 `three/examples/jsm/libs/draco/gltf/`，供 `KHR_draco_mesh_compression` 模型解码。

## Basis（KTX2）

`public/basis/` 需包含 `basis_transcoder.js` 与 `basis_transcoder.wasm`（可与 `three` 包中 `examples/jsm/libs/basis` 及官方构建一致），供 `KTX2Loader` 转码。

## 本地工作目录

使用「选择文件夹…」后，浏览器持有目录 **句柄**，可在设定递归深度内列出子路径。**无法**像桌面应用一样访问任意磁盘路径；需用户主动授权目录。

## 实现产物路径

本目录为仓库内实现子项目，位于 `ai-software-engineering/` 之外，与仓库文档边界规则一致。
