/**
 * 导出用：去掉骨架辅助实体、可选去掉体表几何、烘焙程序化动作为 AnimationClip。
 */

import * as THREE from 'three'
import { AnimationClip, QuaternionKeyframeTrack, VectorKeyframeTrack } from 'three'
import { captureBoneRestPose } from './proceduralCreature.js'
import {
  applyCreatureJointAnimation,
  resetBonesToRest,
  sampleCreatureAnimation,
} from './proceduralAnimations.js'

/** 移除挂在骨骼下的关节球与骨线（避免打进 glTF） */
export function stripSkeletonViz(root) {
  const removeList = []
  root.traverse((o) => {
    if (o.name.startsWith('JointViz_') || o.name.startsWith('BoneLine_')) removeList.push(o)
  })
  for (const o of removeList) {
    o.parent?.remove(o)
    o.geometry?.dispose?.()
    const mat = o.material
    if (mat) {
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.())
      else mat.dispose?.()
    }
  }
}

/** 用空 Group 占位，保持与 model.glb 同节点名与层级，便于 DCC 按节点名对齐 */
export function replaceCreatureBodyWithGroup(root) {
  const mesh = root.getObjectByName('CreatureBody')
  if (!mesh || (!mesh.isMesh && !mesh.isSkinnedMesh)) return
  const parent = mesh.parent
  if (!parent) return
  const pos = mesh.position.clone()
  const quat = mesh.quaternion.clone()
  const scl = mesh.scale.clone()
  parent.remove(mesh)
  if (mesh.isSkinnedMesh) mesh.skeleton?.dispose?.()
  mesh.geometry?.dispose?.()
  const mat = mesh.material
  if (mat) {
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.())
    else mat.dispose?.()
  }
  const g = new THREE.Group()
  g.name = 'CreatureBody'
  g.position.copy(pos)
  g.quaternion.copy(quat)
  g.scale.copy(scl)
  parent.add(g)
}

export function prepareCreatureExportClone(root, { stripBodyMesh }) {
  const c = root.clone(true)
  stripSkeletonViz(c)
  const arm = c.getObjectByName('Armature')
  if (arm) captureBoneRestPose(arm)
  if (stripBodyMesh) replaceCreatureBodyWithGroup(c)
  return c
}

export function resetCreatureBindPose(root) {
  const gy = Number(root.userData?.groundOffsetY) || 0
  root.position.set(0, gy, 0)
  root.rotation.set(0, 0, 0)
  root.scale.set(1, 1, 1)
  const arm = root.getObjectByName('Armature')
  resetBonesToRest(arm)
  root.updateMatrixWorld(true)
}

export function getBakedClipDurationSec(preset) {
  const map = {
    none: 1,
    idle: 4,
    walk: 2.2,
    run: 1.65,
    wingFlap: 1.9,
    glide: 6,
    punch: 2.5,
    hit: 2,
    knockdown: 2.6,
  }
  return map[preset] ?? 2
}

/**
 * @param {THREE.Group} root `ProceduralCreature` 克隆（已 strip、可选已去掉 mesh）
 * @returns {THREE.AnimationClip}
 */
export function bakeCreatureAnimationClip(root, preset, kind, fps = 30) {
  const duration = getBakedClipDurationSec(preset)
  const n = Math.max(2, Math.ceil(duration * fps))
  const times = new Float32Array(n)
  const arm = root.getObjectByName('Armature')
  const boneNames = []
  if (arm) arm.traverse((o) => o.isBone && boneNames.push(o.name))

  const rootPos = new Float32Array(n * 3)
  const rootQuat = new Float32Array(n * 4)
  const boneQuats = new Map()
  for (const name of boneNames) boneQuats.set(name, new Float32Array(n * 4))

  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * duration
    times[i] = t
    resetCreatureBindPose(root)
    const pose = sampleCreatureAnimation(preset, t, kind)
    const gy = Number(root.userData?.groundOffsetY) || 0
    root.position.set(pose.px, pose.py + gy, pose.pz)
    root.rotation.set(pose.rx, pose.ry, pose.rz, 'XYZ')
    applyCreatureJointAnimation(arm, preset, t, kind)
    root.updateMatrixWorld(true)
    rootPos[i * 3] = root.position.x
    rootPos[i * 3 + 1] = root.position.y
    rootPos[i * 3 + 2] = root.position.z
    rootQuat[i * 4] = root.quaternion.x
    rootQuat[i * 4 + 1] = root.quaternion.y
    rootQuat[i * 4 + 2] = root.quaternion.z
    rootQuat[i * 4 + 3] = root.quaternion.w
    for (const name of boneNames) {
      const b = arm.getObjectByName(name)
      const q = b.quaternion
      const o = i * 4
      const arr = boneQuats.get(name)
      arr[o] = q.x
      arr[o + 1] = q.y
      arr[o + 2] = q.z
      arr[o + 3] = q.w
    }
  }

  const rootName = root.name || 'ProceduralCreature'
  const tracks = [
    new VectorKeyframeTrack(`${rootName}.position`, times, rootPos),
    new QuaternionKeyframeTrack(`${rootName}.quaternion`, times, rootQuat),
  ]

  const eps = 1e-4
  for (const name of boneNames) {
    const arr = boneQuats.get(name)
    let moving = false
    for (let i = 1; i < n; i++) {
      const o = i * 4
      if (
        Math.abs(arr[o] - arr[0]) > eps ||
        Math.abs(arr[o + 1] - arr[1]) > eps ||
        Math.abs(arr[o + 2] - arr[2]) > eps ||
        Math.abs(arr[o + 3] - arr[3]) > eps
      ) {
        moving = true
        break
      }
    }
    if (moving) tracks.push(new QuaternionKeyframeTrack(`${name}.quaternion`, times, arr))
  }

  return new AnimationClip(`creature_${preset}`, duration, tracks)
}

/** 释放克隆树上的几何体与材质 */
export function disposeExportClone(root) {
  if (!root) return
  root.traverse((o) => {
    if (o.isSkinnedMesh) o.skeleton?.dispose?.()
    if (o.isMesh) {
      o.geometry?.dispose?.()
      const mat = o.material
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose?.())
        else mat.dispose?.()
      }
    }
    if (o.isLine || o.isLineSegments) {
      o.geometry?.dispose?.()
      o.material?.dispose?.()
    }
  })
}
