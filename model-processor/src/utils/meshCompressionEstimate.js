import { estimateGeometryBytes } from './memoryEstimate.js'

const ALIGN = 16

function alignUp(n) {
  if (!n || n <= 0) return 0
  return Math.ceil(n / ALIGN) * ALIGN
}

/**
 * 网格几何「编码后体积」粗估（Draco / Meshopt / 量化），仅供对比参考，非真实编码器输出。
 * @param {import('three').BufferGeometry | null | undefined} geo
 */
export function getMeshGeometryCompressionEstimates(geo) {
  const raw = geo?.isBufferGeometry ? estimateGeometryBytes(geo) : 0
  if (raw <= 0) return []

  const lo = (f) => Math.max(alignUp(256), Math.round(raw * f))

  return [
    {
      label: '未压缩（当前 BufferGeometry 合计）',
      bytes: raw,
      note: '各 attribute + index 缓冲区粗估；与对齐假设见 memoryEstimate',
    },
    {
      label: 'Draco（偏乐观）',
      bytes: lo(0.12),
      note: '拓扑与顶点越规则越偏小；噪声/细分越高越差',
    },
    {
      label: 'Draco（中位粗估）',
      bytes: lo(0.25),
      note: '常见网格的经验占位，非编码器比特流',
    },
    {
      label: 'Draco（保守）',
      bytes: lo(0.45),
      note: '难压缩或已高度优化过的数据',
    },
    {
      label: 'EXT_meshopt_compression（粗估）',
      bytes: lo(0.32),
      note: '与量化步长、过滤器相关；常配合 glTF 流式读取',
    },
    {
      label: '顶点量化（16-bit 等，示意）',
      bytes: lo(0.58),
      note: '主要缩短 POSITION/NORMAL 等；索引与元数据未细分',
    },
  ]
}
