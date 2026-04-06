/** UTF-8 字符串 FNV-1a 32 */
export function fnv1a32String(s) {
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

/** 双段摘要，降低碰撞观感 */
export function contentHashDualFromString(str) {
  const a = fnv1a32String(str)
  const b = fnv1a32String(`${str}#${a}`)
  return `${a} · ${b}`
}
