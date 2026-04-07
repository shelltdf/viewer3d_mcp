/**
 * 视口环境、光照与风动默认值（与 PlantViewport / App 绑定字段一致）。
 */

/** @returns {Record<string, unknown>} */
export function defaultEnvSettings() {
  return {
    background: '#3d4a5c',
    exposure: 1.32,
    /** @type {'aces' | 'linear' | 'reinhard' | 'cineon' | 'neutral'} */
    toneMapping: 'aces',
    shadowEnabled: true,
    ambientColor: '#e8eef5',
    ambientIntensity: 0.55,
    hemiSky: '#b8d4f0',
    hemiGround: '#6b5a4a',
    hemiIntensity: 0.42,
    sunColor: '#fff8f0',
    sunIntensity: 1.45,
    sunAzimuthDeg: 42,
    sunElevationDeg: 52,
    fillColor: '#c8d4ff',
    fillIntensity: 0.38,
    groundColor: '#4a5a52',
  }
}

/** @returns {Record<string, unknown>} */
export function defaultWindSettings() {
  return {
    enabled: true,
    strength: 0.65,
    speed: 1.0,
    /** 树干/枝整体摆动相对叶片的权重（0 仅叶动） */
    trunkSway: 0.35,
  }
}

/**
 * @param {string} hex
 * @param {number} fallback
 */
export function hexToColorNum(hex, fallback = 0x808080) {
  const s = String(hex ?? '').trim()
  if (!s) return fallback
  const raw = s.startsWith('#') ? s.slice(1) : s
  const n = parseInt(raw, 16)
  return Number.isFinite(n) && raw.length >= 6 ? n : fallback
}
