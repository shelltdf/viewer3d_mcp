/**
 * cannon-es 简式布娃娃：在 **生成角色时** 建立 World、刚体与点约束（物理定义）；
 * 物理解算由视口开关控制：开启时 `world.step` 并 `syncBonesFromPhysics`，关闭时每帧 `syncBodiesFromBones` 跟随程序化骨骼。
 */

import * as THREE from 'three'
import {
  Body,
  Box,
  ConeTwistConstraint,
  ContactMaterial,
  Cylinder,
  HingeConstraint,
  Material,
  Plane,
  Quaternion as CQuaternion,
  Sphere,
  Vec3,
  World,
} from 'cannon-es'
import { collectBonesDepthFirst } from './skinning.js'

const _inv = new THREE.Matrix4()
const _qParent = new THREE.Quaternion()
const _yAxis = new THREE.Vector3()

/**
 * 无 `bone.userData.ragdollHalfExtents` 时的回退：关节球半径基准 × 骨名系数。
 * @param {string} boneName
 * @param {number} baseR
 */
function boneHalfThickness(boneName, baseR) {
  const n = boneName
  let m = 1
  if (/Skull|Head|sphere/i.test(n)) m = 2.5
  if (/Hand|Foot|Paw|Tip|Eye|Beak|Snout/i.test(n)) m = 0.62
  if (/Tail/i.test(n)) m = 0.82
  return Math.max(0.006, baseR * m)
}

/**
 * 父子关节约束：膝/肘用 Hinge，其余用 ConeTwist（都带 pivot）。
 * 仅用 PointToPoint 会过软，容易出现大幅扭转和甩动。
 */
function createJointConstraint(parentBody, childBody, pivotA, pivotB, childBoneName) {
  const n = childBoneName || ''
  if (/Tibia|RadiusUlna/i.test(n)) {
    // 膝/肘：单轴弯曲
    const h = new HingeConstraint(parentBody, childBody, {
      pivotA,
      pivotB,
      axisA: new Vec3(1, 0, 0),
      axisB: new Vec3(1, 0, 0),
      maxForce: 1e10,
      collideConnected: false,
    })
    return h
  }

  // 其余关节：限制摆角与扭转
  let angle = 0.72
  let twist = 0.32
  if (/Skull|Head|Cervical|Neck/i.test(n)) {
    angle = 0.5
    twist = 0.25
  } else if (/Foot|Hand|Paw/i.test(n)) {
    angle = 0.42
    twist = 0.2
  }
  return new ConeTwistConstraint(parentBody, childBody, {
    pivotA,
    pivotB,
    axisA: new Vec3(0, 1, 0),
    axisB: new Vec3(0, 1, 0),
    angle,
    twistAngle: twist,
    maxForce: 1e10,
    collideConnected: false,
  })
}

/**
 * @param {import('three').Scene} scene
 * @param {THREE.Group} creatureRoot `ProceduralCreature`
 */
export function createRagdoll(scene, creatureRoot) {
  creatureRoot.updateMatrixWorld(true)
  const armature = creatureRoot.getObjectByName('Armature')
  if (!armature) return null

  const bones = collectBonesDepthFirst(armature)
  if (bones.length === 0) return null

  const baseR = Number(creatureRoot.userData?.skeletonJointRadius)
  const jointR = Number.isFinite(baseR) && baseR > 0 ? baseR : 0.042

  const world = new World({
    gravity: new Vec3(0, -18, 0),
  })
  world.defaultContactMaterial.friction = 0.92
  world.defaultContactMaterial.restitution = 0.02

  const matGround = new Material('ground')
  const matBody = new Material('rag')
  world.addContactMaterial(new ContactMaterial(matGround, matBody, { friction: 0.95, restitution: 0.05 }))

  const groundBody = new Body({
    mass: 0,
    material: matGround,
  })
  groundBody.collisionFilterGroup = 1
  groundBody.collisionFilterMask = -1
  groundBody.addShape(new Plane())
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0, 'XYZ')
  groundBody.position.set(0, 0, 0)
  world.addBody(groundBody)

  /** @type {Map<THREE.Bone, Body>} */
  const boneToBody = new Map()
  const boneBodyInfo = {}
  const constraints = []
  const p0 = new THREE.Vector3()
  const p1 = new THREE.Vector3()
  const jw = new THREE.Vector3()
  const mid = new THREE.Vector3()
  const dir = new THREE.Vector3()
  const threeQ = new THREE.Quaternion()
  const _cTmp = new Vec3()
  const _cWorld = new Vec3()
  const cylToY = new CQuaternion()
  cylToY.setFromEuler(0, 0, Math.PI / 2, 'XYZ')

  for (const bone of bones) {
    const parent = bone.parent
    let length
    let useStatic = false

    if (!parent?.isBone) {
      p0.set(0, 0, 0).applyMatrix4(armature.matrixWorld)
      bone.getWorldPosition(p1)
      length = Math.max(p0.distanceTo(p1), 0.04)
      useStatic = true
    } else {
      parent.getWorldPosition(p0)
      bone.getWorldPosition(p1)
      length = Math.max(p0.distanceTo(p1), 0.04)
    }

    mid.copy(p0).add(p1).multiplyScalar(0.5)
    dir.subVectors(p1, p0)
    dir.normalize()

    threeQ.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
    const cq = new CQuaternion(threeQ.x, threeQ.y, threeQ.z, threeQ.w)

    const ext = bone.userData.ragdollHalfExtents
    let halfX
    let halfY
    let halfZ
    if (
      ext &&
      ext.x > 0 &&
      ext.y > 0 &&
      ext.z > 0 &&
      Number.isFinite(ext.x) &&
      Number.isFinite(ext.y) &&
      Number.isFinite(ext.z)
    ) {
      halfX = ext.x
      halfY = ext.y
      halfZ = ext.z
    } else {
      const r = boneHalfThickness(bone.name, jointR)
      halfY = length * 0.5
      halfX = r
      halfZ = r
    }
    const rad = Math.max(0.006, Math.min(halfX, halfZ) * 0.93)
    const segHalf = Math.max(0.001, halfY * 0.9 - rad)

    const body = new Body({
      mass: useStatic ? 0 : 0.38,
      material: matBody,
      linearDamping: 0.55,
      angularDamping: 0.65,
      position: new Vec3(mid.x, mid.y, mid.z),
      quaternion: cq,
    })
    body.collisionFilterGroup = 2
    body.collisionFilterMask = 1
    if (segHalf > 0.002) {
      const cyl = new Cylinder(rad, rad, segHalf * 2, 10)
      body.addShape(cyl, new Vec3(0, 0, 0), cylToY)
      body.addShape(new Sphere(rad), new Vec3(0, segHalf, 0))
      body.addShape(new Sphere(rad), new Vec3(0, -segHalf, 0))
    } else {
      body.addShape(new Sphere(Math.max(rad, halfY * 0.9)))
    }
    world.addBody(body)

    bone.userData._ragBody = body
    bone.userData._ragLen = length
    body.pointToLocalFrame(new Vec3(p1.x, p1.y, p1.z), _cTmp)
    bone.userData._ragLocalHead = { x: _cTmp.x, y: _cTmp.y, z: _cTmp.z }
    boneToBody.set(bone, body)
    boneBodyInfo[bone.name] = {
      shape: segHalf > 0.002 ? 'capsule' : 'sphere',
      radius: rad,
      segmentHalf: segHalf,
      halfExtents: { x: halfX, y: halfY, z: halfZ },
      mass: body.mass,
    }

    if (parent?.isBone) {
      bone.getWorldPosition(jw)
      const pivotA = new Vec3()
      const pivotB = new Vec3()
      boneToBody.get(parent).pointToLocalFrame(new Vec3(jw.x, jw.y, jw.z), pivotA)
      body.pointToLocalFrame(new Vec3(jw.x, jw.y, jw.z), pivotB)
      const c = createJointConstraint(boneToBody.get(parent), body, pivotA, pivotB, bone.name)
      constraints.push(c)
      world.addConstraint(c)
    }
  }

  const wireGroup = new THREE.Group()
  wireGroup.name = 'RagdollPhysicsWireframes'
  scene.add(wireGroup)

  const wireEntries = []
  for (const bone of bones) {
    const b = bone.userData._ragBody
    if (!b) continue
    for (let i = 0; i < b.shapes.length; i++) {
      const sh = b.shapes[i]
      let geo = null
      if (sh instanceof Box) {
        const half = sh.halfExtents
        geo = new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2)
      } else if (sh instanceof Sphere) {
        geo = new THREE.SphereGeometry(sh.radius, 10, 8)
      } else if (sh instanceof Cylinder) {
        geo = new THREE.CylinderGeometry(sh.radiusTop, sh.radiusBottom, sh.height, sh.numSegments)
      } else {
        continue
      }
      const edges = new THREE.EdgesGeometry(geo)
      geo.dispose()
      const line = new THREE.LineSegments(
        edges,
        new THREE.LineBasicMaterial({
          color: 0x33ffcc,
          transparent: true,
          opacity: 0.92,
          depthTest: true,
        }),
      )
      line.name = `RagWire_${bone.name}_${i}`
      line.userData.pickInfo = {
        type: 'physics-hitbox',
        boneName: bone.name,
        shape: sh instanceof Sphere ? 'sphere' : sh instanceof Cylinder ? 'cylinder' : 'box',
      }
      const ox = b.shapeOffsets[i]?.x ?? 0
      const oy = b.shapeOffsets[i]?.y ?? 0
      const oz = b.shapeOffsets[i]?.z ?? 0
      line.position.set(ox, oy, oz)
      const oq = b.shapeOrientations[i]
      if (oq) line.quaternion.set(oq.x, oq.y, oq.z, oq.w)
      const g = new THREE.Group()
      g.add(line)
      wireGroup.add(g)
      wireEntries.push({ body: b, group: g })
    }
  }

  function updateWireframes() {
    for (const { body, group } of wireEntries) {
      group.position.set(body.position.x, body.position.y, body.position.z)
      group.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w)
    }
  }

  /** 未步进物理时，用当前骨骼姿态驱动刚体位姿（保持线框与蒙皮一致，切换解算前建议已处于此状态） */
  function syncBodiesFromBones() {
    creatureRoot.updateMatrixWorld(true)
    armature.updateMatrixWorld(true)
    for (const bone of bones) {
      const body = bone.userData._ragBody
      if (!body) continue
      const parent = bone.parent
      let length
      if (!parent?.isBone) {
        p0.set(0, 0, 0).applyMatrix4(armature.matrixWorld)
        bone.getWorldPosition(p1)
        length = Math.max(p0.distanceTo(p1), 0.04)
      } else {
        parent.getWorldPosition(p0)
        bone.getWorldPosition(p1)
        length = Math.max(p0.distanceTo(p1), 0.04)
      }
      bone.userData._ragLen = length
      mid.copy(p0).add(p1).multiplyScalar(0.5)
      dir.subVectors(p1, p0)
      if (dir.lengthSq() < 1e-12) continue
      dir.normalize()
      threeQ.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
      body.position.set(mid.x, mid.y, mid.z)
      body.quaternion.set(threeQ.x, threeQ.y, threeQ.z, threeQ.w)
      body.velocity.set(0, 0, 0)
      body.angularVelocity.set(0, 0, 0)
    }
  }

  const _center = new THREE.Vector3()
  const _jointWorld = new THREE.Vector3()

  function syncBonesFromPhysics() {
    for (const bone of bones) {
      const body = bone.userData._ragBody
      if (!body) continue
      const len = bone.userData._ragLen
      const qw = new THREE.Quaternion(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w)
      const lh = bone.userData._ragLocalHead
      if (lh && Number.isFinite(lh.x) && Number.isFinite(lh.y) && Number.isFinite(lh.z)) {
        _cTmp.set(lh.x, lh.y, lh.z)
        body.pointToWorldFrame(_cTmp, _cWorld)
        _jointWorld.set(_cWorld.x, _cWorld.y, _cWorld.z)
      } else {
        _center.set(body.position.x, body.position.y, body.position.z)
        _yAxis.set(0, 1, 0).applyQuaternion(qw)
        _jointWorld.copy(_center).addScaledVector(_yAxis, len * 0.5)
      }

      const par = bone.parent
      if (!par) continue
      par.updateMatrixWorld(true)
      bone.position.copy(_jointWorld).applyMatrix4(_inv.copy(par.matrixWorld).invert())
      par.getWorldQuaternion(_qParent)
      bone.quaternion.copy(_qParent).invert().multiply(qw)
      if (bone.userData.restScale) bone.scale.copy(bone.userData.restScale)
    }
    armature.updateMatrixWorld(true)
    creatureRoot.updateMatrixWorld(true)
  }

  function step(dt) {
    world.step(1 / 60, dt, 14)
    syncBonesFromPhysics()
    updateWireframes()
  }

  function dispose() {
    for (const c of constraints) world.removeConstraint(c)
    constraints.length = 0
    for (const b of world.bodies.slice()) world.removeBody(b)
    scene.remove(wireGroup)
    wireGroup.traverse((o) => {
      if (o.geometry) o.geometry.dispose()
      if (o.material) o.material.dispose?.()
    })
    for (const bone of bones) {
      delete bone.userData._ragBody
      delete bone.userData._ragLen
      delete bone.userData._ragLocalHead
    }
  }

  updateWireframes()
  return {
    world,
    wireGroup,
    step,
    dispose,
    syncBonesFromPhysics,
    syncBodiesFromBones,
    updateWireframes,
    boneBodyInfo,
  }
}
