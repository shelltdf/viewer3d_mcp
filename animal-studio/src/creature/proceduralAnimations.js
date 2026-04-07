/**
 * 程序化粗模动作：
 * - **根 `ProceduralCreature` 组**：整体平移/旋转（locomotion 示意）。
 * - **骨骼 `Armature`**：每关节局部欧拉叠加；体表为 **SkinnedMesh** 时随手部/翅/躯干骨骼形变。
 */

import * as THREE from 'three'

const _e = new THREE.Euler(0, 0, 0, 'XYZ')
const _q = new THREE.Quaternion()

/**
 * @param {THREE.Object3D | null} armature
 */
export function resetBonesToRest(armature) {
  if (!armature) return
  armature.traverse((obj) => {
    if (!obj.isBone) return
    const u = obj.userData
    if (!u.restQuaternion) return
    obj.position.copy(u.restPosition)
    obj.quaternion.copy(u.restQuaternion)
    obj.scale.copy(u.restScale)
  })
}

/** @param {THREE.Object3D} armature */
function boneRot(armature, name, x, y = 0, z = 0) {
  const b = armature.getObjectByName(name)
  if (!b?.isBone || !b.userData.restQuaternion) return
  _e.set(x, y, z)
  _q.setFromEuler(_e)
  b.quaternion.copy(b.userData.restQuaternion).multiply(_q)
}

/** 四足腿名 FL/FR/BL/BR */
function applyQuadrupedLegs(
  armature,
  id,
  tSec,
  ph,
  ampHind,
  ampFront,
  kneeH,
  kneeF,
) {
  const swingH = (leg) => Math.sin(ph + (leg === 'FL' || leg === 'BR' ? 0 : Math.PI)) * ampHind
  const swingF = (leg) => Math.sin(ph + (leg === 'FR' || leg === 'BL' ? 0 : Math.PI)) * ampFront
  for (const leg of ['BL', 'BR']) {
    const s = swingH(leg)
    boneRot(armature, `Femur_${leg}`, s, 0, 0)
    boneRot(armature, `Tibia_${leg}`, Math.max(0, -s) * kneeH, 0, 0)
  }
  for (const leg of ['FL', 'FR']) {
    const s = swingF(leg)
    boneRot(armature, `Humerus_${leg}`, s, 0, 0)
    boneRot(armature, `RadiusUlna_${leg}`, Math.max(0, -s) * kneeF, 0, 0)
  }
}

function applyBipedJoints(armature, id, tSec) {
  const ph = tSec * Math.PI * 2
  switch (id) {
    case 'idle': {
      const s = ph * 0.62
      boneRot(armature, 'Lumbar', 0, Math.sin(s) * 0.04, Math.sin(s * 0.9) * 0.03)
      boneRot(armature, 'Thoracic', 0, Math.sin(s * 1.08 + 0.4) * 0.035, Math.sin(s * 0.77) * 0.025)
      boneRot(armature, 'Cervical', Math.sin(s * 1.1) * 0.02, Math.sin(s * 0.85) * 0.03, 0)
      boneRot(armature, 'Femur_L', Math.sin(s) * 0.015, 0, 0)
      boneRot(armature, 'Femur_R', Math.sin(s + Math.PI) * 0.015, 0, 0)
      boneRot(armature, 'Humerus_L', Math.sin(s + Math.PI) * 0.02, 0, 0)
      boneRot(armature, 'Humerus_R', Math.sin(s) * 0.02, 0, 0)
      break
    }
    case 'walk': {
      const w = ph * 0.92
      const thigh = Math.sin(w) * 0.42
      boneRot(armature, 'Femur_L', thigh, 0, 0)
      boneRot(armature, 'Femur_R', Math.sin(w + Math.PI) * 0.42, 0, 0)
      boneRot(armature, 'Tibia_L', Math.max(0, -Math.sin(w)) * 0.36, 0, 0)
      boneRot(armature, 'Tibia_R', Math.max(0, Math.sin(w)) * 0.36, 0, 0)
      boneRot(armature, 'Foot_L', Math.max(0, Math.sin(w)) * 0.12, 0, -(Math.sin(w) * 0.06))
      boneRot(armature, 'Foot_R', Math.max(0, -Math.sin(w)) * 0.12, 0, Math.sin(w) * 0.06)
      boneRot(armature, 'Humerus_L', Math.sin(w + Math.PI) * 0.26, 0, 0)
      boneRot(armature, 'Humerus_R', Math.sin(w) * 0.26, 0, 0)
      boneRot(armature, 'RadiusUlna_L', Math.max(0, Math.sin(w)) * 0.18, 0, 0)
      boneRot(armature, 'RadiusUlna_R', Math.max(0, -Math.sin(w)) * 0.18, 0, 0)
      boneRot(armature, 'Hand_L', Math.sin(w * 1.1) * 0.08, 0, 0)
      boneRot(armature, 'Hand_R', Math.sin(w * 1.1 + 1) * 0.08, 0, 0)
      boneRot(armature, 'Lumbar', Math.sin(w * 0.5) * 0.06, Math.sin(w * 0.35) * 0.04, 0)
      boneRot(armature, 'Thoracic', Math.sin(w * 0.45) * 0.05, 0, Math.sin(w * 0.4) * 0.03)
      boneRot(armature, 'Pelvis', 0, Math.sin(w * 0.4) * 0.03, Math.sin(w * 0.55) * 0.025)
      boneRot(armature, 'Cervical', -Math.abs(Math.sin(w * 2)) * 0.04, 0, 0)
      boneRot(armature, 'Skull', 0, Math.sin(w * 0.6) * 0.05, 0)
      break
    }
    case 'run': {
      const w = ph * 2.15
      const thigh = Math.sin(w) * 0.62
      boneRot(armature, 'Femur_L', thigh, 0, 0)
      boneRot(armature, 'Femur_R', Math.sin(w + Math.PI) * 0.62, 0, 0)
      boneRot(armature, 'Tibia_L', Math.max(0, -Math.sin(w)) * 0.55, 0, 0)
      boneRot(armature, 'Tibia_R', Math.max(0, Math.sin(w)) * 0.55, 0, 0)
      boneRot(armature, 'Foot_L', Math.max(0, Math.sin(w)) * 0.18, 0, 0)
      boneRot(armature, 'Foot_R', Math.max(0, -Math.sin(w)) * 0.18, 0, 0)
      boneRot(armature, 'Humerus_L', Math.sin(w + Math.PI) * 0.42, 0, -(Math.sin(w) * 0.08))
      boneRot(armature, 'Humerus_R', Math.sin(w) * 0.42, 0, Math.sin(w) * 0.08)
      boneRot(armature, 'RadiusUlna_L', Math.max(0, Math.sin(w)) * 0.26, 0, 0)
      boneRot(armature, 'RadiusUlna_R', Math.max(0, -Math.sin(w)) * 0.26, 0, 0)
      boneRot(armature, 'Lumbar', Math.sin(w * 0.55) * 0.1, 0, Math.sin(w * 0.5) * 0.05)
      boneRot(armature, 'Thoracic', 0.06, Math.sin(w * 0.48) * 0.06, 0)
      boneRot(armature, 'Pelvis', Math.sin(w * 2) * 0.04, 0, 0)
      boneRot(armature, 'Cervical', -Math.abs(Math.sin(w * 2)) * 0.1, 0, 0)
      break
    }
    case 'punch': {
      const w = ph * 0.85
      const snap = Math.sin(w)
      const strike = Math.pow(Math.max(0, snap), 3.2)
      boneRot(armature, 'Thoracic', -strike * 0.18, -strike * 0.25, strike * 0.1)
      boneRot(armature, 'Lumbar', strike * 0.06, strike * 0.1, 0)
      boneRot(armature, 'Humerus_R', -strike * 0.95, strike * 0.35, strike * 0.15)
      boneRot(armature, 'RadiusUlna_R', strike * 0.55, 0, 0)
      boneRot(armature, 'Hand_R', strike * 0.2, 0, 0)
      boneRot(armature, 'Humerus_L', strike * 0.12, 0, -strike * 0.08)
      boneRot(armature, 'Femur_L', strike * 0.05, 0, 0)
      boneRot(armature, 'Femur_R', -strike * 0.08, 0, 0)
      boneRot(armature, 'Cervical', 0, -strike * 0.12, strike * 0.08)
      boneRot(armature, 'Skull', strike * 0.05, 0, 0)
      break
    }
    case 'hit': {
      const w = ph * 1.35
      const f = Math.abs(Math.sin(w))
      boneRot(armature, 'Thoracic', f * 0.35, f * 0.12, -f * 0.15)
      boneRot(armature, 'Cervical', f * 0.25, f * 0.2, f * 0.18)
      boneRot(armature, 'Skull', -f * 0.15, f * 0.08, 0)
      boneRot(armature, 'Humerus_L', f * 0.28, 0, f * 0.12)
      boneRot(armature, 'RadiusUlna_L', f * 0.15, 0, 0)
      boneRot(armature, 'Humerus_R', -f * 0.2, 0, -f * 0.1)
      boneRot(armature, 'Lumbar', -f * 0.08, 0, f * 0.1)
      boneRot(armature, 'Pelvis', f * 0.1, 0, 0)
      boneRot(armature, 'Femur_L', -f * 0.06, 0, 0)
      boneRot(armature, 'Femur_R', f * 0.08, 0, 0)
      break
    }
    case 'knockdown': {
      const w = ph * 0.38
      const c = (Math.sin(w) + 1) * 0.5
      boneRot(armature, 'Pelvis', c * 0.95, c * 0.2, Math.sin(w * 0.5) * c * 0.2)
      boneRot(armature, 'Lumbar', c * 0.25, 0, 0)
      boneRot(armature, 'Thoracic', c * 0.4, c * 0.15, Math.sin(w * 0.7) * c * 0.2)
      boneRot(armature, 'Cervical', c * 0.35, 0, 0)
      boneRot(armature, 'Skull', c * 0.15, 0, 0)
      boneRot(armature, 'Femur_L', -c * 0.25, c * 0.08, 0)
      boneRot(armature, 'Femur_R', -c * 0.25, -c * 0.08, 0)
      boneRot(armature, 'Humerus_L', c * 0.35, 0, Math.sin(w) * c * 0.15)
      boneRot(armature, 'Humerus_R', c * 0.35, 0, -Math.sin(w) * c * 0.15)
      boneRot(armature, 'Tibia_L', c * 0.45, 0, 0)
      boneRot(armature, 'Tibia_R', c * 0.45, 0, 0)
      break
    }
    default:
      break
  }
}

function applyQuadrupedJoints(armature, id, tSec) {
  const ph = tSec * Math.PI * 2
  switch (id) {
    case 'idle': {
      const s = ph * 0.55
      applyQuadrupedLegs(armature, id, tSec, s, 0.06, 0.05, 0.35, 0.35)
      boneRot(armature, 'Tail_base', 0, 0, Math.sin(s) * 0.06)
      boneRot(armature, 'Tail_tip', 0, 0, Math.sin(s * 1.1 + 0.3) * 0.1)
      boneRot(armature, 'Lumbar', 0, Math.sin(s) * 0.03, 0)
      boneRot(armature, 'Cervical', Math.sin(s * 0.9) * 0.03, 0, 0)
      break
    }
    case 'walk': {
      const w = ph * 0.92
      applyQuadrupedLegs(armature, id, tSec, w, 0.38, 0.32, 0.42, 0.38)
      boneRot(armature, 'Lumbar', Math.sin(w * 0.5) * 0.08, 0, Math.sin(w * 0.45) * 0.04)
      boneRot(armature, 'Thoracic', Math.sin(w * 0.48) * 0.06, 0, 0)
      boneRot(armature, 'Cervical', -Math.abs(Math.sin(w * 2)) * 0.06, 0, 0)
      boneRot(armature, 'Tail_base', 0, 0, Math.sin(w * 0.9) * 0.12)
      boneRot(armature, 'Tail_tip', 0, 0, Math.sin(w * 1.1 + 0.4) * 0.18)
      break
    }
    case 'horseWalk': {
      // 马步：四拍节律，前后肢摆幅稍大，颈与头做更平稳点头
      const w = ph * 0.86
      applyQuadrupedLegs(armature, id, tSec, w + Math.PI * 0.16, 0.44, 0.36, 0.5, 0.44)
      boneRot(armature, 'Lumbar', Math.sin(w * 0.52) * 0.06, 0, Math.sin(w * 0.47) * 0.03)
      boneRot(armature, 'Thoracic', Math.sin(w * 0.5 + 0.25) * 0.05, 0, 0)
      boneRot(armature, 'Cervical', -Math.abs(Math.sin(w * 1.8)) * 0.08 + 0.02, 0, 0)
      boneRot(armature, 'Skull', Math.sin(w * 0.9 + 0.8) * 0.05, 0, 0)
      boneRot(armature, 'Tail_base', 0, 0, Math.sin(w * 0.95) * 0.1)
      boneRot(armature, 'Tail_tip', 0, 0, Math.sin(w * 1.18 + 0.45) * 0.15)
      break
    }
    case 'run': {
      const w = ph * 2.05
      applyQuadrupedLegs(armature, id, tSec, w, 0.55, 0.48, 0.55, 0.5)
      boneRot(armature, 'Lumbar', Math.sin(w * 0.55) * 0.12, 0, 0)
      boneRot(armature, 'Thoracic', 0.05, 0, Math.sin(w * 0.5) * 0.05)
      boneRot(armature, 'Cervical', -Math.abs(Math.sin(w * 2)) * 0.12, 0, 0)
      boneRot(armature, 'Tail_base', 0, 0, Math.sin(w * 1.2) * 0.18)
      boneRot(armature, 'Tail_tip', 0, 0, Math.sin(w * 1.45) * 0.28)
      break
    }
    case 'punch':
    case 'hit': {
      /** 四足无拳，用头颈与躯体甩动近似受击/扑击 */
      const w = ph * (id === 'hit' ? 1.35 : 0.85)
      const f = id === 'hit' ? Math.abs(Math.sin(w)) : Math.pow(Math.max(0, Math.sin(w)), 2)
      boneRot(armature, 'Cervical', f * 0.3, f * 0.15, 0)
      boneRot(armature, 'Skull', -f * 0.12, 0, 0)
      boneRot(armature, 'Thoracic', -f * 0.15, f * 0.1, 0)
      applyQuadrupedLegs(armature, id, tSec, w, f * 0.2, f * 0.18, 0.5, 0.45)
      boneRot(armature, 'Tail_base', 0, 0, f * 0.2)
      break
    }
    case 'knockdown': {
      const w = ph * 0.38
      const c = (Math.sin(w) + 1) * 0.5
      boneRot(armature, 'Pelvis', c * 0.85, c * 0.12, Math.sin(w * 0.5) * c * 0.15)
      boneRot(armature, 'Lumbar', c * 0.2, 0, 0)
      boneRot(armature, 'Thoracic', c * 0.35, 0, 0)
      boneRot(armature, 'Cervical', c * 0.4, 0, 0)
      boneRot(armature, 'Tail_base', c * 0.5, 0, 0)
      boneRot(armature, 'Tail_tip', c * 0.35, 0, 0)
      for (const leg of ['FL', 'FR', 'BL', 'BR']) {
        if (armature.getObjectByName(`Femur_${leg}`))
          boneRot(armature, `Femur_${leg}`, -c * 0.2, 0, 0)
        if (armature.getObjectByName(`Humerus_${leg}`))
          boneRot(armature, `Humerus_${leg}`, -c * 0.15, 0, 0)
      }
      break
    }
    default:
      break
  }
}

function applyGenericJointMotion(armature, id, tSec, kind) {
  const ph = tSec * Math.PI * 2
  const run = id === 'run'
  const amp = id === 'idle' ? 0.55 : run ? 1.25 : 1
  const kd =
    id === 'knockdown' ? (Math.sin(tSec * Math.PI * 2 * 0.38) + 1) * 0.5 : 0
  let i = 0
  armature.traverse((obj) => {
    if (!obj.isBone || !obj.userData.restQuaternion) return
    const n = obj.name
    let x = 0
    let y = 0
    let z = 0
    if (kd > 0 && /^(Pelvis|Spine|Body|Thorax|Vert_0)$/i.test(n)) {
      x += kd * 0.65
      y += kd * 0.12
    }
    if (/^(Tail|Spine|Vert|Abdomen|Lumbar|Thoracic|Neck|Cervical)/.test(n) || /Vert_/i.test(n)) {
      const phase = ph * (run ? 2 : 1.05) + i * 0.31
      z = Math.sin(phase) * 0.09 * amp
      x = Math.cos(phase * 0.92) * 0.05 * amp
      y = Math.sin(phase * 0.45) * 0.035 * amp
    }
    if (/Tail_|Tail$/i.test(n)) z += Math.sin(ph * (run ? 2.2 : 1.2) + i) * 0.12 * amp
    if (/Wing/i.test(n)) {
      const flap = Math.sin(ph * (run ? 5.5 : 2.8) + (n.includes('_L') ? 0 : Math.PI)) * (run ? 0.55 : 0.22)
      z += flap
      x += Math.cos(ph * 3 + i) * 0.08 * amp
    }
    if (/Leg_|Femur|Tibia|Coxa|Humerus|RadiusUlna|Paw_|Hip_/i.test(n)) {
      const phase = ph * (run ? 2 : 0.95) + i * 0.42 + (n.includes('_R') || n.includes('R_') ? Math.PI : 0)
      x += Math.sin(phase) * (id === 'idle' ? 0.06 : 0.28) * amp
      z += Math.cos(phase * 0.85) * 0.04 * amp
    }
    if (/^(Snout|Beak|Head)$/i.test(n) && id === 'punch') {
      const strike = Math.pow(Math.max(0, Math.sin(ph * 0.85)), 2)
      x -= strike * 0.35
    }
    if (/Head|Skull/i.test(n) && id === 'hit') {
      const f = Math.abs(Math.sin(ph * 1.35))
      y += f * 0.15
      z += f * 0.1
    }
    i += 1
    if (x !== 0 || y !== 0 || z !== 0) {
      _e.set(x, y, z)
      _q.setFromEuler(_e)
      obj.quaternion.copy(obj.userData.restQuaternion).multiply(_q)
    }
  })
}

/**
 * 在已 `resetBonesToRest` 后调用；内部会对整棵 `Armature` 再复位并叠加本帧关节角。
 * @param {THREE.Object3D | null} armature
 * @param {string} id
 * @param {number} tSec
 * @param {string} kind
 */
function applyWingFlapJoints(armature, tSec, kind) {
  const ph = tSec * Math.PI * 2 * 3.25
  const flap = Math.sin(ph)
  const c = Math.cos(ph)
  const has = (n) => !!armature.getObjectByName(n)

  if (has('Wing_L') && has('Wing_R')) {
    boneRot(armature, 'Wing_L', 0.12 * flap, 0.08 * c, 0.88 * flap)
    boneRot(armature, 'Wing_R', -0.12 * flap, -0.08 * c, -0.88 * flap)
  }
  if (has('Thoracic')) boneRot(armature, 'Thoracic', 0.06 * flap, 0, 0.03 * flap)
  if (has('Body')) boneRot(armature, 'Body', 0.05 * flap, 0, 0.02 * flap)
  if (has('Humerus_L')) boneRot(armature, 'Humerus_L', 0.22 * flap, 0.06 * c, 0.48 * flap)
  if (has('Humerus_R')) boneRot(armature, 'Humerus_R', 0.22 * flap, -0.06 * c, -0.48 * flap)
  if (has('Humerus_FL')) {
    applyQuadrupedLegs(armature, 'wingFlap', tSec, ph * 0.38, 0.09, 0.08, 0.42, 0.36)
  }
  if (has('Tail_base')) boneRot(armature, 'Tail_base', 0, 0, 0.09 * Math.sin(ph * 0.92))
  if (has('Spine')) boneRot(armature, 'Spine', 0.06 * flap, 0, 0.07 * Math.sin(ph * 0.75))
  if (kind === 'fish' && has('Tail_base')) {
    boneRot(armature, 'Tail_base', 0, 0, 0.35 * flap)
    boneRot(armature, 'Tail_tip', 0, 0, 0.45 * Math.sin(ph * 1.1))
  }
}

function applyGlideJoints(armature, tSec, kind) {
  const ph = tSec * Math.PI * 2 * 0.38
  const sway = Math.sin(ph)
  const has = (n) => !!armature.getObjectByName(n)

  if (has('Wing_L') && has('Wing_R')) {
    boneRot(armature, 'Wing_L', 0.07, 0.24, 0.58 + 0.035 * sway)
    boneRot(armature, 'Wing_R', 0.07, -0.24, -0.58 - 0.035 * sway)
  }
  if (has('Body')) boneRot(armature, 'Body', 0.24 + 0.02 * sway, 0, sway * 0.04)
  if (has('Thoracic')) boneRot(armature, 'Thoracic', 0.11, 0, 0.045 * sway)
  if (has('Neck')) boneRot(armature, 'Neck', 0.05 * sway, 0, 0)
  if (has('Lumbar')) boneRot(armature, 'Lumbar', 0.04 * sway, 0, 0.02 * sway)
  if (has('Humerus_L')) boneRot(armature, 'Humerus_L', 0.16, 0.1, 0.38)
  if (has('Humerus_R')) boneRot(armature, 'Humerus_R', 0.16, -0.1, -0.38)
  if (has('Tail_base')) boneRot(armature, 'Tail_base', -0.03, 0, 0.1 * sway)
  if (has('Spine')) boneRot(armature, 'Spine', 0.03 * sway, 0, 0.05 * Math.sin(tSec * 0.88))
  if (has('Cervical')) boneRot(armature, 'Cervical', 0.08, 0, sway * 0.05)
  if (has('Skull')) boneRot(armature, 'Skull', 0.02 * sway, 0, 0)
  if (kind === 'fish' && has('Spine')) {
    boneRot(armature, 'Spine', 0.05 * sway, 0, 0.12 * Math.sin(tSec * 0.7))
    boneRot(armature, 'Tail_base', 0, 0, 0.2 * sway)
    boneRot(armature, 'Tail_tip', 0, 0, 0.25 * Math.sin(tSec * 0.55))
  }
}

export function applyCreatureJointAnimation(armature, id, tSec, kind = 'quadruped') {
  resetBonesToRest(armature)
  if (!armature || !id || id === 'none') return

  if (id === 'wingFlap') {
    applyWingFlapJoints(armature, tSec, kind)
    return
  }
  if (id === 'glide') {
    applyGlideJoints(armature, tSec, kind)
    return
  }

  switch (kind) {
    case 'biped':
      applyBipedJoints(armature, id, tSec)
      return
    case 'quadruped':
      applyQuadrupedJoints(armature, id, tSec)
      return
    default:
      applyGenericJointMotion(armature, id, tSec, kind)
  }
}
export const CREATURE_ANIMATIONS = [
  { id: 'none', label: '无' },
  { id: 'idle', label: '待机' },
  { id: 'walk', label: '走路' },
  { id: 'horseWalk', label: '马步' },
  { id: 'run', label: '跑步' },
  { id: 'wingFlap', label: '扑翼' },
  { id: 'glide', label: '滑翔' },
  { id: 'punch', label: '重拳打击' },
  { id: 'hit', label: '被击中' },
  { id: 'knockdown', label: '倒地（循环）' },
]

/**
 * @param {string} id
 * @param {number} tSec 时间（秒）
 * @param {string} kind CREATURE_KINDS id
 * @returns {{ px: number, py: number, pz: number, rx: number, ry: number, rz: number }}
 */
export function sampleCreatureAnimation(id, tSec, kind = 'biped') {
  const quad = kind === 'quadruped'
  const low = quad || kind === 'fish' || kind === 'reptile' || kind === 'amphibian'
  const bobM = low ? 0.45 : 1
  const tiltM = low ? 0.55 : 1
  const swayM = low ? 0.5 : 1

  switch (id) {
    case 'none':
      return { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }
    case 'walk': {
      const ph = tSec * Math.PI * 2 * 0.92
      return {
        px: Math.sin(ph) * 0.042 * swayM,
        py: Math.abs(Math.sin(ph * 2)) * 0.028 * bobM,
        pz: 0,
        rx: Math.sin(ph) * 0.05 * tiltM,
        ry: Math.sin(ph * 0.35) * 0.02,
        rz: Math.sin(ph * 0.5) * 0.035 * swayM,
      }
    }
    case 'horseWalk': {
      const ph = tSec * Math.PI * 2 * 0.86
      return {
        px: Math.sin(ph) * 0.048 * swayM,
        py: Math.abs(Math.sin(ph * 2)) * 0.022 * bobM,
        pz: 0,
        rx: Math.sin(ph) * 0.042 * tiltM,
        ry: Math.sin(ph * 0.3) * 0.016,
        rz: Math.sin(ph * 0.52) * 0.028 * swayM,
      }
    }
    case 'run': {
      const ph = tSec * Math.PI * 2 * 2.15
      return {
        px: Math.sin(ph) * 0.055 * swayM,
        py: Math.abs(Math.sin(ph * 2)) * 0.05 * bobM,
        pz: 0,
        rx: 0.1 * tiltM + Math.sin(ph) * 0.06 * tiltM,
        ry: Math.sin(ph * 0.45) * 0.04,
        rz: Math.sin(ph * 0.55) * 0.05 * swayM,
      }
    }
    case 'punch': {
      const ph = tSec * Math.PI * 2 * 0.85
      const snap = Math.sin(ph)
      const strike = Math.pow(Math.max(0, snap), 3.2)
      return {
        px: strike * 0.12,
        py: strike * 0.015,
        pz: snap * 0.025,
        rx: -strike * 0.08 * tiltM,
        ry: -strike * 0.22,
        rz: strike * 0.14,
      }
    }
    case 'hit': {
      const ph = tSec * Math.PI * 2 * 1.35
      const f = Math.abs(Math.sin(ph))
      return {
        px: -f * 0.06,
        py: f * 0.018 * bobM,
        pz: -f * 0.04,
        rx: f * 0.18 * tiltM,
        ry: f * 0.08,
        rz: (-f * 0.12 * swayM),
      }
    }
    case 'knockdown': {
      const ph = tSec * Math.PI * 2 * 0.38
      const c = (Math.sin(ph) + 1) * 0.5
      return {
        px: c * 0.04,
        py: -c * 0.14,
        pz: c * 0.02,
        rx: c * (quad ? 0.75 : 1.25),
        ry: c * 0.15,
        rz: c * (Math.sin(ph * 0.5) * 0.2),
      }
    }
    case 'idle':
      return {
        px: 0,
        py: Math.sin(tSec * 1.15) * 0.006 * bobM,
        pz: 0,
        rx: 0,
        ry: 0,
        rz: Math.sin(tSec * 0.62) * 0.012 * swayM,
      }
    case 'wingFlap': {
      const f = Math.sin(tSec * Math.PI * 2 * 2.85)
      return {
        px: 0,
        py: Math.abs(Math.sin(tSec * Math.PI * 2 * 3.15)) * 0.02 * bobM,
        pz: 0,
        rx: f * 0.05 * tiltM,
        ry: 0,
        rz: f * 0.022 * swayM,
      }
    }
    case 'glide': {
      const ph = tSec * 0.52
      return {
        px: Math.sin(ph) * 0.038 * swayM,
        py: Math.sin(tSec * 0.4) * 0.028 * bobM,
        pz: Math.cos(ph * 0.68) * 0.09 * swayM,
        rx: 0.13 * tiltM + Math.sin(tSec * 0.29) * 0.045,
        ry: Math.sin(tSec * 0.26) * 0.052,
        rz: Math.cos(tSec * 0.21) * 0.042 * swayM,
      }
    }
    default:
      return { px: 0, py: 0, pz: 0, rx: 0, ry: 0, rz: 0 }
  }
}
