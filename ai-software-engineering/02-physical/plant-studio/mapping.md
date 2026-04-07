# 模型元素 → 源码映射（plant-studio）

| 元素 | 路径 |
|------|------|
| 参数默认值与生成入口 | `plant-studio/src/plant/proceduralTree.js`（`defaultPlantParams`、`buildProceduralPlant`） |
| 环境/风默认值与颜色解析 | `plant-studio/src/plant/sceneSettings.js` |
| 主布局与参数绑定 | `plant-studio/src/App.vue` |
| 视口、渲染循环、导出 | `plant-studio/src/components/PlantViewport.vue` |
| 应用挂载 | `plant-studio/src/main.js` |
| 开发服务器启动（Python） | `plant-studio/run_web.py` |
