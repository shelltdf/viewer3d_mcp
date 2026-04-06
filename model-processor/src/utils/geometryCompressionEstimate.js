import { estimateGeometryBytes } from './memoryEstimate.js'

/**
 * Mesh 几何在常见管线下的体积粗估（非真实压缩结果；Draco 等取决于编码器与数据分布）。
 * @param {import('three').BufferGeometry | null} geo
 */
export function estimateGeometryCompressionRows(geo) {
  const raw = geo?.isBufferGeometry ? estimateGeometryBytes(geo) : 0
  if (!raw) {
    return [{ id: 'raw', label: '原始缓冲区', bytes: 0, note: '无几何数据' }]
  }
  const hasMorph = geo.morphAttributes && Object.keys(geo.morphAttributes).length > 0
  const morphNote = hasMorph ? '含 morph 目标时实际可更高。' : ''
  return [
    { id: 'raw', label: '原始（CPU/GPU 缓冲区）', bytes: raw, note: '与 estimateGeometryBytes 一致。' },
    {
      id: 'draco_default',
      label: 'Draco 几何压缩（默认/中，粗估）',
      bytes: Math.max(align16(raw * 0.22), 64),
      note: `典型约为主缓冲的 15%–35%；${morphNote}`,
    },
    {
      id: 'draco_best',
      label: 'Draco（追求更小，粗估）',
      bytes: Math.max(align16(raw * 0.12), 64),
      note: '更慢、更小；数值为经验区间。',
    },
    {
      id: 'meshopt',
      label: 'Meshopt（quantize + 压缩，粗估）',
      bytes: Math.max(align16(raw * 0.32), 64),
      note: '常与 gltfpack 等工具联用。',
    },
    {
      id: 'quantize_16',
      label: '仅 16 位量化（无熵编码，粗估）',
      bytes: Math.max(align16(raw * 0.55), 64),
      note: '位置/法线等量化为 16 位的大致下限之一。',
    },
  ]
}

function align16(n) {
  return Math.ceil(n / 16) * 16
}
