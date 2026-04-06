/**
 * 几何内容指纹：用于判断两份 BufferGeometry 是否「顶点属性一致」（与 uuid 无关）。
 * 对大缓冲区采用稀疏采样哈希，避免阻塞主线程。
 */

/**
 * @param {import('three').BufferAttribute | import('three').InterleavedBufferAttribute} attr
 */
function attributeFingerprint(attr) {
  if (!attr) return 'nil'
  const arr = attr.array
  if (!arr || !arr.byteLength) return `${attr.count || 0}:${attr.itemSize || 0}:empty`
  const len = arr.byteLength
  const view = new Uint8Array(arr.buffer, arr.byteOffset, len)
  let h = (len ^ (attr.itemSize << 8) ^ (attr.count << 16)) >>> 0
  const step = Math.max(1, Math.floor(len / 8192))
  for (let i = 0; i < len; i += step) {
    h = Math.imul(h ^ view[i], 0x01000193) >>> 0
  }
  // 头尾再采一点，降低「中间被改」的碰撞
  for (let i = 0; i < Math.min(32, len); i++) h = Math.imul(h ^ view[i], 0x01000193) >>> 0
  for (let i = Math.max(0, len - 32); i < len; i++) h = Math.imul(h ^ view[i], 0x01000193) >>> 0
  return `${attr.count}:${attr.itemSize}:${h.toString(16)}`
}

/**
 * @param {import('three').BufferGeometry} geo
 * @returns {string}
 */
export function geometryContentSignature(geo) {
  if (!geo?.isBufferGeometry) return 'no-buffer-geometry'
  const names = Object.keys(geo.attributes || {}).sort()
  const parts = []
  for (const name of names) {
    const a = geo.attributes[name]
    parts.push(`${name}:${attributeFingerprint(a)}`)
  }
  if (geo.index) {
    parts.push(`index:${attributeFingerprint(geo.index)}`)
  }
  parts.push(`groups:${geo.groups?.length || 0}`)
  return parts.join('|')
}
