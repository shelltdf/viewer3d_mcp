# 组件图（animal-studio）

```mermaid
flowchart LR
  subgraph page [Browser SDI]
    App[App.vue]
    VP[CreatureViewport.vue]
    Gen[proceduralCreature.js]
    Three[Three.js WebGL]
    App --> VP
    App -->|params| VP
    VP --> Gen
    VP --> Three
  end
```

- **App.vue**：Dock Area、参数表单、`localStorage` 持久化、视图菜单。
- **CreatureViewport.vue**：场景生命周期、相机、ZIP（model.glb + animation.glb + manifest）。
- **proceduralCreature.js**：类型分派与几何构建，无 Vue 依赖。
