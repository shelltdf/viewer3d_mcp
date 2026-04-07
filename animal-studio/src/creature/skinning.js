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
 * 按「主权重」将顶点归到一根骨，沿父关节→该骨世界位置的主轴做 OBB，得到与体表体积一致的盒半轴长（刚体本地 **Y** 沿骨向，`halfX`≈`halfZ` 为横向包络）。
 * 顶点取网格局部坐标再乘 `SkinnedMesh.matrixWorld`，与地平上移后的角色一致。
 * @param {THREE.SkinnedMesh} skinnedMesh
 * @param {THREE.Bone[]} orderedBones 与 `Skeleton.bones` / `skinIndex` 下标一致
 * @param {THREE.Object3D} armature `Armature`（用于根骨父关节世界位置）
 */
export function attachRagdollShapeExtentsFromSkin(skinnedMesh, orderedBones, armature) {
  const geom = skinnedMesh.geometry
  const posAttr = geom.getAttribute('position')
  const skinIdx = geom.getAttribute('skinIndex')
  const skinW = geom.getAttribute('skinWeight')
  if (!posAttr || !skinIdx || !skinW) return

  const nB = orderedBones.length
  if (nB === 0) return

  skinnedMesh.updateMatrixWorld(true)
  armature.updateMatrixWorld(true)
  const meshW = skinnedMesh.matrixWorld

  /** @type {THREE.Vector3[][]} */
  const buckets = Array.from({ length: nB }, () => [])
  const v = new THREE.Vector3()

  for (let vi = 0; vi < posAttr.count; vi++) {
    const w0 = skinW.getX(vi)
    const w1 = skinW.getY(vi)
    const w2 = skinW.getZ(vi)
    const w3 = skinW.getW(vi)
    let maxW = w0
    let k = 0
    if (w1 > maxW) {
      maxW = w1
      k = 1
    }
    if (w2 > maxW) {
      maxW = w2
      k = 2
    }
    if (w3 > maxW) {
      k = 3
    }
    if (maxW < 0.06) continue

    let bIdx = skinIdx.getX(vi)
    if (k === 1) bIdx = skinIdx.getY(vi)
    else if (k === 2) bIdx = skinIdx.getZ(vi)
    else if (k === 3) bIdx = skinIdx.getW(vi)
    if (bIdx < 0 || bIdx >= nB) continue

    v.fromBufferAttribute(posAttr, vi)
    v.applyMatrix4(meshW)
    buckets[bIdx].push(v.clone())
  }

  const p0 = new THREE.Vector3()
  const p1 = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const rel = new THREE.Vector3()

  for (let bi = 0; bi < nB; bi++) {
    const bone = orderedBones[bi]
    const pts = buckets[bi]
    const parent = bone.parent

    if (!parent?.isBone) {
      p0.set(0, 0, 0).applyMatrix4(armature.matrixWorld)
    } else {
      parent.getWorldPosition(p0)
    }
    bone.getWorldPosition(p1)

    dir.subVectors(p1, p0)
    const segLen = Math.max(dir.length(), 0.04)
    dir.multiplyScalar(1 / segLen)

    const minPts = 3
    if (pts.length < minPts) {
      delete bone.userData.ragdollHalfExtents
      continue
    }

    let minT = Infinity
    let maxT = -Infinity
    let maxRSq = 0
    for (const pw of pts) {
      rel.subVectors(pw, p0)
      const t = rel.dot(dir)
      minT = Math.min(minT, t)
      maxT = Math.max(maxT, t)
      const perpSq = Math.max(0, rel.lengthSq() - t * t)
      if (perpSq > maxRSq) maxRSq = perpSq
    }

    minT = Math.min(minT, 0)
    maxT = Math.max(maxT, segLen)

    let halfY = (maxT - minT) * 0.5
    halfY = Math.max(halfY, segLen * 0.42, 0.016)
    halfY = Math.min(halfY, segLen * 2.35)

    let rad = Math.sqrt(maxRSq) * 1.08 + 0.004
    rad = Math.max(rad, segLen * 0.055, 0.007)
    rad = Math.min(rad, segLen * 1.35 + 0.12)

    bone.userData.ragdollHalfExtents = new THREE.Vector3(rad, halfY, rad)
  }
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
