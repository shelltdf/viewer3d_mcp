# 模型元素 → 源码映射（animal-studio）

| 元素 | 路径 |
|------|------|
| 类型列表、子物种表、`subspecies` 预设、`defaultCreatureParams`、`applySubspeciesPreset`、关节表、`createArmatureFromBones`、`captureBoneRestPose`、`attachSkeletonVisualization`、`SkinnedMesh` 合并 | `animal-studio/src/creature/proceduralCreature.js` |
| 自动 `skinIndex`/`skinWeight`、骨 DFS 序 | `animal-studio/src/creature/skinning.js` |
| 动作预设、`sampleCreatureAnimation`（根组）、`applyCreatureJointAnimation` / `resetBonesToRest`（骨骼） | `animal-studio/src/creature/proceduralAnimations.js` |
| 主框架与 Dock | `animal-studio/src/App.vue` |
| 导出克隆、去掉关节可视化几何、`AnimationClip` 烘焙 | `animal-studio/src/creature/bakeExport.js` |
| 视口与 ZIP 导出 | `animal-studio/src/components/CreatureViewport.vue` |
| 应用挂载 | `animal-studio/src/main.js` |
| 开发启动脚本 | `animal-studio/run_web.py` |
