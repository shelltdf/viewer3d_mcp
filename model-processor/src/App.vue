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
  --mp-range-track-top: #283240;
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
  max-width: 280px;
  min-width: 72px;
  height: 26px;
  margin: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  accent-color: #5a9fd4;
  transition: filter 0.15s ease;
}
input[type='range']:hover {
  filter: brightness(1.06);
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
  height: 7px;
  border-radius: 4px;
  background: linear-gradient(180deg, var(--mp-range-track-top) 0%, var(--mp-range-track) 100%);
  border: 1px solid var(--mp-range-track-border);
  box-shadow:
    inset 0 1px 2px var(--mp-range-track-inset),
    0 0 0 1px rgba(255, 255, 255, 0.04);
}
input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  margin-top: -5px;
  border-radius: 50%;
  background: var(--mp-range-thumb);
  border: 1px solid var(--mp-range-thumb-border);
  box-shadow:
    var(--mp-range-thumb-shadow),
    0 0 0 1px rgba(0, 0, 0, 0.35);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
input[type='range']:hover::-webkit-slider-thumb {
  background: var(--mp-range-thumb-hover);
  border-color: #c8ddfc;
  transform: scale(1.04);
}
input[type='range']:active::-webkit-slider-thumb {
  transform: scale(1.08);
  box-shadow: 0 1px 6px rgba(90, 159, 212, 0.55);
}

input[type='range']::-moz-range-track {
  height: 7px;
  border-radius: 4px;
  background: linear-gradient(180deg, var(--mp-range-track-top) 0%, var(--mp-range-track) 100%);
  border: 1px solid var(--mp-range-track-border);
  box-shadow:
    inset 0 1px 2px var(--mp-range-track-inset),
    0 0 0 1px rgba(255, 255, 255, 0.04);
}
input[type='range']::-moz-range-progress {
  height: 7px;
  border-radius: 4px 0 0 4px;
  background: var(--mp-range-fill);
}
input[type='range']::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  border: 1px solid var(--mp-range-thumb-border);
  background: var(--mp-range-thumb);
  box-shadow:
    var(--mp-range-thumb-shadow),
    0 0 0 1px rgba(0, 0, 0, 0.35);
  cursor: pointer;
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
input[type='range']:hover::-moz-range-thumb {
  background: var(--mp-range-thumb-hover);
  border-color: #c8ddfc;
  transform: scale(1.04);
}
input[type='range']:active::-moz-range-thumb {
  transform: scale(1.08);
}

/* 弹窗等宽字段里的滑动条 */
.modal-panel .field input[type='range'] {
  flex: 1 1 160px;
  max-width: min(320px, 100%);
}
</style>
