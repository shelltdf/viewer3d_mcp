<script setup>
import ModelWorkbench from './components/ModelWorkbench.vue'
</script>

<template>
  <ModelWorkbench />
</template>

<style>
*,
*::before,
*::after {
  box-sizing: border-box;
}
:root {
  /* 与 ModelWorkbench 深色壳层、工具栏 accent 一致 */
  --mp-range-track: #1f2630;
  --mp-range-track-border: #3a4558;
  --mp-range-track-inset: rgba(0, 0, 0, 0.35);
  --mp-range-fill: #2c3d52;
  --mp-range-thumb: linear-gradient(180deg, #9dc6f5 0%, #5a9fd4 42%, #3d72b8 100%);
  --mp-range-thumb-border: #a8caf0;
  --mp-range-thumb-hover: linear-gradient(180deg, #b8d7fc 0%, #6b9fe0 45%, #4f8fd4 100%);
  --mp-range-thumb-shadow: 0 1px 4px rgba(0, 0, 0, 0.5);
  --mp-range-focus: rgba(90, 159, 212, 0.45);
}
html,
body,
#app {
  height: 100%;
  margin: 0;
}
body {
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

/* 全局 range：与界面深蓝灰 + 冷色强调条统一（弹窗、侧栏、视口 HUD 等共用） */
input[type='range'] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  max-width: 260px;
  min-width: 72px;
  height: 22px;
  margin: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  accent-color: #5a9fd4;
}
input[type='range']:focus {
  outline: none;
}
input[type='range']:focus-visible {
  outline: 2px solid var(--mp-range-focus);
  outline-offset: 2px;
  border-radius: 4px;
}
input[type='range']:disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

input[type='range']::-webkit-slider-runnable-track {
  height: 6px;
  border-radius: 3px;
  background: var(--mp-range-track);
  border: 1px solid var(--mp-range-track-border);
  box-shadow: inset 0 1px 2px var(--mp-range-track-inset);
}
input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 15px;
  height: 15px;
  margin-top: -5px;
  border-radius: 50%;
  background: var(--mp-range-thumb);
  border: 1px solid var(--mp-range-thumb-border);
  box-shadow: var(--mp-range-thumb-shadow);
}
input[type='range']:hover::-webkit-slider-thumb {
  background: var(--mp-range-thumb-hover);
  border-color: #c8ddfc;
}

input[type='range']::-moz-range-track {
  height: 6px;
  border-radius: 3px;
  background: var(--mp-range-track);
  border: 1px solid var(--mp-range-track-border);
  box-shadow: inset 0 1px 2px var(--mp-range-track-inset);
}
input[type='range']::-moz-range-progress {
  height: 6px;
  border-radius: 3px 0 0 3px;
  background: var(--mp-range-fill);
}
input[type='range']::-moz-range-thumb {
  width: 15px;
  height: 15px;
  border-radius: 50%;
  border: 1px solid var(--mp-range-thumb-border);
  background: var(--mp-range-thumb);
  box-shadow: var(--mp-range-thumb-shadow);
  cursor: pointer;
}
input[type='range']:hover::-moz-range-thumb {
  background: var(--mp-range-thumb-hover);
  border-color: #c8ddfc;
}
</style>
