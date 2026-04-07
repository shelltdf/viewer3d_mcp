# 物理规格：animal-studio

## 产物与入口

- **开发**：`animal-studio/` 下 `npm install`、`npm run dev`（默认 Vite 端口 **5174**，见 `vite.config.js`）；或 **`python run_web.py`**（默认等待 `5174`，与 `plant-studio` 常用 `5173` 错开）。
- **构建**：`npm run build` → `animal-studio/dist/`，`base: './'`。

## 壳层与 Dock（对齐 window-gui-documentation）

- **SDI**：单页单会话；中央 **客户区** 为三维视口，与 IDE 侧栏独立。
- **顶区**：**标题条** 与 **菜单栏** 分行；菜单栏含 **视图**（`details`）可勾选恢复 **参数 Dock**。
- **左侧 Dock Area**：**折叠按钮条**（`Dock Button`「参数」，展开/折叠样式区分，始终可见）+ **Dock View**（类型、随机、种子后紧跟 **动作（程序化）**、再 **外观**、分类型滑块、统计）+ **分割条**（仅展开时，`col-resize`，宽约 220–480px，持久化 `localStorage`：`animal-studio.dock.paramsOpen`、`animal-studio.dock.paramsWidth`）。

## 行为概要

- **地平对齐**：`buildCreature` 末尾按整组 **AABB** 上移，使最低点略高于 **y=0**（`GROUND_PAD≈2mm`），并把 **`userData.groundOffsetY`** 写入根组；视口动画与 `bakeExport` 在程序化 **py** 上叠加该基准，避免每帧覆盖导致再次穿地；导出静息姿态亦保留此 **Y**。
- **程序化动物**：`src/creature/proceduralCreature.js` 中 `CREATURE_KINDS` 含 **两足 / 四足 / 鱼 / 昆虫 / 鸟 / 爬行 / 两栖**；`buildCreature(params)` 按 `kind` 组合 `Cylinder` / `Sphere` / **`ellipsoid`（缩放球）** / `Box` / `Cone` 等；**分段加粗**（如肢干圆柱径向约 14、高度 2 段，球/椭球约 16–20，盒 3×3×3 等）以便蒙皮形变更平滑。几何在合并前经 `skinning.js` 按顶点到**骨段**距离写入 **`skinIndex`/`skinWeight`**（最多 4 影响），`mergeGeometries` 后得到 **`SkinnedMesh`** + **`THREE.Skeleton`**（与 `Armature` 内同名 `Bone` 引用一致），材质 `MeshStandardMaterial`、`flatShading: false`、`normalizeSkinWeights`；色相由 `hue/saturation/lightness` 驱动；`seed` 经 `mulberry32` 微调姿态。**两足**：骨盆区 + 胸腹 **椭球**躯干、**圆柱颈**、**椭球头**；上下肢均为**两段圆锥台**（膝/肘与骨骼一致）；踝、腕处示意足掌：足底为 **`orientedSoleBox`**（长轴随膝–踝水平投影旋转），避免固定世界轴时与 **髋≠踝横向偏移** 的小腿脱节；掌块仍为世界轴 `Box` 粗模（足长约 `0.24×legLength`、掌约 `0.19×armLength`）。**四足**：**桶状椭球躯干**（`bodyLength` 为 Z 向主轴）、颈为**双段锥台**、头为**沿头尾向略长的椭球**；肢干锥度加粗。**四足**蹄/掌仍为扁 `Box` 粗模（非分趾级）。**鱼**：躯干为 **椭球**，**Z 为头尾向最长轴**，X 为左右宽（最窄），Y 为背腹高，与尾鳍、背/胸鳍布局一致。**两栖**：躯干 `Box` 的 **Z（吻–尾）长于 X（左右宽）**，头与四肢锚点随 `bodyLenZ` / `latW` 推算。
- **子物种与比例预设**：`CREATURE_SUBSPECIES` 为每大类下列出中文标签子项（如四足：马/牛/狗/猪/猫；两足：男人/女人/儿童；鱼：鲤鱼/金枪鱼/金鱼；昆虫：蚂蚁/蜜蜂/蝴蝶/甲虫 等）。`params.subspecies` 变更时 `applySubspeciesPreset` 写入 `SUBSPECIES_PRESETS` 中的数值字段（与 `defaultCreatureParams` 同形），用于**相对比例**（体长/肢长/颈长/站姿等），**非**真实物种测量数据。两足额外 `bipedHipSpread` / `bipedFootSpread` 与肢骨插值 `kneeAlongLeg` / `elbowAlongArm`；四足额外 `quadStanceX` / `quadStanceZ` / `quadKneeAlongLeg`（前后肢共用时的默认胫–跗插值）、可选 `quadKneeAlongLegFront` / `quadKneeAlongLegHind`（马等后肢跗可更靠远端）、`quadNeckForward` / `quadTailZ`；肢体网格为**上、下两段圆柱**在关节参数对应处折角。导出 **ZIP**（`导出 ZIP`）：**`model.glb`**（静息、`SkinnedMesh` + `Armature`，不含关节球/骨线）；**每种非「无」预设各一份** `animation_<id>.glb`（`CreatureBody` 为占位 `Group`，内含该预设独用的烘焙 **TRS** 动画，约 30fps）；**`manifest.json`** 列全部动画文件与时长。ZIP 文件名：`creature-<kind>[-<subspecies>]-<seed>.zip`。
- **骨骼（示意层级）**：各 `build*` 同步产出关节表（`name`、世界坐标 `pos`、`parent`）；`createArmatureFromBones` 生成 `THREE.Bone` 树（组名 `Armature`）。构建后 `captureBoneRestPose` 写入每骨 `userData.restPosition/restQuaternion/restScale`。**可视化**：`showSkeleton`（默认 `true`）为真时 `attachSkeletonVisualization`——在每根 `Bone` 下挂关节球 + 指向子骨的 `Line`（局部从原点到 `child.position`），随关节旋转移动；材质 **`depthTest`/`depthWrite` 关闭**、`renderOrder` 提高；关闭后无球线但仍保留 Bone 树（仍随 GLB 导出）。统计 `stats` 含 `parts`（几何片数）与 `bones`（关节数）。
- **两足 / 四足（脊椎动物默认骨架命名）**：与哺乳类四足/双足粗对齐，**非**临床精度。**两足**：`Root`→`Pelvis`→`Lumbar`→`Thoracic`→`Cervical`（对齐颈柱）→`Skull`；后肢 `Femur_L/R`→`Tibia_L/R`→`Foot_L/R`；前肢 `Humerus_L/R`→`RadiusUlna_L/R`→`Hand_L/R`。**四足躯干**：椭球 **Z 为头尾向主轴**，左右半宽约 `bodyLength*0.26`，`bodyLength` 为沿脊柱的躯干尺度。**骨架**：`Pelvis`→`Lumbar`→`Thoracic`→`Cervical`（颈段中点附近）→`Skull`；`Tail_base`→`Tail_tip` 挂于 `Pelvis`；前肢 `Humerus_*`→`RadiusUlna_*`→`Paw_*` 父级 `Thoracic`；后肢 `Femur_*`→`Tibia_*`→`Paw_*` 父级 `Pelvis`。
- **视口**：`CreatureViewport.vue`：`OrbitControls`、简易棚灯、圆地面、**导出 ZIP**（`jszip` + `GLTFExporter.parseAsync`）；烘焙逻辑见 `bakeExport.js`。卸载/重建时释放网格与线段的 `geometry`/`material`（含骨骼可视化）。
- **程序化动作（预览）**：`proceduralAnimations.js` 中 `CREATURE_ANIMATIONS`（含 **扑翼 `wingFlap`、滑翔 `glide`** 等）+ `sampleCreatureAnimation`（根组平移/转）+ `applyCreatureJointAnimation`（骨骼局部欧拉；扑翼/滑翔优先走专用分支，兼顾鸟/虫翅、两足摆臂、四足轻装步、鱼尾等）。`animationPreset` 经 **`v-model:animation-preset`** 同步（**不**写入 `params`）。**限制**：权重为**启发式**非医学绑定；粗模下面部/指节等仍可能拉扯；动作非工业级 keyframe 管线。
- **非目标**：非解剖级权重精修（需 DCC 手调或 Heat Diffusion 等）；非多套 UV/表情目标。

## 与仓库其它目标关系

- 独立子项目；可与 `plant-studio` 并行开发（端口默认错开）。
