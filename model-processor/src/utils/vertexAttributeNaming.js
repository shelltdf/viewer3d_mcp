/**
 * 界面展示用命名（几何体内仍使用 Three/glTF 常用键名：uv / uv2 / normal 等）。
 */

/** @type {string[]} 二通道 UV 的常见存储键顺序（越前越高优先级为「第一套 UV」） */
export const UV_ATTRIBUTE_KEYS_PRIORITY = [
  'uv',
  'uv2',
  'uv3',
  'uv4',
  'TEXCOORD_0',
  'TEXCOORD_1',
  'TEXCOORD_2',
  'TEXCOORD_3',
]

/**
 * @param {string} key geometry.attributes 键
 * @returns {string} 如 uv0、uv1、normal0、tangent0、color0
 */
export function displayVertexAttributeName(key) {
  const uvi = UV_ATTRIBUTE_KEYS_PRIORITY.indexOf(key)
  if (uvi >= 0) return `uv${uvi}`
  if (key === 'normal') return 'normal0'
  if (key === 'tangent') return 'tangent0'
  if (key === 'color' || key === 'COLOR_0') return 'color0'
  if (key === 'position') return 'position'
  return key
}

/**
 * @param {Record<string, unknown>} attributes geometry.attributes
 * @returns {string[]} 当前几何中存在的 UV 类属性键（按优先级排序）
 */
export function listUvAttributeKeys(attributes) {
  if (!attributes) return []
  const set = new Set(Object.keys(attributes))
  const out = []
  for (const k of UV_ATTRIBUTE_KEYS_PRIORITY) {
    if (set.has(k)) out.push(k)
  }
  for (const k of Object.keys(attributes).sort()) {
    if (out.includes(k)) continue
    const a = attributes[k]
    if (a && typeof a.itemSize === 'number' && a.itemSize === 2) {
      if (/^uv|^TEXCOORD/i.test(k) || k.includes('texcoord')) out.push(k)
    }
  }
  return out
}
