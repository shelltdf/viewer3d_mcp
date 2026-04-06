import { MATERIAL_MAP_KEYS } from './analyzeDuplicateResources.js'

/**
 * @typedef {{ id: string, column: number, kind: string, uuid: string, label: string, type: string, x?: number, y?: number, w?: number, h?: number }} ResourceGraphNode
 * @typedef {{ from: string, to: string, kind: string }} ResourceGraphEdge
 */

/**
 * 构建「场景节点 → Mesh → Material → Texture」引用图（仅含至少有一个可渲染 Mesh 的分支上的场景节点）。
 * @param {import('three').Object3D | null | undefined} root
 */
export function buildSceneResourceGraph(root) {
  /** @type {ResourceGraphNode[]} */
  const nodes = []
  /** @type {Map<string, ResourceGraphNode>} */
  const nodeById = new Map()
  /** @type {ResourceGraphEdge[]} */
  const edges = []
  const edgeSeen = new Set()

  if (!root) {
    return {
      nodes,
      edges,
      stats: { sceneNodes: 0, meshes: 0, materials: 0, textures: 0 },
    }
  }

  /** @param {string} from @param {string} to @param {string} kind */
  function pushEdge(from, to, kind) {
    const k = `${from}\0${to}\0${kind}`
    if (edgeSeen.has(k)) return
    edgeSeen.add(k)
    edges.push({ from, to, kind })
  }

  /** @param {number} col @param {string} kind @param {import('three').Object3D | import('three').Material | import('three').Texture} obj @param {string} label */
  function ensureNode(col, kind, obj, label) {
    const id = `${kind}:${obj.uuid}`
    let n = nodeById.get(id)
    if (n) return n
    const disp =
      label || (obj && 'name' in obj ? obj.name : '') || obj?.type || obj?.uuid?.slice(0, 8) || '—'
    n = {
      id,
      column: col,
      kind,
      uuid: obj.uuid,
      label: String(disp).slice(0, 42),
      type: obj.type || kind,
    }
    nodes.push(n)
    nodeById.set(id, n)
    return n
  }

  const meshes = []
  root.traverse((obj) => {
    if ((obj.isMesh || obj.isSkinnedMesh) && obj.geometry) meshes.push(obj)
  })

  /** @type {Set<import('three').Object3D>} */
  const relevantNonMesh = new Set()
  for (const mesh of meshes) {
    let p = mesh.parent
    while (p) {
      if (!p.isMesh && !p.isSkinnedMesh) relevantNonMesh.add(p)
      p = p.parent
    }
  }

  /** 场景列：沿根到 Mesh 的非 Mesh 祖先，按深度优先顺序排布 */
  const orderedScene = []
  const sceneVisited = new Set()

  /** @param {import('three').Object3D} o */
  function walkSceneTree(o) {
    if (!relevantNonMesh.has(o) || sceneVisited.has(o.uuid)) return
    sceneVisited.add(o.uuid)
    orderedScene.push(o)
    const kids = o.children.filter((c) => relevantNonMesh.has(c))
    kids.sort(
      (a, b) =>
        (a.name || '').localeCompare(b.name || '', 'en') ||
        a.uuid.localeCompare(b.uuid, 'en'),
    )
    for (const c of kids) walkSceneTree(c)
  }

  if (relevantNonMesh.has(root)) walkSceneTree(root)
  for (const o of relevantNonMesh) {
    if (!sceneVisited.has(o.uuid)) orderedScene.push(o)
  }

  for (const o of orderedScene) {
    ensureNode(0, 'scene', o, o.name || o.type)
  }

  for (const o of orderedScene) {
    const chNon = o.children.filter((c) => relevantNonMesh.has(c))
    for (const ch of chNon) {
      pushEdge(`scene:${o.uuid}`, `scene:${ch.uuid}`, 'hierarchy')
    }
  }

  /** Mesh 保持 traverse 深度优先顺序 */
  const orderedMeshes = []
  root.traverse((obj) => {
    if ((obj.isMesh || obj.isSkinnedMesh) && obj.geometry) orderedMeshes.push(obj)
  })
  for (const mesh of orderedMeshes) {
    ensureNode(1, 'mesh', mesh, mesh.name || mesh.type)
  }

  for (const mesh of orderedMeshes) {
    const parent = mesh.parent
    if (!parent) continue
    if (parent.isMesh || parent.isSkinnedMesh) {
      if (parent.geometry) {
        ensureNode(1, 'mesh', parent, parent.name || parent.type)
        pushEdge(`mesh:${parent.uuid}`, `mesh:${mesh.uuid}`, 'hierarchy')
      }
    } else if (relevantNonMesh.has(parent)) {
      pushEdge(`scene:${parent.uuid}`, `mesh:${mesh.uuid}`, 'hierarchy')
    }
  }

  /** @type {Map<string, import('three').Material>} */
  const materialUnique = new Map()
  for (const mesh of orderedMeshes) {
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (!mat) continue
      materialUnique.set(mat.uuid, mat)
      ensureNode(2, 'material', mat, mat.name || mat.type)
      pushEdge(`mesh:${mesh.uuid}`, `material:${mat.uuid}`, 'meshMat')
    }
  }

  /** @type {Map<string, import('three').Texture>} */
  const textureUnique = new Map()
  for (const mat of materialUnique.values()) {
    for (const key of MATERIAL_MAP_KEYS) {
      const tex = mat[key]
      if (!tex?.isTexture) continue
      textureUnique.set(tex.uuid, tex)
      const slotLabel = `${key}: ${tex.name || tex.uuid.slice(0, 8)}`
      ensureNode(3, 'texture', tex, slotLabel)
      pushEdge(`material:${mat.uuid}`, `texture:${tex.uuid}`, 'matTex')
    }
  }

  return {
    nodes,
    edges,
    stats: {
      sceneNodes: orderedScene.length,
      meshes: orderedMeshes.length,
      materials: materialUnique.size,
      textures: textureUnique.size,
    },
  }
}

const COL_W = 188
const ROW_H = 30
const GAP_X = 32
const PAD = 18
const NODE_H = 22
/** 为列标题留出顶部空间，避免与首行节点重叠 */
const TOP_LABEL = 24

/**
 * 四列横向排布，分配节点像素坐标供 SVG 渲染。
 * @param {{ nodes: ResourceGraphNode[], edges: ResourceGraphEdge[], stats?: object }} graph
 */
export function layoutSceneResourceGraph(graph) {
  const byCol = [[], [], [], []]
  for (const n of graph.nodes) {
    const c = n.column
    if (c >= 0 && c < 4) byCol[c].push(n)
  }

  byCol[2].sort(
    (a, b) =>
      a.label.localeCompare(b.label, 'en') || a.uuid.localeCompare(b.uuid, 'en'),
  )
  byCol[3].sort(
    (a, b) =>
      a.label.localeCompare(b.label, 'en') || a.uuid.localeCompare(b.uuid, 'en'),
  )

  for (let c = 0; c < 4; c++) {
    byCol[c].forEach((n, i) => {
      n.x = PAD + c * (COL_W + GAP_X)
      n.y = TOP_LABEL + PAD + i * ROW_H
      n.w = COL_W
      n.h = NODE_H
    })
  }

  const maxRows = Math.max(
    1,
    byCol[0].length,
    byCol[1].length,
    byCol[2].length,
    byCol[3].length,
  )
  const width = PAD * 2 + 4 * COL_W + 3 * GAP_X
  const height = TOP_LABEL + PAD * 2 + maxRows * ROW_H + 8

  const pos = new Map()
  for (const n of graph.nodes) {
    if (n.x != null && n.y != null && n.w != null && n.h != null) {
      pos.set(n.id, {
        x: n.x,
        y: n.y,
        w: n.w,
        h: n.h,
        cx: n.x + n.w / 2,
        cy: n.y + n.h / 2,
        xR: n.x + n.w,
      })
    }
  }

  return {
    ...graph,
    layout: { width, height, pos },
    columnLabels: ['场景节点', 'Mesh', '材质', '贴图'],
  }
}
