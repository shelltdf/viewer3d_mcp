import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import {
  applySkinToGeometry,
  attachRagdollShapeExtentsFromSkin,
  collectBonesDepthFirst,
} from './skinning.js'

const _Y = new THREE.Vector3(0, 1, 0)

/**
 * @typedef {{ name: string, pos: THREE.Vector3, parent: string | null }} BoneJoint
 */

/** @param {THREE.Vector3} a @param {THREE.Vector3} b @param {number} t */
function vecLerp(a, b, t) {
  return new THREE.Vector3().lerpVectors(a, b, t)
}

/** @param {number} seed */
export function mulberry32(seed) {
  let t = seed >>> 0
  return function () {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

export const CREATURE_KINDS = [
  { id: 'biped', label: '两足动物' },
  { id: 'quadruped', label: '四足动物' },
  { id: 'fish', label: '鱼类' },
  { id: 'insect', label: '昆虫' },
  { id: 'bird', label: '鸟类' },
  { id: 'reptile', label: '爬行类' },
  { id: 'amphibian', label: '两栖类' },
]

/**
 * 每大类下的子物种（示意比例，非测量学精度）。
 * @type {Record<string, { id: string, label: string }[]>}
 */
export const CREATURE_SUBSPECIES = {
  biped: [
    { id: 'man', label: '男人' },
    { id: 'woman', label: '女人' },
    { id: 'child', label: '儿童' },
  ],
  quadruped: [
    { id: 'horse', label: '马' },
    { id: 'cow', label: '牛' },
    { id: 'dog', label: '狗' },
    { id: 'pig', label: '猪' },
    { id: 'cat', label: '猫' },
  ],
  fish: [
    { id: 'carp', label: '鲤鱼' },
    { id: 'tuna', label: '金枪鱼' },
    { id: 'goldfish', label: '金鱼' },
  ],
  insect: [
    { id: 'ant', label: '蚂蚁' },
    { id: 'bee', label: '蜜蜂' },
    { id: 'butterfly', label: '蝴蝶' },
    { id: 'beetle', label: '甲虫' },
  ],
  bird: [
    { id: 'chicken', label: '鸡' },
    { id: 'eagle', label: '鹰' },
    { id: 'sparrow', label: '麻雀' },
  ],
  reptile: [
    { id: 'lizard', label: '蜥蜴' },
    { id: 'crocodile', label: '鳄鱼' },
    { id: 'turtle', label: '龟' },
  ],
  amphibian: [
    { id: 'frog', label: '蛙' },
    { id: 'salamander', label: '蝾螈' },
  ],
}

/**
 * 子物种 → 与 defaultCreatureParams 同形的比例字段（仅覆盖列出的键）。
 * @type {Record<string, Record<string, Record<string, number>>>}
 */
const SUBSPECIES_PRESETS = {
  biped: {
    /** 成人男性：肩略宽、躯干略厚、头占高约 1/7.5 */
    man: {
      torsoHeight: 0.78,
      shoulderWidth: 0.47,
      legLength: 0.88,
      armLength: 0.72,
      headSize: 0.186,
      limbRadius: 0.065,
      kneeAlongLeg: 0.52,
      elbowAlongArm: 0.56,
      bipedHipSpread: 0.15,
      bipedFootSpread: 0.19,
    },
    /** 成人女性：肩窄、骨盆相对明显（用略宽髋间距近似）、腿身比略长 */
    woman: {
      torsoHeight: 0.7,
      shoulderWidth: 0.39,
      legLength: 0.93,
      armLength: 0.66,
      headSize: 0.17,
      limbRadius: 0.054,
      kneeAlongLeg: 0.535,
      elbowAlongArm: 0.555,
      bipedHipSpread: 0.19,
      bipedFootSpread: 0.16,
    },
    child: {
      torsoHeight: 0.52,
      shoulderWidth: 0.33,
      legLength: 0.58,
      armLength: 0.5,
      headSize: 0.165,
      limbRadius: 0.044,
      kneeAlongLeg: 0.5,
      elbowAlongArm: 0.52,
      bipedHipSpread: 0.13,
      bipedFootSpread: 0.14,
    },
  },
  quadruped: {
    /** 马：长颈、长腿；肢端腕/球节、跗更靠下（长掌骨/跖骨），关节 t 应显著 >0.5 */
    horse: {
      bodyLength: 1.06,
      bodyHeight: 0.35,
      legLength: 0.7,
      neckLen: 0.56,
      headSize: 0.152,
      tailLen: 0.44,
      quadStanceX: 0.318,
      quadStanceZ: 0.268,
      quadKneeAlongLeg: 0.61,
      quadKneeAlongLegFront: 0.585,
      quadKneeAlongLegHind: 0.695,
      quadNeckForward: 0.41,
      quadTailZ: 0.335,
    },
    cow: {
      bodyLength: 0.92,
      bodyHeight: 0.46,
      legLength: 0.4,
      neckLen: 0.26,
      headSize: 0.17,
      tailLen: 0.12,
      quadStanceX: 0.36,
      quadStanceZ: 0.18,
      quadKneeAlongLeg: 0.54,
      quadNeckForward: 0.3,
      quadTailZ: 0.3,
    },
    dog: {
      bodyLength: 0.62,
      bodyHeight: 0.3,
      legLength: 0.46,
      neckLen: 0.22,
      headSize: 0.13,
      tailLen: 0.3,
      quadStanceX: 0.33,
      quadStanceZ: 0.21,
      quadKneeAlongLeg: 0.51,
      quadNeckForward: 0.28,
      quadTailZ: 0.28,
    },
    pig: {
      bodyLength: 0.78,
      bodyHeight: 0.5,
      legLength: 0.3,
      neckLen: 0.16,
      headSize: 0.16,
      tailLen: 0.07,
      quadStanceX: 0.32,
      quadStanceZ: 0.17,
      quadKneeAlongLeg: 0.55,
      quadNeckForward: 0.22,
      quadTailZ: 0.24,
    },
    cat: {
      bodyLength: 0.48,
      bodyHeight: 0.24,
      legLength: 0.36,
      neckLen: 0.17,
      headSize: 0.1,
      tailLen: 0.36,
      quadStanceX: 0.3,
      quadStanceZ: 0.19,
      quadKneeAlongLeg: 0.5,
      quadNeckForward: 0.27,
      quadTailZ: 0.3,
    },
  },
  fish: {
    carp: { bodyLen: 1.0, bodyHeight: 0.38, tailSpread: 0.4, finHeight: 0.22 },
    tuna: { bodyLen: 1.28, bodyHeight: 0.2, tailSpread: 0.3, finHeight: 0.16 },
    goldfish: { bodyLen: 0.52, bodyHeight: 0.44, tailSpread: 0.52, finHeight: 0.26 },
  },
  insect: {
    ant: { segmentCount: 3, segmentRadius: 0.075, legSpan: 0.48, wingSpan: 0.02 },
    bee: { segmentCount: 3, segmentRadius: 0.105, legSpan: 0.4, wingSpan: 0.62 },
    butterfly: { segmentCount: 3, segmentRadius: 0.085, legSpan: 0.32, wingSpan: 0.95 },
    beetle: { segmentCount: 3, segmentRadius: 0.125, legSpan: 0.36, wingSpan: 0.38 },
  },
  bird: {
    chicken: { bodySize: 0.3, neckLen: 0.11, headSize: 0.095, wingSpan: 0.52, legLen: 0.17, tailLen: 0.14 },
    eagle: { bodySize: 0.27, neckLen: 0.2, headSize: 0.115, wingSpan: 1.22, legLen: 0.26, tailLen: 0.28 },
    sparrow: { bodySize: 0.17, neckLen: 0.075, headSize: 0.07, wingSpan: 0.48, legLen: 0.11, tailLen: 0.11 },
  },
  reptile: {
    lizard: { bodyLen: 0.52, bodyH: 0.15, legLen: 0.22, tailLen: 1.05, neckLen: 0.11, headLen: 0.13 },
    crocodile: { bodyLen: 1.12, bodyH: 0.21, legLen: 0.17, tailLen: 0.88, neckLen: 0.28, headLen: 0.34 },
    turtle: { bodyLen: 0.52, bodyH: 0.13, legLen: 0.11, tailLen: 0.06, neckLen: 0.06, headLen: 0.075 },
  },
  amphibian: {
    frog: { bodyW: 0.58, bodyH: 0.19, legLen: 0.3, headSize: 0.14 },
    salamander: { bodyW: 0.4, bodyH: 0.17, legLen: 0.13, headSize: 0.11 },
  },
}

/**
 * @param {THREE.Vector3} a
 * @param {THREE.Vector3} b
 */
function limbCylinder(a, b, r0, r1, segs = 14) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  if (len < 1e-5) return null
  dir.normalize()
  const g = new THREE.CylinderGeometry(r1, r0, len, segs, 2, false)
  const q = new THREE.Quaternion().setFromUnitVectors(_Y, dir)
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
  g.applyMatrix4(new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)))
  return g
}

/** @param {THREE.Vector3} c */
function sphere(c, r, segs = 16) {
  const g = new THREE.SphereGeometry(r, segs, Math.max(8, Math.floor(segs * 0.55)))
  g.translate(c.x, c.y, c.z)
  return g
}

/** 位似椭球（单位球缩放），躯干/头型轮廓比盒体更接近动物体态 */
function ellipsoid(c, rx, ry, rz, segs = 20) {
  const g = new THREE.SphereGeometry(1, segs, Math.max(10, Math.floor(segs * 0.5)))
  g.scale(Math.max(1e-4, rx), Math.max(1e-4, ry), Math.max(1e-4, rz))
  g.translate(c.x, c.y, c.z)
  return g
}

/** @param {THREE.Vector3} c */
function box(c, sx, sy, sz) {
  const g = new THREE.BoxGeometry(sx, sy, sz, 3, 3, 3)
  g.translate(c.x, c.y, c.z)
  return g
}

/**
 * 两足足底扁盒：长轴对齐膝–踝在水平面投影（脚尖方向），避免轴与世界 Z 固定时与斜向小腿脱节。
 */
function orientedSoleBox(ankle, kneePt, soleW, soleH, soleLen) {
  const horiz = new THREE.Vector3(ankle.x - kneePt.x, 0, ankle.z - kneePt.z)
  if (horiz.lengthSq() < 1e-10) horiz.set(0, 0, 1)
  else horiz.normalize()
  const center = ankle.clone().addScaledVector(horiz, soleLen * 0.36)
  center.y = soleH * 0.5
  const g = new THREE.BoxGeometry(soleW, soleH, soleLen, 2, 2, 2)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), horiz)
  g.applyMatrix4(new THREE.Matrix4().compose(center, q, new THREE.Vector3(1, 1, 1)))
  return g
}

/** @param {THREE.Vector3} c axis along Z */
function cone(c, r, h, axis = new THREE.Vector3(0, 0, 1)) {
  const g = new THREE.ConeGeometry(r, h, 14)
  const q = new THREE.Quaternion().setFromUnitVectors(_Y, axis.clone().normalize())
  g.applyMatrix4(
    new THREE.Matrix4().compose(
      c.clone().addScaledVector(axis, h * 0.5),
      q,
      new THREE.Vector3(1, 1, 1),
    ),
  )
  return g
}

/**
 * 将骨架球/骨线挂到 `THREE.Bone` 子层级，关节旋转时可视化与骨骼一致。
 * @param {THREE.Object3D} armature `Armature` 根节点
 * @param {number} jointRadius
 */
function attachSkeletonVisualization(armature, jointRadius) {
  /** 辅助层：不参与深度测试，避免被合并体表完全挡住 */
  const overlayOrder = 1000
  const jr = Math.max(0.008, jointRadius)
  const lineMat = new THREE.LineBasicMaterial({
    color: 0x55ee99,
    transparent: true,
    opacity: 0.95,
    depthTest: false,
    depthWrite: false,
  })
  const jointMat = new THREE.MeshBasicMaterial({
    color: 0xffaa44,
    transparent: true,
    opacity: 0.92,
    depthTest: false,
    depthWrite: false,
  })

  armature.traverse((obj) => {
    if (!obj.isBone) return
    const sg = new THREE.SphereGeometry(jr, 10, 8)
    const m = new THREE.Mesh(sg, jointMat)
    m.name = `JointViz_${obj.name}`
    m.renderOrder = overlayOrder + 1
    obj.add(m)

    for (const ch of obj.children) {
      if (!ch.isBone) continue
      const pts = [new THREE.Vector3(0, 0, 0), ch.position.clone()]
      const geo = new THREE.BufferGeometry().setFromPoints(pts)
      const line = new THREE.Line(geo, lineMat)
      line.name = `BoneLine_${obj.name}_to_${ch.name}`
      line.renderOrder = overlayOrder
      obj.add(line)
    }
  })
}

/**
 * 显示/隐藏 `attachSkeletonVisualization` 生成的关节球与骨线（不改变层级，仅改 `visible`）。
 * @param {THREE.Object3D} armature
 * @param {boolean} visible
 */
export function setSkeletonVisualizationVisible(armature, visible) {
  armature.traverse((obj) => {
    if (obj.name.startsWith('JointViz_') || obj.name.startsWith('BoneLine_')) obj.visible = visible
  })
}

/** 记录静息局部 transform，供每帧复位后叠加关节动画（导出烘焙等复用） */
export function captureBoneRestPose(armature) {
  armature.traverse((obj) => {
    if (!obj.isBone) return
    obj.userData.restPosition = obj.position.clone()
    obj.userData.restQuaternion = obj.quaternion.clone()
    obj.userData.restScale = obj.scale.clone()
  })
}

/**
 * 由世界坐标关节生成 THREE.Bone 层级（先全部挂到 Armature，再 attach 保持世界矩阵）。
 * @param {BoneJoint[]} bones
 */
function createArmatureFromBones(bones) {
  const armature = new THREE.Group()
  armature.name = 'Armature'
  if (!bones.length) return armature

  const byName = new Map()
  for (const b of bones) {
    const bone = new THREE.Bone()
    bone.name = b.name
    bone.position.copy(b.pos)
    armature.add(bone)
    byName.set(b.name, bone)
  }

  for (const b of bones) {
    if (!b.parent || !byName.has(b.parent)) continue
    const bone = byName.get(b.name)
    const parentBone = byName.get(b.parent)
    parentBone.attach(bone)
  }

  return armature
}

/**
 * 将当前 `params.subspecies` 的比例写入 params（不改 seed / scale / hue / 图层类 `show*` 等）。
 * @param {Record<string, unknown>} params
 */
export function applySubspeciesPreset(params) {
  const kind = params.kind
  const id = params.subspecies
  if (typeof kind !== 'string' || typeof id !== 'string') return
  const table = SUBSPECIES_PRESETS[kind]
  if (!table || !table[id]) return
  const preset = table[id]
  for (const [k, v] of Object.entries(preset)) {
    if (typeof v === 'number') params[k] = v
  }
}

/**
 * @param {string} kind
 */
export function defaultCreatureParams(kind) {
  const base = {
    kind,
    seed: 42,
    scale: 1,
    hue: 0.52,
    saturation: 0.45,
    lightness: 0.48,
    showSkeleton: true,
    /** SkinnedMesh；与视口 / Dock 共用 */
    showCreatureModel: true,
    /** 每关节 hitbox（JointHitboxes） */
    showCreatureHitbox: false,
    /** 布娃娃碰撞调试线框；与视口 / Dock 共用 */
    showCreaturePhysics: false,
  }
  const extras = {
    biped: {
      torsoHeight: 0.85,
      shoulderWidth: 0.42,
      legLength: 0.95,
      armLength: 0.72,
      headSize: 0.2,
      limbRadius: 0.07,
      kneeAlongLeg: 0.53,
      elbowAlongArm: 0.55,
      bipedHipSpread: 0.15,
      bipedFootSpread: 0.18,
    },
    quadruped: {
      bodyLength: 0.75,
      bodyHeight: 0.38,
      legLength: 0.45,
      neckLen: 0.35,
      headSize: 0.18,
      tailLen: 0.25,
      horseWorkflow: 'procedural',
      quadStanceX: 0.35,
      quadStanceZ: 0.2,
      quadKneeAlongLeg: 0.52,
      quadNeckForward: 0.32,
      quadTailZ: 0.32,
    },
    fish: { bodyLen: 1.1, bodyHeight: 0.35, tailSpread: 0.45, finHeight: 0.25 },
    insect: { segmentCount: 3, segmentRadius: 0.12, legSpan: 0.55, wingSpan: 0.7 },
    bird: { bodySize: 0.28, neckLen: 0.15, headSize: 0.12, wingSpan: 0.95, legLen: 0.22, tailLen: 0.2 },
    reptile: { bodyLen: 0.95, bodyH: 0.22, legLen: 0.28, tailLen: 0.85, neckLen: 0.2, headLen: 0.22 },
    amphibian: { bodyW: 0.55, bodyH: 0.22, legLen: 0.18, headSize: 0.16 },
  }
  const k = kind in extras ? kind : 'quadruped'
  const merged = { ...base, ...extras[k] }
  const firstSub = CREATURE_SUBSPECIES[k]?.[0]?.id
  merged.subspecies = typeof firstSub === 'string' ? firstSub : 'man'
  applySubspeciesPreset(merged)
  return merged
}

/** 仅视口图层，不改变几何；`CreatureViewport` 用其区分「重建网格」与「只更新显示」 */
export const CREATURE_DISPLAY_PARAM_KEYS = ['showSkeleton', 'showCreatureModel', 'showCreatureHitbox', 'showCreaturePhysics']

/**
 * 去掉图层字段后的快照，用于判断是否需要 `buildCreature`。
 * @param {Record<string, unknown>} params
 */
export function creatureGeometryFingerprint(params) {
  const o = { ...params }
  for (const k of CREATURE_DISPLAY_PARAM_KEYS) delete o[k]
  try {
    return JSON.stringify(o)
  } catch {
    return String(Math.random())
  }
}

/**
 * 统计每根骨的主导顶点数量与平均主导权重（用于 UI 信息面板）。
 * @param {THREE.SkinnedMesh} skinnedMesh
 * @param {THREE.Bone[]} orderedBones
 */
function computeBoneWeightStats(skinnedMesh, orderedBones) {
  const out = {}
  const geom = skinnedMesh.geometry
  const skinIdx = geom.getAttribute('skinIndex')
  const skinW = geom.getAttribute('skinWeight')
  if (!skinIdx || !skinW) return out
  for (const b of orderedBones) {
    out[b.name] = { dominantVertexCount: 0, avgDominantWeight: 0 }
  }
  for (let i = 0; i < skinIdx.count; i++) {
    const w0 = skinW.getX(i)
    const w1 = skinW.getY(i)
    const w2 = skinW.getZ(i)
    const w3 = skinW.getW(i)
    let slot = 0
    let w = w0
    if (w1 > w) {
      w = w1
      slot = 1
    }
    if (w2 > w) {
      w = w2
      slot = 2
    }
    if (w3 > w) {
      w = w3
      slot = 3
    }
    const bi = slot === 0 ? skinIdx.getX(i) : slot === 1 ? skinIdx.getY(i) : slot === 2 ? skinIdx.getZ(i) : skinIdx.getW(i)
    const bone = orderedBones[bi]
    if (!bone) continue
    const rec = out[bone.name]
    rec.dominantVertexCount += 1
    rec.avgDominantWeight += w
  }
  for (const rec of Object.values(out)) {
    if (rec.dominantVertexCount > 0) rec.avgDominantWeight /= rec.dominantVertexCount
  }
  return out
}

/**
 * @param {ReturnType<defaultCreatureParams>} p
 * @param {() => number} rng
 * @returns {{ geoms: THREE.BufferGeometry[], bones: BoneJoint[] }}
 */
function buildBiped(p, rng) {
  const geoms = []
  /** @type {BoneJoint[]} */
  const bones = []
  const s = p.scale
  const th = p.torsoHeight * s
  const sw = p.shoulderWidth * s
  const ll = p.legLength * s
  const al = p.armLength * s
  const hr = p.headSize * s
  const lr = p.limbRadius * s * (0.85 + rng() * 0.3)

  const hipY = ll
  const shoulderY = hipY + th * 0.85
  const hip = new THREE.Vector3(0, hipY, 0)
  const hipJ = Math.min(0.24, Math.max(0.1, Number(p.bipedHipSpread) || 0.15))
  const footSpr = Math.min(0.26, Math.max(0.11, Number(p.bipedFootSpread) || 0.18))
  const footL = new THREE.Vector3(-sw * footSpr, 0, rng() * 0.02)
  const footR = new THREE.Vector3(sw * footSpr, 0, rng() * 0.02)

  const shL = new THREE.Vector3(-sw * 0.42, shoulderY, 0)
  const shR = new THREE.Vector3(sw * 0.42, shoulderY, 0)
  const handL = shL.clone().add(new THREE.Vector3(-al * 0.2, -al * 0.85, rng() * 0.05))
  const handR = shR.clone().add(new THREE.Vector3(al * 0.2, -al * 0.85, rng() * 0.05))

  const hipL = hip.clone().add(new THREE.Vector3(-sw * hipJ, 0, 0))
  const hipR = hip.clone().add(new THREE.Vector3(sw * hipJ, 0, 0))
  const kneeT = Math.min(0.62, Math.max(0.42, Number(p.kneeAlongLeg) || 0.53))
  const elbowT = Math.min(0.65, Math.max(0.45, Number(p.elbowAlongArm) || 0.55))
  const kneeL = vecLerp(hipL, footL, kneeT)
  const kneeR = vecLerp(hipR, footR, kneeT)
  const elbowL = vecLerp(shL, handL, elbowT)
  const elbowR = vecLerp(shR, handR, elbowT)

  const headC = new THREE.Vector3(0, shoulderY + hr * 0.88, rng() * 0.02)
  const neckLower = new THREE.Vector3(0, shoulderY - th * 0.05, rng() * 0.01)
  const neckUpper = headC.clone().add(new THREE.Vector3(0, -hr * 0.52, -hr * 0.1))

  /** 骨盆 + 胸腹椭球，比单盒更像人体轮廓；颈为细圆柱 */
  geoms.push(ellipsoid(new THREE.Vector3(0, hipY + th * 0.14, 0), sw * 0.32, th * 0.21, sw * 0.17))
  geoms.push(ellipsoid(new THREE.Vector3(0, hipY + th * 0.5, 0), sw * 0.37, th * 0.52, sw * 0.21))
  geoms.push(limbCylinder(neckLower, neckUpper, lr * 0.44, lr * 0.34))
  geoms.push(ellipsoid(headC, hr * 0.9, hr * 1.03, hr * 0.91))

  /** 股骨/胫骨、肱骨/前臂两段圆锥台，膝肘位置与骨骼一致 */
  const hipAttachL = hip.clone().add(new THREE.Vector3(-sw * hipJ, 0, 0))
  const hipAttachR = hip.clone().add(new THREE.Vector3(sw * hipJ, 0, 0))
  geoms.push(limbCylinder(hipAttachL, kneeL, lr * 1.16, lr * 0.96))
  geoms.push(limbCylinder(kneeL, footL, lr * 0.94, lr * 0.7))
  geoms.push(limbCylinder(hipAttachR, kneeR, lr * 1.16, lr * 0.96))
  geoms.push(limbCylinder(kneeR, footR, lr * 0.94, lr * 0.7))

  geoms.push(limbCylinder(shL, elbowL, lr * 0.96, lr * 0.84))
  geoms.push(limbCylinder(elbowL, handL, lr * 0.8, lr * 0.54))
  geoms.push(limbCylinder(shR, elbowR, lr * 0.96, lr * 0.84))
  geoms.push(limbCylinder(elbowR, handR, lr * 0.8, lr * 0.54))

  /** 脚掌 / 手掌：足长∝腿长、掌示意尺寸∝臂长；旧版按 limbRadius 缩放会远小于真人比例 */
  const soleLen = ll * 0.24
  const soleW = soleLen * 0.4
  const soleH = soleLen * 0.13
  geoms.push(orientedSoleBox(footL, kneeL, soleW, soleH, soleLen))
  geoms.push(orientedSoleBox(footR, kneeR, soleW, soleH, soleLen))

  const handAlong = al * 0.19
  const palmW = handAlong * 0.46
  const palmH = handAlong * 0.34
  const palmD = handAlong * 0.55
  function palmCenter(wrist, elbowPt) {
    const v = new THREE.Vector3().subVectors(wrist, elbowPt)
    if (v.lengthSq() < 1e-10) return wrist.clone().add(new THREE.Vector3(0, -palmH * 0.4, palmD * 0.2))
    v.normalize()
    return wrist.clone().addScaledVector(v, palmD * 0.42)
  }
  geoms.push(box(palmCenter(handL, elbowL), palmW, palmH, palmD))
  geoms.push(box(palmCenter(handR, elbowR), palmW, palmH, palmD))

  /** 脊椎动物直立姿态：Root→骨盆→腰椎→胸椎→颈椎→颅骨；后肢 股骨→胫骨→足；前肢 肱骨→桡尺→手 */
  const lumbarP = new THREE.Vector3(0, hipY + th * 0.28, 0)
  const thoracicP = new THREE.Vector3(0, hipY + th * 0.53, 0)
  const cervicalP = neckLower.clone().lerp(neckUpper, 0.35)

  bones.push({ name: 'Root', pos: new THREE.Vector3(0, 0, 0), parent: null })
  bones.push({ name: 'Pelvis', pos: hip.clone(), parent: 'Root' })
  bones.push({ name: 'Lumbar', pos: lumbarP, parent: 'Pelvis' })
  bones.push({ name: 'Thoracic', pos: thoracicP, parent: 'Lumbar' })
  bones.push({ name: 'Cervical', pos: cervicalP, parent: 'Thoracic' })
  bones.push({ name: 'Skull', pos: headC.clone(), parent: 'Cervical' })

  bones.push({ name: 'Femur_L', pos: hipL.clone(), parent: 'Pelvis' })
  bones.push({ name: 'Tibia_L', pos: kneeL, parent: 'Femur_L' })
  bones.push({ name: 'Foot_L', pos: footL.clone(), parent: 'Tibia_L' })
  bones.push({ name: 'Femur_R', pos: hipR.clone(), parent: 'Pelvis' })
  bones.push({ name: 'Tibia_R', pos: kneeR, parent: 'Femur_R' })
  bones.push({ name: 'Foot_R', pos: footR.clone(), parent: 'Tibia_R' })

  bones.push({ name: 'Humerus_L', pos: shL.clone(), parent: 'Thoracic' })
  bones.push({ name: 'RadiusUlna_L', pos: elbowL, parent: 'Humerus_L' })
  bones.push({ name: 'Hand_L', pos: handL.clone(), parent: 'RadiusUlna_L' })
  bones.push({ name: 'Humerus_R', pos: shR.clone(), parent: 'Thoracic' })
  bones.push({ name: 'RadiusUlna_R', pos: elbowR, parent: 'Humerus_R' })
  bones.push({ name: 'Hand_R', pos: handR.clone(), parent: 'RadiusUlna_R' })

  return { geoms: geoms.filter(Boolean), bones }
}

function buildHorseQuadruped(p, rng) {
  const geoms = []
  /** @type {BoneJoint[]} */
  const bones = []
  const s = p.scale
  const bl = p.bodyLength * s
  const bh = p.bodyHeight * s
  const ll = p.legLength * s
  const nk = p.neckLen * s
  const hs = p.headSize * s
  const tl = p.tailLen * s

  // torso / topline
  const withersY = ll + bh * 1.08
  const croupY = ll + bh * 0.94
  const bodyC = new THREE.Vector3(0, ll + bh * 0.55, -bl * 0.02)
  const bodyW = bl * 0.42
  geoms.push(ellipsoid(bodyC, bodyW * 0.5, bh * 0.6, bl * 0.62))
  geoms.push(ellipsoid(new THREE.Vector3(0, withersY, bl * 0.2), bodyW * 0.33, bh * 0.2, bl * 0.14))
  geoms.push(ellipsoid(new THREE.Vector3(0, croupY, -bl * 0.24), bodyW * 0.48, bh * 0.28, bl * 0.31))
  geoms.push(ellipsoid(new THREE.Vector3(0, bodyC.y - bh * 0.2, bl * 0.02), bodyW * 0.52, bh * 0.28, bl * 0.46))

  // leg anchors
  const shoulderX = bl * 0.155
  const hipX = bl * 0.17
  const frontZ = bl * 0.24
  const hindZ = -bl * 0.24

  const shL = new THREE.Vector3(-shoulderX, withersY - bh * 0.18, frontZ)
  const shR = new THREE.Vector3(shoulderX, withersY - bh * 0.18, frontZ)
  const scapL = shL.clone().add(new THREE.Vector3(0, bh * 0.12, bl * 0.02))
  const scapR = shR.clone().add(new THREE.Vector3(0, bh * 0.12, bl * 0.02))
  const hipL = new THREE.Vector3(-hipX, croupY - bh * 0.16, hindZ)
  const hipR = new THREE.Vector3(hipX, croupY - bh * 0.16, hindZ)

  function frontLegPoints(shoulder, sideSign) {
    const hoof = new THREE.Vector3(
      shoulder.x + sideSign * 0.01 + rng() * 0.015 - 0.0075,
      0,
      shoulder.z + 0.045 + rng() * 0.012 - 0.006,
    )
    const elbow = vecLerp(shoulder, hoof, 0.34)
    const carpus = vecLerp(shoulder, hoof, 0.62)
    const fetlock = vecLerp(shoulder, hoof, 0.9)
    return { shoulder, elbow, carpus, fetlock, hoof }
  }

  function hindLegPoints(hip, sideSign) {
    const hoof = new THREE.Vector3(
      hip.x + sideSign * 0.012 + rng() * 0.015 - 0.0075,
      0,
      hip.z - 0.03 + rng() * 0.012 - 0.006,
    )
    const stifle = vecLerp(hip, hoof, 0.4)
    stifle.z += bl * 0.075
    const hock = vecLerp(hip, hoof, 0.69)
    hock.z += bl * 0.058
    const fetlock = vecLerp(hock, hoof, 0.84)
    return { hip, stifle, hock, fetlock, hoof }
  }

  const fl = frontLegPoints(shL, -1)
  const fr = frontLegPoints(shR, 1)
  const blg = hindLegPoints(hipL, -1)
  const brg = hindLegPoints(hipR, 1)

  const lr = bh * 0.17
  const addFront = (L) => {
    geoms.push(limbCylinder(L.shoulder, L.elbow, lr * 1.06, lr * 0.7))
    geoms.push(limbCylinder(L.elbow, L.carpus, lr * 0.7, lr * 0.45))
    geoms.push(limbCylinder(L.carpus, L.fetlock, lr * 0.42, lr * 0.28))
    geoms.push(limbCylinder(L.fetlock, L.hoof, lr * 0.27, lr * 0.2))
  }
  const addHind = (L) => {
    geoms.push(limbCylinder(L.hip, L.stifle, lr * 1.04, lr * 0.7))
    geoms.push(limbCylinder(L.stifle, L.hock, lr * 0.68, lr * 0.42))
    geoms.push(limbCylinder(L.hock, L.fetlock, lr * 0.42, lr * 0.27))
    geoms.push(limbCylinder(L.fetlock, L.hoof, lr * 0.26, lr * 0.2))
  }
  addFront(fl)
  addFront(fr)
  addHind(blg)
  addHind(brg)
  geoms.push(limbCylinder(scapL, fl.shoulder, lr * 0.92, lr * 0.72))
  geoms.push(limbCylinder(scapR, fr.shoulder, lr * 0.92, lr * 0.72))

  // hoofs
  const hoofH = Math.max(0.014, lr * 0.28)
  const hoofLen = lr * 0.5
  const hoofW = lr * 0.33
  for (const h of [fl.hoof, fr.hoof, blg.hoof, brg.hoof]) {
    const cc = h.clone()
    cc.y = hoofH * 0.5
    geoms.push(box(cc, hoofW, hoofH, hoofLen))
    geoms.push(cone(cc.clone().add(new THREE.Vector3(0, hoofH * 0.12, hoofLen * 0.12)), hoofW * 0.34, hoofLen * 0.4, new THREE.Vector3(0, -0.1, 1)))
  }

  // neck / head
  const neckBase = new THREE.Vector3(0, withersY + bh * 0.04, bl * 0.36)
  const neckMid = neckBase.clone().add(new THREE.Vector3(0, nk * 0.34, nk * 0.45))
  const headBase = neckMid.clone().add(new THREE.Vector3(0, nk * 0.16, nk * 0.46))
  const headC = headBase.clone().add(new THREE.Vector3(0, hs * 0.02, hs * 0.68))
  geoms.push(limbCylinder(neckBase, neckMid, lr * 0.95, lr * 0.62))
  geoms.push(limbCylinder(neckMid, headBase, lr * 0.62, lr * 0.35))
  geoms.push(ellipsoid(headC, hs * 0.4, hs * 0.76, hs * 1.58))
  geoms.push(ellipsoid(headC.clone().add(new THREE.Vector3(0, hs * 0.17, hs * 0.16)), hs * 0.3, hs * 0.24, hs * 0.52))
  const muzzle = headC.clone().add(new THREE.Vector3(0, -hs * 0.1, hs * 0.74))
  geoms.push(cone(muzzle, hs * 0.23, hs * 0.72, new THREE.Vector3(0, -0.06, 1)))
  geoms.push(ellipsoid(headC.clone().add(new THREE.Vector3(0, -hs * 0.22, hs * 0.25)), hs * 0.26, hs * 0.16, hs * 0.44))

  // tail
  const tailStart = new THREE.Vector3(0, croupY + bh * 0.12, -bl * 0.35)
  const tailEnd = tailStart.clone().add(new THREE.Vector3(rng() * 0.08 - 0.04, tl * 0.14, -tl))
  geoms.push(limbCylinder(tailStart, tailEnd, lr * 0.42, lr * 0.2))

  // bones hierarchy
  const pelvisP = new THREE.Vector3(0, croupY - bh * 0.12, hindZ)
  const lumbarP = new THREE.Vector3(0, ll + bh * 0.62, -bl * 0.06)
  const thoracicP = new THREE.Vector3(0, ll + bh * 0.7, bl * 0.1)
  const cervicalP = neckMid.clone().lerp(neckBase, 0.45)

  bones.push({ name: 'Root', pos: new THREE.Vector3(0, 0, 0), parent: null })
  bones.push({ name: 'Pelvis', pos: pelvisP, parent: 'Root' })
  bones.push({ name: 'Lumbar', pos: lumbarP, parent: 'Pelvis' })
  bones.push({ name: 'Thoracic', pos: thoracicP, parent: 'Lumbar' })
  bones.push({ name: 'Cervical', pos: cervicalP, parent: 'Thoracic' })
  bones.push({ name: 'Skull', pos: headC.clone(), parent: 'Cervical' })
  bones.push({ name: 'Forehead', pos: headC.clone().add(new THREE.Vector3(0, hs * 0.16, hs * 0.08)), parent: 'Skull' })
  bones.push({ name: 'Muzzle', pos: muzzle.clone(), parent: 'Skull' })
  bones.push({ name: 'Tail_base', pos: tailStart.clone(), parent: 'Pelvis' })
  bones.push({ name: 'Tail_tip', pos: tailEnd.clone(), parent: 'Tail_base' })

  bones.push({ name: 'Scapula_FL', pos: scapL.clone(), parent: 'Thoracic' })
  bones.push({ name: 'Scapula_FR', pos: scapR.clone(), parent: 'Thoracic' })
  bones.push({ name: 'Humerus_FL', pos: fl.shoulder.clone(), parent: 'Scapula_FL' })
  bones.push({ name: 'RadiusUlna_FL', pos: fl.carpus.clone(), parent: 'Humerus_FL' })
  bones.push({ name: 'Cannon_FL', pos: fl.fetlock.clone(), parent: 'RadiusUlna_FL' })
  bones.push({ name: 'Paw_FL', pos: fl.hoof.clone(), parent: 'Cannon_FL' })

  bones.push({ name: 'Humerus_FR', pos: fr.shoulder.clone(), parent: 'Scapula_FR' })
  bones.push({ name: 'RadiusUlna_FR', pos: fr.carpus.clone(), parent: 'Humerus_FR' })
  bones.push({ name: 'Cannon_FR', pos: fr.fetlock.clone(), parent: 'RadiusUlna_FR' })
  bones.push({ name: 'Paw_FR', pos: fr.hoof.clone(), parent: 'Cannon_FR' })

  bones.push({ name: 'Femur_BL', pos: blg.hip.clone(), parent: 'Pelvis' })
  bones.push({ name: 'Tibia_BL', pos: blg.hock.clone(), parent: 'Femur_BL' })
  bones.push({ name: 'Cannon_BL', pos: blg.fetlock.clone(), parent: 'Tibia_BL' })
  bones.push({ name: 'Paw_BL', pos: blg.hoof.clone(), parent: 'Cannon_BL' })

  bones.push({ name: 'Femur_BR', pos: brg.hip.clone(), parent: 'Pelvis' })
  bones.push({ name: 'Tibia_BR', pos: brg.hock.clone(), parent: 'Femur_BR' })
  bones.push({ name: 'Cannon_BR', pos: brg.fetlock.clone(), parent: 'Tibia_BR' })
  bones.push({ name: 'Paw_BR', pos: brg.hoof.clone(), parent: 'Cannon_BR' })

  return { geoms: geoms.filter(Boolean), bones }
}

/**
 * ZBrush 风格球团起型：根据马骨架关键节点，用重叠球/椭球沿骨段“堆体块”。
 * 目标是先得到接近雕塑 blocking 的体量关系，再走自动蒙皮。
 */
function buildHorseZBrushLike(p, rng) {
  const geoms = []
  /** @type {BoneJoint[]} */
  const bones = []
  const s = p.scale
  const bl = p.bodyLength * s
  const bh = p.bodyHeight * s
  const ll = p.legLength * s
  const nk = p.neckLen * s
  const hs = p.headSize * s
  const tl = p.tailLen * s

  const withersY = ll + bh * 1.08
  const croupY = ll + bh * 0.94
  const bodyC = new THREE.Vector3(0, ll + bh * 0.55, -bl * 0.02)
  const bodyW = bl * 0.42

  const shoulderX = bl * 0.155
  const hipX = bl * 0.17
  const frontZ = bl * 0.24
  const hindZ = -bl * 0.24
  const shL = new THREE.Vector3(-shoulderX, withersY - bh * 0.18, frontZ)
  const shR = new THREE.Vector3(shoulderX, withersY - bh * 0.18, frontZ)
  const scapL = shL.clone().add(new THREE.Vector3(0, bh * 0.12, bl * 0.02))
  const scapR = shR.clone().add(new THREE.Vector3(0, bh * 0.12, bl * 0.02))
  const hipL = new THREE.Vector3(-hipX, croupY - bh * 0.16, hindZ)
  const hipR = new THREE.Vector3(hipX, croupY - bh * 0.16, hindZ)

  function frontLegPoints(shoulder, sideSign) {
    const hoof = new THREE.Vector3(
      shoulder.x + sideSign * 0.01 + rng() * 0.015 - 0.0075,
      0,
      shoulder.z + 0.045 + rng() * 0.012 - 0.006,
    )
    const elbow = vecLerp(shoulder, hoof, 0.34)
    const carpus = vecLerp(shoulder, hoof, 0.62)
    const fetlock = vecLerp(shoulder, hoof, 0.9)
    return { shoulder, elbow, carpus, fetlock, hoof }
  }
  function hindLegPoints(hip, sideSign) {
    const hoof = new THREE.Vector3(
      hip.x + sideSign * 0.012 + rng() * 0.015 - 0.0075,
      0,
      hip.z - 0.03 + rng() * 0.012 - 0.006,
    )
    const stifle = vecLerp(hip, hoof, 0.4)
    stifle.z += bl * 0.075
    const hock = vecLerp(hip, hoof, 0.69)
    hock.z += bl * 0.058
    const fetlock = vecLerp(hock, hoof, 0.84)
    return { hip, stifle, hock, fetlock, hoof }
  }

  const fl = frontLegPoints(shL, -1)
  const fr = frontLegPoints(shR, 1)
  const blg = hindLegPoints(hipL, -1)
  const brg = hindLegPoints(hipR, 1)

  const neckBase = new THREE.Vector3(0, withersY + bh * 0.04, bl * 0.36)
  const neckMid = neckBase.clone().add(new THREE.Vector3(0, nk * 0.34, nk * 0.45))
  const headBase = neckMid.clone().add(new THREE.Vector3(0, nk * 0.16, nk * 0.46))
  const headC = headBase.clone().add(new THREE.Vector3(0, hs * 0.02, hs * 0.68))
  const muzzle = headC.clone().add(new THREE.Vector3(0, -hs * 0.1, hs * 0.74))
  const tailStart = new THREE.Vector3(0, croupY + bh * 0.12, -bl * 0.35)
  const tailEnd = tailStart.clone().add(new THREE.Vector3(rng() * 0.08 - 0.04, tl * 0.14, -tl))

  function blobChainAdaptive(a, b, r0, r1, density = 1) {
    const len = a.distanceTo(b)
    const rAvg = Math.max(1e-4, (r0 + r1) * 0.5)
    // 长段更密，短段更疏；形成类似 dynamesh 球团叠加的连续体
    const steps = Math.max(2, Math.min(16, Math.round((len / (rAvg * 0.62)) * density)))
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const c = vecLerp(a, b, t)
      const rr = (r0 * (1 - t) + r1 * t) * (1 + Math.sin(t * Math.PI) * 0.12)
      geoms.push(sphere(c, rr, 14))
    }
  }

  // torso blobs
  geoms.push(ellipsoid(bodyC, bodyW * 0.5, bh * 0.62, bl * 0.64))
  geoms.push(ellipsoid(new THREE.Vector3(0, withersY, bl * 0.2), bodyW * 0.35, bh * 0.24, bl * 0.18))
  geoms.push(ellipsoid(new THREE.Vector3(0, croupY, -bl * 0.24), bodyW * 0.5, bh * 0.3, bl * 0.33))
  geoms.push(ellipsoid(new THREE.Vector3(0, bodyC.y - bh * 0.22, bl * 0.01), bodyW * 0.56, bh * 0.34, bl * 0.5))

  const lr = bh * 0.17
  blobChainAdaptive(scapL, fl.shoulder, lr * 0.88, lr * 0.72, 0.9)
  blobChainAdaptive(scapR, fr.shoulder, lr * 0.88, lr * 0.72, 0.9)
  for (const L of [fl, fr]) {
    blobChainAdaptive(L.shoulder, L.elbow, lr * 0.96, lr * 0.66, 1.05)
    blobChainAdaptive(L.elbow, L.carpus, lr * 0.64, lr * 0.42, 1.1)
    blobChainAdaptive(L.carpus, L.fetlock, lr * 0.4, lr * 0.26, 1.15)
    blobChainAdaptive(L.fetlock, L.hoof, lr * 0.24, lr * 0.19, 1.05)
  }
  for (const L of [blg, brg]) {
    blobChainAdaptive(L.hip, L.stifle, lr * 0.92, lr * 0.62, 1.05)
    blobChainAdaptive(L.stifle, L.hock, lr * 0.62, lr * 0.4, 1.1)
    blobChainAdaptive(L.hock, L.fetlock, lr * 0.38, lr * 0.24, 1.15)
    blobChainAdaptive(L.fetlock, L.hoof, lr * 0.22, lr * 0.18, 1.05)
  }

  blobChainAdaptive(neckBase, neckMid, lr * 0.92, lr * 0.62, 1.1)
  blobChainAdaptive(neckMid, headBase, lr * 0.62, lr * 0.36, 1.15)
  geoms.push(ellipsoid(headC, hs * 0.42, hs * 0.78, hs * 1.6))
  geoms.push(ellipsoid(headC.clone().add(new THREE.Vector3(0, hs * 0.17, hs * 0.16)), hs * 0.3, hs * 0.24, hs * 0.52))
  geoms.push(cone(muzzle, hs * 0.23, hs * 0.72, new THREE.Vector3(0, -0.06, 1)))
  geoms.push(ellipsoid(headC.clone().add(new THREE.Vector3(0, -hs * 0.22, hs * 0.25)), hs * 0.26, hs * 0.16, hs * 0.44))
  // 头部二次球团细分：眼眶/颧/下颌角
  const eyeLX = -hs * 0.19
  const eyeRX = hs * 0.19
  const eyeY = hs * 0.1
  const eyeZ = hs * 0.35
  geoms.push(sphere(headC.clone().add(new THREE.Vector3(eyeLX, eyeY, eyeZ)), hs * 0.12, 12))
  geoms.push(sphere(headC.clone().add(new THREE.Vector3(eyeRX, eyeY, eyeZ)), hs * 0.12, 12))
  geoms.push(sphere(headC.clone().add(new THREE.Vector3(-hs * 0.24, -hs * 0.08, hs * 0.18)), hs * 0.12, 12))
  geoms.push(sphere(headC.clone().add(new THREE.Vector3(hs * 0.24, -hs * 0.08, hs * 0.18)), hs * 0.12, 12))
  geoms.push(sphere(headC.clone().add(new THREE.Vector3(0, -hs * 0.18, -hs * 0.08)), hs * 0.12, 12))
  blobChainAdaptive(tailStart, tailEnd, lr * 0.4, lr * 0.18, 1.1)

  // bone hierarchy (same as horse dedicated topology)
  const pelvisP = new THREE.Vector3(0, croupY - bh * 0.12, hindZ)
  const lumbarP = new THREE.Vector3(0, ll + bh * 0.62, -bl * 0.06)
  const thoracicP = new THREE.Vector3(0, ll + bh * 0.7, bl * 0.1)
  const cervicalP = neckMid.clone().lerp(neckBase, 0.45)
  bones.push({ name: 'Root', pos: new THREE.Vector3(0, 0, 0), parent: null })
  bones.push({ name: 'Pelvis', pos: pelvisP, parent: 'Root' })
  bones.push({ name: 'Lumbar', pos: lumbarP, parent: 'Pelvis' })
  bones.push({ name: 'Thoracic', pos: thoracicP, parent: 'Lumbar' })
  bones.push({ name: 'Cervical', pos: cervicalP, parent: 'Thoracic' })
  bones.push({ name: 'Skull', pos: headC.clone(), parent: 'Cervical' })
  bones.push({ name: 'Forehead', pos: headC.clone().add(new THREE.Vector3(0, hs * 0.16, hs * 0.08)), parent: 'Skull' })
  bones.push({ name: 'Muzzle', pos: muzzle.clone(), parent: 'Skull' })
  bones.push({ name: 'Tail_base', pos: tailStart.clone(), parent: 'Pelvis' })
  bones.push({ name: 'Tail_tip', pos: tailEnd.clone(), parent: 'Tail_base' })
  bones.push({ name: 'Scapula_FL', pos: scapL.clone(), parent: 'Thoracic' })
  bones.push({ name: 'Scapula_FR', pos: scapR.clone(), parent: 'Thoracic' })
  bones.push({ name: 'Humerus_FL', pos: fl.shoulder.clone(), parent: 'Scapula_FL' })
  bones.push({ name: 'RadiusUlna_FL', pos: fl.carpus.clone(), parent: 'Humerus_FL' })
  bones.push({ name: 'Cannon_FL', pos: fl.fetlock.clone(), parent: 'RadiusUlna_FL' })
  bones.push({ name: 'Paw_FL', pos: fl.hoof.clone(), parent: 'Cannon_FL' })
  bones.push({ name: 'Humerus_FR', pos: fr.shoulder.clone(), parent: 'Scapula_FR' })
  bones.push({ name: 'RadiusUlna_FR', pos: fr.carpus.clone(), parent: 'Humerus_FR' })
  bones.push({ name: 'Cannon_FR', pos: fr.fetlock.clone(), parent: 'RadiusUlna_FR' })
  bones.push({ name: 'Paw_FR', pos: fr.hoof.clone(), parent: 'Cannon_FR' })
  bones.push({ name: 'Femur_BL', pos: blg.hip.clone(), parent: 'Pelvis' })
  bones.push({ name: 'Tibia_BL', pos: blg.hock.clone(), parent: 'Femur_BL' })
  bones.push({ name: 'Cannon_BL', pos: blg.fetlock.clone(), parent: 'Tibia_BL' })
  bones.push({ name: 'Paw_BL', pos: blg.hoof.clone(), parent: 'Cannon_BL' })
  bones.push({ name: 'Femur_BR', pos: brg.hip.clone(), parent: 'Pelvis' })
  bones.push({ name: 'Tibia_BR', pos: brg.hock.clone(), parent: 'Femur_BR' })
  bones.push({ name: 'Cannon_BR', pos: brg.fetlock.clone(), parent: 'Tibia_BR' })
  bones.push({ name: 'Paw_BR', pos: brg.hoof.clone(), parent: 'Cannon_BR' })

  return { geoms: geoms.filter(Boolean), bones }
}

function buildQuadruped(p, rng) {
  if (p.subspecies === 'horse') {
    if (p.horseWorkflow === 'zbrush') return buildHorseZBrushLike(p, rng)
    return buildHorseQuadruped(p, rng)
  }
  const geoms = []
  /** @type {BoneJoint[]} */
  const bones = []
  const isHorse = p.subspecies === 'horse'
  const s = p.scale
  const bl = p.bodyLength * s
  const bh = p.bodyHeight * s
  const ll = p.legLength * s
  const nk = p.neckLen * s
  const hs = p.headSize * s
  const tl = p.tailLen * s

  const bodyC = new THREE.Vector3(0, ll + bh * (isHorse ? 0.58 : 0.5), 0)
  /** 躯干：桶状椭球，Z 头尾向长于 X 肩宽，轮廓接近四足躯干 */
  const bodyW = bl * (isHorse ? 0.44 : 0.52)
  geoms.push(ellipsoid(bodyC, bodyW * 0.5, bh * (isHorse ? 0.6 : 0.51), bl * (isHorse ? 0.56 : 0.48)))
  if (isHorse) {
    // 马：鬐甲（前高）+ 臀峰，形成真实背线
    geoms.push(ellipsoid(new THREE.Vector3(0, bodyC.y + bh * 0.28, bl * 0.2), bodyW * 0.38, bh * 0.23, bl * 0.16))
    geoms.push(ellipsoid(new THREE.Vector3(0, bodyC.y + bh * 0.17, -bl * 0.2), bodyW * 0.46, bh * 0.24, bl * 0.26))
    // Barrel（胸廓/肋筒）下深度
    geoms.push(ellipsoid(new THREE.Vector3(0, bodyC.y - bh * 0.14, bl * 0.03), bodyW * 0.5, bh * 0.24, bl * 0.4))
  }

  const stanceX = Math.min(0.45, Math.max(0.24, Number(p.quadStanceX) || (isHorse ? 0.34 : 0.35)))
  const stanceZ = Math.min(0.34, Math.max(0.12, Number(p.quadStanceZ) || (isHorse ? 0.24 : 0.2)))
  const xo = bl * stanceX
  const zo = bl * stanceZ
  const hips = [
    new THREE.Vector3(-xo, ll, zo),
    new THREE.Vector3(xo, ll, zo),
    new THREE.Vector3(-xo, ll, -zo),
    new THREE.Vector3(xo, ll, -zo),
  ]
  const paws = hips.map((h, i) => {
    const fwd = i < 2 ? 0.05 : -0.03
    const lat = i % 2 === 0 ? -0.01 : 0.01
    return h.clone().add(
      new THREE.Vector3(
        lat + rng() * 0.02 - 0.01,
        -ll * (isHorse ? 1.0 : 0.95),
        fwd + rng() * 0.018 - 0.009,
      ),
    )
  })
  const lr = bh * (isHorse ? 0.18 : 0.22)

  const qDef = Math.min(0.65, Math.max(0.44, Number(p.quadKneeAlongLeg) || 0.52))
  const qF = Number(p.quadKneeAlongLegFront)
  const qH = Number(p.quadKneeAlongLegHind)
  const quadKneeFront = Math.min(0.66, Math.max(0.44, Number.isFinite(qF) ? qF : qDef))
  const quadKneeHind = Math.min(0.7, Math.max(0.44, Number.isFinite(qH) ? qH : qDef))

  /** 上/下肢段：马使用三段（上肢/掌跖骨/蹄前段），其它仍二段。 */
  for (let i = 0; i < 4; i++) {
    const t = i < 2 ? quadKneeFront : quadKneeHind
    const kneePt = vecLerp(hips[i], paws[i], t)
    if (isHorse) {
      const fetlockT = i < 2 ? 0.86 : 0.9
      const fetlock = vecLerp(kneePt, paws[i], fetlockT)
      geoms.push(limbCylinder(hips[i], kneePt, lr * 1.0, lr * 0.64))
      geoms.push(limbCylinder(kneePt, fetlock, lr * 0.62, lr * 0.34))
      geoms.push(limbCylinder(fetlock, paws[i], lr * 0.34, lr * 0.24))
    } else {
      geoms.push(limbCylinder(hips[i], kneePt, lr * 1.14, lr * 0.78))
      geoms.push(limbCylinder(kneePt, paws[i], lr * 0.78, lr * 0.48))
    }
  }

  /** 蹄 / 掌：贴地扁盒，略沿肢方向前伸，避免圆柱悬空像无蹄 */
  const hoofH = Math.max(0.016, lr * (isHorse ? 0.3 : 0.4))
  const hoofLen = lr * (isHorse ? 0.58 : 0.88)
  const hoofW = lr * (isHorse ? 0.4 : 0.62)
  for (let i = 0; i < 4; i++) {
    const legDir = new THREE.Vector3().subVectors(paws[i], hips[i])
    legDir.y = 0
    if (legDir.lengthSq() > 1e-8) legDir.normalize()
    else legDir.set(0, 0, i < 2 ? 1 : -1)
    const cc = paws[i].clone().addScaledVector(legDir, hoofLen * 0.14)
    cc.y = hoofH * 0.5
    geoms.push(box(cc, hoofW, hoofH, hoofLen))
    if (isHorse) {
      geoms.push(
        cone(
          cc.clone().add(new THREE.Vector3(0, hoofH * 0.12, hoofLen * 0.12)),
          hoofW * 0.36,
          hoofLen * 0.42,
          new THREE.Vector3(0, -0.1, 1),
        ),
      )
    }
  }

  const neckFwd = Math.min(0.48, Math.max(0.16, Number(p.quadNeckForward) || (isHorse ? 0.38 : 0.32)))
  const tailZf = Math.min(0.44, Math.max(0.16, Number(p.quadTailZ) || 0.32))
  const neckBase = new THREE.Vector3(0, ll + bh * (isHorse ? 0.82 : 0.65), bl * neckFwd)
  const headC = neckBase.clone().add(new THREE.Vector3(0, nk * (isHorse ? 0.16 : 0.3), nk + hs * (isHorse ? 1.38 : 1)))
  const neckTop = headC.clone().add(new THREE.Vector3(0, -hs * (isHorse ? 0.2 : 0.36), -hs * (isHorse ? 0.02 : 0.2)))
  const neckMid = vecLerp(neckBase, neckTop, isHorse ? 0.6 : 0.52)
  geoms.push(limbCylinder(neckBase, neckMid, lr * (isHorse ? 0.98 : 0.86), lr * (isHorse ? 0.64 : 0.64)))
  geoms.push(limbCylinder(neckMid, neckTop, lr * (isHorse ? 0.64 : 0.64), lr * (isHorse ? 0.36 : 0.46)))
  /** 头：椭球沿头尾向略长，示意颅+吻粗轮廓 */
  geoms.push(ellipsoid(headC, hs * (isHorse ? 0.4 : 0.5), hs * (isHorse ? 0.78 : 0.9), hs * (isHorse ? 1.58 : 1.1)))
  if (isHorse) {
    const muzzle = headC.clone().add(new THREE.Vector3(0, -hs * 0.1, hs * 0.75))
    geoms.push(cone(muzzle, hs * 0.24, hs * 0.7, new THREE.Vector3(0, -0.05, 1)))
  }

  const tailStart = new THREE.Vector3(0, ll + bh * (isHorse ? 0.64 : 0.55), -bl * tailZf)
  const tailEnd = tailStart.clone().add(new THREE.Vector3(rng() * 0.08 - 0.04, tl * 0.15, -tl))
  geoms.push(limbCylinder(tailStart, tailEnd, lr * (isHorse ? 0.46 : 0.55), lr * 0.25))

  /** 水平躯干脊椎动物：骨盆（骶髂/后肢附着）→腰椎→胸椎→颈椎→颅骨；前肢肱骨-桡尺-掌指，后肢股骨-胫骨-跖趾；尾自骨盆向尾端 */
  const pelvisP = new THREE.Vector3(0, ll + bh * 0.22, -zo * 0.9)
  const lumbarP = new THREE.Vector3(0, ll + bh * 0.4, -zo * 0.35)
  const thoracicP = bodyC.clone()
  const legNames = ['FL', 'FR', 'BL', 'BR']

  bones.push({ name: 'Root', pos: new THREE.Vector3(0, 0, 0), parent: null })
  bones.push({ name: 'Pelvis', pos: pelvisP, parent: 'Root' })
  bones.push({ name: 'Lumbar', pos: lumbarP, parent: 'Pelvis' })
  bones.push({ name: 'Thoracic', pos: thoracicP, parent: 'Lumbar' })
  bones.push({ name: 'Cervical', pos: neckMid.clone().lerp(neckBase, 0.45), parent: 'Thoracic' })
  bones.push({ name: 'Skull', pos: headC.clone(), parent: 'Cervical' })
  bones.push({ name: 'Tail_base', pos: tailStart.clone(), parent: 'Pelvis' })
  bones.push({ name: 'Tail_tip', pos: tailEnd.clone(), parent: 'Tail_base' })

  for (let i = 0; i < 4; i++) {
    const t = i < 2 ? quadKneeFront : quadKneeHind
    const mid = vecLerp(hips[i], paws[i], t)
    const id = legNames[i]
    if (i < 2) {
      bones.push({ name: `Humerus_${id}`, pos: hips[i].clone(), parent: 'Thoracic' })
      bones.push({ name: `RadiusUlna_${id}`, pos: mid, parent: `Humerus_${id}` })
      bones.push({ name: `Paw_${id}`, pos: paws[i].clone(), parent: `RadiusUlna_${id}` })
    } else {
      bones.push({ name: `Femur_${id}`, pos: hips[i].clone(), parent: 'Pelvis' })
      bones.push({ name: `Tibia_${id}`, pos: mid, parent: `Femur_${id}` })
      bones.push({ name: `Paw_${id}`, pos: paws[i].clone(), parent: `Tibia_${id}` })
    }
  }

  return { geoms: geoms.filter(Boolean), bones }
}

function buildFish(p, rng) {
  const geoms = []
  /** @type {BoneJoint[]} */
  const bones = []
  const s = p.scale
  const L = p.bodyLen * s
  const H = p.bodyHeight * s
  const ts = p.tailSpread * s
  const fh = p.finHeight * s

  /** 体态：头尾向为 Z（+Z 吻端），左右 X 最窄，背腹 Y 适中——旧版球在 X 拉得最长与尾鳍方向矛盾 */
  const halfLenZ = L * 0.46
  const halfLatX = L * 0.15
  const halfDV_Y = Math.max(H * 0.44, L * 0.09)
  const bodyCenter = new THREE.Vector3(0, H * 0.56, L * 0.05)
  geoms.push(ellipsoid(bodyCenter, halfLatX, halfDV_Y, halfLenZ))

  const tailRoot = new THREE.Vector3(0, H * 0.52, bodyCenter.z - halfLenZ * 0.92)
  const tailTip = tailRoot.clone().add(new THREE.Vector3(0, -ts * 0.15, -ts))
  geoms.push(limbCylinder(tailRoot, tailTip, H * 0.12, 0.02, 6))

  const dorsal = new THREE.Vector3(0, bodyCenter.y + halfDV_Y * 0.82 + fh * 0.45, bodyCenter.z + rng() * 0.04)
  geoms.push(box(dorsal, halfLatX * 0.55, fh, L * 0.14))

  const sideFy = Math.min(H * 0.38, halfDV_Y * 0.9)
  const pecZ = bodyCenter.z + L * 0.06
  geoms.push(
    box(new THREE.Vector3(-halfLatX * 1.35, H * 0.5, pecZ), 0.035, sideFy * 0.28, sideFy * 0.92),
  )
  geoms.push(
    box(new THREE.Vector3(halfLatX * 1.35, H * 0.5, pecZ), 0.035, sideFy * 0.28, sideFy * 0.92),
  )

  bones.push({ name: 'Root', pos: new THREE.Vector3(0, 0, 0), parent: null })
  bones.push({ name: 'Spine', pos: bodyCenter.clone(), parent: 'Root' })
  bones.push({ name: 'Tail_base', pos: tailRoot.clone(), parent: 'Spine' })
  bones.push({ name: 'Tail_tip', pos: tailTip.clone(), parent: 'Tail_base' })
  bones.push({ name: 'Dorsal_fin', pos: dorsal.clone(), parent: 'Spine' })

  return { geoms: geoms.filter(Boolean), bones }
}

function buildInsect(p, rng) {
  const geoms = []
  /** @type {BoneJoint[]} */
  const bones = []
  const s = p.scale
  const n = Math.max(2, Math.min(5, Math.floor(p.segmentCount)))
  const r = p.segmentRadius * s
  const span = p.legSpan * s
  const wspan = p.wingSpan * s

  const centers = []
  let z = 0
  for (let i = 0; i < n; i++) {
    const rr = r * (1 - i * 0.12) * (0.9 + rng() * 0.2)
    const c = new THREE.Vector3(0, r * 1.2, z)
    centers.push({ c: c.clone(), rr })
    geoms.push(sphere(c, rr))
    z -= rr * 1.65
  }

  const thoraxZ = -r * 0.5
  const legPairs = 3
  const legTips = []
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < legPairs; k++) {
      const base = new THREE.Vector3(side * r * 0.9, r * 0.8, thoraxZ - k * r * 0.9)
      const knee = base.clone().add(new THREE.Vector3(side * span * 0.45, -span * 0.35, 0))
      const tip = knee.clone().add(new THREE.Vector3(side * span * 0.35, -span * 0.5, rng() * 0.05))
      geoms.push(limbCylinder(base, knee, r * 0.12, r * 0.08))
      geoms.push(limbCylinder(knee, tip, r * 0.08, r * 0.04))
      legTips.push({ base, knee, tip, side, k })
    }
  }

  const wingY = r * 1.8
  geoms.push(box(new THREE.Vector3(-wspan * 0.35, wingY, thoraxZ), wspan * 0.5, 0.02, r * 0.8))
  geoms.push(box(new THREE.Vector3(wspan * 0.35, wingY, thoraxZ), wspan * 0.5, 0.02, r * 0.8))

  bones.push({ name: 'Root', pos: new THREE.Vector3(0, 0, 0), parent: null })
  let prev = 'Root'
  for (let i = 0; i < centers.length; i++) {
    const name = i === 0 ? 'Thorax' : `Abdomen_${i}`
    bones.push({ name, pos: centers[i].c.clone(), parent: prev })
    prev = name
  }
  const thoraxName = 'Thorax'
  for (let i = 0; i < legTips.length; i++) {
    const { base, knee, tip, side, k } = legTips[i]
    const id = `${side > 0 ? 'R' : 'L'}_${k}`
    bones.push({ name: `Coxa_${id}`, pos: base.clone(), parent: thoraxName })
    bones.push({ name: `Femur_${id}`, pos: knee.clone(), parent: `Coxa_${id}` })
    bones.push({ name: `Tarsus_${id}`, pos: tip.clone(), parent: `Femur_${id}` })
  }
  const wL = new THREE.Vector3(-wspan * 0.35, wingY, thoraxZ)
  const wR = new THREE.Vector3(wspan * 0.35, wingY, thoraxZ)
  bones.push({ name: 'Wing_L', pos: wL, parent: thoraxName })
  bones.push({ name: 'Wing_R', pos: wR, parent: thoraxName })

  return { geoms: geoms.filter(Boolean), bones }
}

function buildBird(p, rng) {
  const geoms = []
  /** @type {BoneJoint[]} */
  const bones = []
  const s = p.scale
  const bs = p.bodySize * s
  const nk = p.neckLen * s
  const hs = p.headSize * s
  const ws = p.wingSpan * s
  const ll = p.legLen * s
  const tl = p.tailLen * s

  const bodyC = new THREE.Vector3(0, ll + bs * 0.8, 0)
  geoms.push(sphere(bodyC, bs))

  const neckB = bodyC.clone().add(new THREE.Vector3(0, bs * 0.5, bs * 0.4))
  const headC = neckB.clone().add(new THREE.Vector3(0, nk * 0.3, nk + hs))
  geoms.push(limbCylinder(neckB, headC.clone().add(new THREE.Vector3(0, 0, -hs * 0.2)), bs * 0.15, bs * 0.1))
  geoms.push(sphere(headC, hs))

  const beakBase = headC.clone().add(new THREE.Vector3(0, -hs * 0.1, hs * 0.85))
  const beakTip = beakBase.clone().add(new THREE.Vector3(0, -hs * 0.15, hs * 0.9))
  geoms.push(
    cone(
      headC.clone().add(new THREE.Vector3(0, -hs * 0.1, hs * 0.85)),
      hs * 0.35,
      hs * 1.1,
      new THREE.Vector3(0, -0.2, 1),
    ),
  )

  const wingY = bodyC.y + bs * 0.15
  const wL = new THREE.Vector3(-ws * 0.35, wingY, 0)
  const wR = new THREE.Vector3(ws * 0.35, wingY, 0)
  geoms.push(box(wL, ws * 0.45, 0.04, bs * 0.9))
  geoms.push(box(wR, ws * 0.45, 0.04, bs * 0.9))

  const hip = new THREE.Vector3(0, ll, bs * 0.15)
  const toeL = new THREE.Vector3(-bs * 0.12, 0, bs * 0.1)
  const toeR = new THREE.Vector3(bs * 0.12, 0, bs * 0.1)
  geoms.push(limbCylinder(hip, toeL, bs * 0.12, bs * 0.06))
  geoms.push(limbCylinder(hip.clone().setX(bs * 0.08), toeR, bs * 0.12, bs * 0.06))

  const tailB = bodyC.clone().add(new THREE.Vector3(0, -bs * 0.1, -bs * 0.7))
  const tailTip = tailB.clone().add(new THREE.Vector3(0, rng() * 0.05, -tl))
  geoms.push(limbCylinder(tailB, tailTip, bs * 0.12, 0.03))

  bones.push({ name: 'Root', pos: new THREE.Vector3(0, 0, 0), parent: null })
  bones.push({ name: 'Body', pos: bodyC.clone(), parent: 'Root' })
  bones.push({ name: 'Neck', pos: neckB.clone(), parent: 'Body' })
  bones.push({ name: 'Head', pos: headC.clone(), parent: 'Neck' })
  bones.push({ name: 'Beak', pos: beakTip.clone(), parent: 'Head' })
  bones.push({ name: 'Wing_L', pos: wL.clone(), parent: 'Body' })
  bones.push({ name: 'Wing_R', pos: wR.clone(), parent: 'Body' })
  bones.push({ name: 'Leg_L', pos: hip.clone().setX(-bs * 0.04), parent: 'Body' })
  bones.push({ name: 'Toe_L', pos: toeL.clone(), parent: 'Leg_L' })
  bones.push({ name: 'Leg_R', pos: hip.clone().setX(bs * 0.08), parent: 'Body' })
  bones.push({ name: 'Toe_R', pos: toeR.clone(), parent: 'Leg_R' })
  bones.push({ name: 'Tail', pos: tailTip.clone(), parent: 'Body' })

  return { geoms: geoms.filter(Boolean), bones }
}

function buildReptile(p, rng) {
  const geoms = []
  /** @type {BoneJoint[]} */
  const bones = []
  const s = p.scale
  const bl = p.bodyLen * s
  const bh = p.bodyH * s
  const ll = p.legLen * s
  const tl = p.tailLen * s
  const nk = p.neckLen * s
  const hl = p.headLen * s

  const segPos = []
  let z = 0
  const segments = 5
  for (let i = 0; i < segments; i++) {
    const t = i / (segments - 1)
    const rr = bh * (0.9 - t * 0.35) * (0.9 + rng() * 0.15)
    const c = new THREE.Vector3(0, ll + rr, z)
    segPos.push(c.clone())
    geoms.push(sphere(c, rr))
    z -= bl * 0.22
  }

  const legX = bh * 0.9
  const zLeg = -bl * 0.15
  const feet = []
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const a = new THREE.Vector3(sx * legX, ll, sz * bh * 0.5)
      const b = a.clone().add(new THREE.Vector3(sx * 0.05, -ll * 0.92, rng() * 0.03))
      geoms.push(limbCylinder(a, b, bh * 0.14, bh * 0.08))
      feet.push({ a, b, sx, sz })
    }
  }

  const headB = new THREE.Vector3(0, ll + bh * 0.5, z + nk * 0.5)
  const headT = headB.clone().add(new THREE.Vector3(0, -bh * 0.1, nk + hl))
  geoms.push(limbCylinder(headB, headT, bh * 0.2, bh * 0.35))
  const snoutTip = headT.clone().add(new THREE.Vector3(0, -bh * 0.05, hl * 0.9))
  geoms.push(cone(headT.clone().add(new THREE.Vector3(0, 0, hl * 0.4)), bh * 0.2, hl * 0.6, new THREE.Vector3(0, -0.1, 1)))

  const tailStart = new THREE.Vector3(0, ll + bh * 0.35, -bl * 0.35)
  const tailTip = tailStart.clone().add(new THREE.Vector3(0, rng() * 0.06, -tl))
  geoms.push(limbCylinder(tailStart, tailTip, bh * 0.18, 0.04))

  bones.push({ name: 'Root', pos: new THREE.Vector3(0, 0, 0), parent: null })
  let prev = 'Root'
  for (let i = 0; i < segPos.length; i++) {
    const name = `Vert_${i}`
    bones.push({ name, pos: segPos[i].clone(), parent: prev })
    prev = name
  }
  const midIdx = Math.max(0, Math.floor((segPos.length - 1) / 2))
  const lastIdx = segPos.length - 1
  const legParent = `Vert_${midIdx}`
  const neckParent = 'Vert_0'
  const tailParent = `Vert_${lastIdx}`
  for (let i = 0; i < feet.length; i++) {
    const { a, b, sx, sz } = feet[i]
    bones.push({ name: `Leg_${sx}_${sz}`, pos: a.clone(), parent: legParent })
    bones.push({ name: `Foot_${sx}_${sz}`, pos: b.clone(), parent: `Leg_${sx}_${sz}` })
  }
  bones.push({ name: 'Neck', pos: headB.clone(), parent: neckParent })
  bones.push({ name: 'Head', pos: headT.clone(), parent: 'Neck' })
  bones.push({ name: 'Snout', pos: snoutTip.clone(), parent: 'Head' })
  bones.push({ name: 'Tail', pos: tailTip.clone(), parent: tailParent })

  return { geoms: geoms.filter(Boolean), bones }
}

function buildAmphibian(p, rng) {
  const geoms = []
  /** @type {BoneJoint[]} */
  const bones = []
  const s = p.scale
  const bw = p.bodyW * s
  const bh = p.bodyH * s
  const ll = p.legLen * s
  const hs = p.headSize * s

  /** Box：Z 为吻–尾向（身体更长），X 为左右（比 Z 窄），符合蛙/蝾螈俯视角比例 */
  const latW = bw * 0.58
  const bodyLenZ = bw * 1.14
  const bodyC = new THREE.Vector3(0, ll + bh * 0.5, 0)
  geoms.push(box(bodyC, latW, bh, bodyLenZ))

  const headC = new THREE.Vector3(0, ll + bh * 0.46, bodyLenZ * 0.38 + hs * 0.62)
  geoms.push(sphere(headC, hs * 1.1))

  const eyeL = headC.clone().add(new THREE.Vector3(-hs * 0.45, hs * 0.25, hs * 0.35))
  const eyeR = headC.clone().add(new THREE.Vector3(hs * 0.45, hs * 0.25, hs * 0.35))
  geoms.push(sphere(eyeL, hs * 0.18))
  geoms.push(sphere(eyeR, hs * 0.18))

  const xo = latW * 0.48
  const zo = bodyLenZ * 0.28
  const bases = [
    new THREE.Vector3(-xo, ll, zo),
    new THREE.Vector3(xo, ll, zo),
    new THREE.Vector3(-xo, ll, -zo),
    new THREE.Vector3(xo, ll, -zo),
  ]
  const tips = bases.map((b) => b.clone().add(new THREE.Vector3(rng() * 0.04, -ll * 0.85, rng() * 0.04)))
  for (let i = 0; i < 4; i++) geoms.push(limbCylinder(bases[i], tips[i], bh * 0.2, bh * 0.12))

  bones.push({ name: 'Root', pos: new THREE.Vector3(0, 0, 0), parent: null })
  bones.push({ name: 'Spine', pos: bodyC.clone(), parent: 'Root' })
  bones.push({ name: 'Head', pos: headC.clone(), parent: 'Spine' })
  bones.push({ name: 'Eye_L', pos: eyeL.clone(), parent: 'Head' })
  bones.push({ name: 'Eye_R', pos: eyeR.clone(), parent: 'Head' })
  const names = ['FL', 'FR', 'BL', 'BR']
  for (let i = 0; i < 4; i++) {
    bones.push({ name: `Hip_${names[i]}`, pos: bases[i].clone(), parent: 'Spine' })
    bones.push({ name: `Foot_${names[i]}`, pos: tips[i].clone(), parent: `Hip_${names[i]}` })
  }

  return { geoms: geoms.filter(Boolean), bones }
}

/**
 * @param {ReturnType<typeof defaultCreatureParams>} params
 */
export function buildCreature(params) {
  const rng = mulberry32(Number(params.seed) || 1)
  const kind = params.kind || 'quadruped'

  let result = { geoms: [], bones: [] }
  switch (kind) {
    case 'biped':
      result = buildBiped(params, rng)
      break
    case 'quadruped':
      result = buildQuadruped(params, rng)
      break
    case 'fish':
      result = buildFish(params, rng)
      break
    case 'insect':
      result = buildInsect(params, rng)
      break
    case 'bird':
      result = buildBird(params, rng)
      break
    case 'reptile':
      result = buildReptile(params, rng)
      break
    case 'amphibian':
      result = buildAmphibian(params, rng)
      break
    default:
      result = buildQuadruped(params, rng)
  }

  const { geoms, bones } = result
  const valid = geoms.filter(Boolean)
  if (!valid.length) {
    const g = new THREE.Group()
    g.name = 'Creature'
    return { group: g, stats: { parts: 0, bones: 0 } }
  }

  const group = new THREE.Group()
  group.name = 'ProceduralCreature'
  const scale = Number(params.scale) || 1
  const jointRadius = Math.max(0.01, 0.022 * scale)
  group.userData.skeletonJointRadius = jointRadius
  const armature = createArmatureFromBones(bones)
  group.add(armature)
  captureBoneRestPose(armature)
  group.updateMatrixWorld(true)

  const orderedBones = collectBonesDepthFirst(armature)
  for (const geo of valid) {
    applySkinToGeometry(geo, orderedBones, armature)
  }

  const merged = mergeGeometries(valid, false)
  for (const g of valid) g.dispose()

  if (!merged) {
    return { group, stats: { parts: valid.length, bones: bones.length } }
  }

  merged.computeVertexNormals()

  const col = new THREE.Color().setHSL(
    (Number(params.hue) % 1 + 1) % 1,
    Math.min(1, Math.max(0, Number(params.saturation) ?? 0.45)),
    Math.min(0.85, Math.max(0.15, Number(params.lightness) ?? 0.48)),
  )

  const mat = new THREE.MeshStandardMaterial({
    color: col,
    roughness: 0.78,
    metalness: 0.06,
    flatShading: false,
  })
  const skinnedMesh = new THREE.SkinnedMesh(merged, mat)
  skinnedMesh.name = 'CreatureBody'
  skinnedMesh.castShadow = true
  skinnedMesh.receiveShadow = true
  skinnedMesh.normalizeSkinWeights = true
  skinnedMesh.bind(new THREE.Skeleton(orderedBones))
  skinnedMesh.visible = params.showCreatureModel !== false
  group.add(skinnedMesh)

  if (bones.length) {
    attachSkeletonVisualization(armature, jointRadius)
    setSkeletonVisualizationVisible(armature, params.showSkeleton !== false)
  }

  /** 世界 y=0 为地平；整体上移使 AABB 底面略高于地面。基准记入 userData，供动画/烘焙叠加 px,py,pz。 */
  const GROUND_PAD = 0.002
  group.updateMatrixWorld(true)
  const bbox = new THREE.Box3().setFromObject(group)
  if (!bbox.isEmpty() && bbox.min.y < GROUND_PAD) {
    group.position.y += GROUND_PAD - bbox.min.y
  }
  group.userData.groundOffsetY = group.position.y

  group.updateMatrixWorld(true)
  attachRagdollShapeExtentsFromSkin(skinnedMesh, orderedBones, armature)
  group.userData.boneWeightStats = computeBoneWeightStats(skinnedMesh, orderedBones)

  return {
    group,
    stats: { parts: valid.length, bones: bones.length },
  }
}
