/** GLSL ES 1.0 保留字与易冲突名（属性名不可用） */
const GLSL_BLOCKED = new Set([
  'void',
  'float',
  'int',
  'uint',
  'bool',
  'vec2',
  'vec3',
  'vec4',
  'mat2',
  'mat3',
  'mat4',
  'sampler2D',
  'samplerCube',
  'attribute',
  'uniform',
  'varying',
  'const',
  'if',
  'else',
  'for',
  'while',
  'break',
  'continue',
  'return',
  'discard',
  'in',
  'out',
  'inout',
  'struct',
  'layout',
  'invariant',
  'lowp',
  'mediump',
  'highp',
  'precision',
])

/**
 * 网格 `geometry.attributes` 的实际键 → 界面显示名（从 0 编号）
 * @param {string} key
 */
export function vertexAttrDisplayName(key) {
  if (key === 'uv') return 'uv0'
  if (key === 'uv2') return 'uv1'
  if (key === 'uv3') return 'uv2'
  if (key === 'normal') return 'normal0'
  if (key === 'tangent') return 'tangent0'
  if (key === 'color' || key === 'COLOR_0') return 'color0'
  return key
}

/** @param {string} name */
export function isValidGlslAttributeName(name) {
  if (!name || typeof name !== 'string') return false
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) return false
  if (GLSL_BLOCKED.has(name)) return false
  return true
}

/**
 * 用于「顶点属性」调试着色下拉：仅保留可编成自定义 Shader 的属性名
 * @param {string[]} keys
 */
/**
 * 切线缓冲出现 NaN 时会导致 PBR/法线贴图管线整单元剔除，表现为「模型消失」。
 * @param {import('three').BufferGeometry} geometry
 */
export function sanitizeTangentAttribute(geometry) {
  const t = geometry?.getAttribute?.('tangent')
  if (!t?.array) return
  const a = t.array
  const n = t.count
  for (let i = 0; i < n; i++) {
    const o = i * 4
    const x = a[o]
    const y = a[o + 1]
    const z = a[o + 2]
    const w = a[o + 3]
    if (![x, y, z, w].every(Number.isFinite)) {
      a[o] = 1
      a[o + 1] = 0
      a[o + 2] = 0
      a[o + 3] = 1
      continue
    }
    const len = Math.hypot(x, y, z)
    if (len < 1e-10) {
      a[o] = 1
      a[o + 1] = 0
      a[o + 2] = 0
      a[o + 3] = w < 0 ? -1 : 1
    }
  }
  t.needsUpdate = true
}

export function filterAttributeKeysForVertexDebugShader(keys) {
  const builtinsOk = new Set([
    'position',
    'normal',
    'uv',
    'uv2',
    'uv3',
    'color',
    'COLOR_0',
    'tangent',
    'skinIndex',
    'skinWeight',
  ])
  return keys.filter((k) => builtinsOk.has(k) || isValidGlslAttributeName(k))
}
