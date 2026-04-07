# 模型元素 → 源码映射（animal-studio）

| 元素 | 路径 |
|------|------|
| 类型列表、子物种表、`subspecies` 预设、`defaultCreatureParams`、`CREATURE_DISPLAY_PARAM_KEYS`、`creatureGeometryFingerprint`、`applySubspeciesPreset`、关节表、`createArmatureFromBones`、`captureBoneRestPose`、`attachSkeletonVisualization`、`SkinnedMesh` 合并、`skeletonJointRadius` | `animal-studio/src/creature/proceduralCreature.js` |
| 自动 `skinIndex`/`skinWeight`、骨 DFS 序、**`attachRagdollShapeExtentsFromSkin`**（表皮→`ragdollHalfExtents`） | `animal-studio/src/creature/skinning.js` |
| 动作预设、`sampleCreatureAnimation`（根组）、`applyCreatureJointAnimation` / `resetBonesToRest`（骨骼） | `animal-studio/src/creature/proceduralAnimations.js` |
| 主框架、左参数 Dock、右信息 Dock（层级+当前选中） | `animal-studio/src/App.vue` |
| 导出克隆、去掉关节可视化几何、`AnimationClip` 烘焙 | `animal-studio/src/creature/bakeExport.js` |
| cannon-es：`createRagdoll`（World/刚体/约束/线框）、`step`、`syncBonesFromPhysics`、`syncBodiesFromBones` | `animal-studio/src/creature/ragdollPhysics.js` |
| 视口与 ZIP 导出、`rebuildRagdollPhysics`（生成后即建物理）、按关节 `JointHitbox_*`、选择拾取与信息上报 | `animal-studio/src/components/CreatureViewport.vue` |
| 菜单栏「物理布娃娃」、`ragdollEnabled` | `animal-studio/src/App.vue` |
| 应用挂载 | `animal-studio/src/main.js` |
| 开发启动脚本 | `animal-studio/run_web.py` |
