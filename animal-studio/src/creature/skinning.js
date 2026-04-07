/**
 * 程序化粗模自动蒙皮：按顶点到骨段的距离倒数加权，取最强 4 影响并归一化。
 */

import * as THREE from 'three'

const _a = new THREE.Vector3()
const _b = new THREE.Vector3()
const _ab = new THREE.Vector3()
const _ap = new THREE.Vector3()
const _closest = new THREE.Vector3()

/**
 * @param {THREE.Vector3} p
 * @param {THREE.Vector3} segA
 * @param {THREE.Vector3} segB
 */
function distPointToSegmentSq(p, segA, segB) {
  _ab.subVectors(segB, segA)
  const abSq = _ab.lengthSq()
  if (abSq < 1e-12) {
    return p.distanceToSquared(segB)
  }
  _ap.subVectors(p, segA)
  const t = Math.max(0, Math.min(1, _ap.dot(_ab) / abSq))
  _closest.copy(segA).addScaledVector(_ab, t)
  return p.distanceToSquared(_closest)
}

/**
 * @param {THREE.Bone[]} orderedBones DFS 顺序，与 Skeleton.bones / skinIndex 一致
 * @param {THREE.Object3D} armature `Armature` 根组（绑定姿态下已 updateMatrixWorld）
 */
export function applySkinToGeometry(geometry, orderedBones, armature) {
  const posAttr = geometry.attributes.position
  if (!posAttr) return
  const n = posAttr.count
  const nB = orderedBones.length
  if (nB === 0) return

  const worldHead = new Array(nB)
  const indexByBone = new Map()
  for (let bi = 0; bi < nB; bi++) {
    indexByBone.set(orderedBones[bi], bi)
    const bone = orderedBones[bi]
    const v = new THREE.Vector3()
    bone.getWorldPosition(v)
    worldHead[bi] = v
  }

  const skinIndex = new Uint16Array(n * 4)
  const skinWeight = new Float32Array(n * 4)

  for (let vi = 0; vi < n; vi++) {
    const px = posAttr.getX(vi)
    const py = posAttr.getY(vi)
    const pz = posAttr.getZ(vi)
    _a.set(px, py, pz)

    const scores = []
    for (let bi = 0; bi < nB; bi++) {
      const bone = orderedBones[bi]
      const bWorld = worldHead[bi]
      let d2
      const par = bone.parent
      if (par?.isBone) {
        const pi = indexByBone.get(par)
        const pWorld = worldHead[pi]
        d2 = distPointToSegmentSq(_a, pWorld, bWorld)
      } else {
        d2 = _a.distanceToSquared(bWorld) + 1e-6
      }
      const w = 1 / (d2 + 2e-4)
      scores.push({ bi, w })
    }
    scores.sort((x, y) => y.w - x.w)
    let wsum = 0
    for (let k = 0; k < 4; k++) {
      const s = scores[Math.min(k, scores.length - 1)]
      skinIndex[vi * 4 + k] = s.bi
      skinWeight[vi * 4 + k] = s.w
      wsum += s.w
    }
    const inv = wsum > 1e-10 ? 1 / wsum : 1
    for (let k = 0; k < 4; k++) skinWeight[vi * 4 + k] *= inv
  }

  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4))
}

/**
 * @param {THREE.Object3D} armature
 * @returns {THREE.Bone[]}
 */
export function collectBonesDepthFirst(armature) {
  const root = armature.children.find((c) => c.isBone) || armature.getObjectByName('Root')
  if (!root?.isBone) return []
  const out = []
  function dfs(b) {
    out.push(b)
    const boneKids = b.children.filter((c) => c.isBone)
    for (const k of boneKids) dfs(k)
  }
  dfs(root)
  return out
}
