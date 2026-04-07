# 详细设计：animal-studio（动物生成器）

## 用例

- 选择动物大类，调节体型与颜色参数，实时预览粗模。
- 随机种子探索变体；**导出 ZIP**：`model.glb`（`SkinnedMesh` + 骨架）与 **按预设分文件** 的 `animation_<id>.glb` 及 `manifest.json`；动作列表含扑翼、滑翔等，供外部 DCC 合并 timeline。

## 状态与数据流

- **params**：`reactive(defaultCreatureParams(kind))`；切换 `kind` 时保留 `seed`，其余字段按类型重置为默认值（含该大类**第一个子物种**与 `applySubspeciesPreset`）。
- **子物种**：Dock 中 `子物种（比例预设）` 绑定 `params.subspecies`；`watch` 调用 `applySubspeciesPreset(params)` 覆盖与预设表同名的比例字段，用户仍可再用滑块微调。
- **重建**：`CreatureViewport` 对 `params` 深度监听，每次变更 `dispose` 后 `buildCreature`。
- **Dock**：`dockOpen`、`dockWidth` 与 `localStorage` 同步，避免折叠后无入口（**视图** 菜单可勾选恢复）。

## 程序化骨骼（两足 / 四足）

- 与粗模同生的关节表驱动 `Armature` 与可选 `SkeletonDisplay`。
- **两足、四足**采用**脊椎动物**惯用层级与英文名：`Pelvis`→`Lumbar`→`Thoracic`→`Cervical`→`Skull`；后肢股骨-胫骨-足（跖），前肢肱骨-桡尺-掌/指；四足另含自 `Pelvis` 伸出的尾骨链。细节与边界以 `02-physical/animal-studio/spec.md` 为准。

## 程序化动作（预览）

- Dock **动作（程序化）**（紧贴种子、位于「外观」之前）与视口左上角下拉共用 `ref(animationPreset)`（默认 **`none` / 无**），经 **`v-model:animation-preset`** 与 `CreatureViewport` 同步；每帧 **`sampleCreatureAnimation`** 作用于 `ProceduralCreature` 根组，**`applyCreatureJointAnimation`** 对 `Armature` 内 `THREE.Bone` 在静息姿态上叠加关节角（两足/四足按骨名编排，其余种类通配）。**合并体表 mesh 仍不蒙皮**、不随骨形变；骨架辅助层挂在于骨骼下，与骨同动。

## 扩展留口

- 新增 `kind`：在 `CREATURE_KINDS`、`defaultCreatureParams`、`buildCreature` switch 中增加分支与 UI 滑块块。
- 可拆分为多 `Mesh` 或加关节，需同步更新导出与 `spec.md` 边界说明。
