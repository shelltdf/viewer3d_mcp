import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const _X = new THREE.Vector3(1, 0, 0)
const _Z = new THREE.Vector3(0, 0, 1)

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

export const defaultPlantParams = () => ({
  seed: 42,
  trunkHeight: 3.2,
  trunkRadiusBottom: 0.18,
  trunkRadiusTop: 0.09,
  trunkSplits: 4,
  maxDepth: 6,
  maxBranches: 3,
  lengthFactor: 0.7,
  radiusTaper: 0.62,
  spreadDeg: 48,
  minBranchLength: 0.1,
  minRadius: 0.006,
  upBias: 0.22,
  firstBranchLength: 1.1,
  leavesPerTip: 3,
  leafSize: 0.38,
  leafSizeJitter: 0.35,
  trunkSegments: 10,
  branchRadialSegments: 7,
})

/**
 * @param {THREE.Vector3} a
 * @param {THREE.Vector3} b
 * @param {number} r0 bottom radius at a
 * @param {number} r1 top radius at b
 */
function cylinderBetween(a, b, r0, r1, radialSegments) {
  const dir = new THREE.Vector3().subVectors(b, a)
  const len = dir.length()
  if (len < 1e-5) return null
  dir.normalize()
  const geom = new THREE.CylinderGeometry(r1, r0, len, radialSegments, 1, false)
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5)
  const m = new THREE.Matrix4().compose(mid, quat, new THREE.Vector3(1, 1, 1))
  geom.applyMatrix4(m)
  return geom
}

/**
 * @param {ReturnType<defaultPlantParams>} params
 * @returns {{ group: THREE.Group, stats: { branchSegments: number, leafInstances: number } }}
 */
export function buildProceduralPlant(params) {
  const rng = mulberry32(Number(params.seed) || 1)
  const spread = (params.spreadDeg * Math.PI) / 180

  /** @type {{ a: THREE.Vector3, b: THREE.Vector3, r0: number, r1: number }[]} */
  const segments = []
  /** @type {{ pos: THREE.Vector3, dir: THREE.Vector3 }[]} */
  const tips = []

  /**
   * @param {THREE.Vector3} start
   * @param {THREE.Vector3} dir
   * @param {number} length
   * @param {number} r0
   * @param {number} depth
   */
  function grow(start, dir, length, r0, depth) {
    const dirN = dir.clone().normalize()
    if (depth <= 0 || length < params.minBranchLength) {
      tips.push({ pos: start.clone(), dir: dirN.clone() })
      return
    }
    const r1 = Math.max(params.minRadius, r0 * params.radiusTaper)
    const end = start.clone().add(dirN.clone().multiplyScalar(length))
    segments.push({ a: start.clone(), b: end.clone(), r0, r1 })

    const roll = rng() * Math.PI * 2
    const childCount = Math.min(
      params.maxBranches,
      1 + Math.floor(rng() * params.maxBranches),
    )

    for (let i = 0; i < childCount; i++) {
      const t = childCount > 1 ? i / (childCount - 1) - 0.5 : 0
      const ax = (rng() - 0.5) * 2 * spread + t * 0.25
      const az = (rng() - 0.5) * 2 * spread
      let nd = dirN.clone()
      nd.applyAxisAngle(_X, ax)
      nd.applyAxisAngle(_Z, az)
      nd.applyAxisAngle(dirN, roll * 0.15)
      nd.y += params.upBias * (0.5 + rng())
      nd.normalize()
      grow(end, nd, length * params.lengthFactor, r1, depth - 1)
    }
  }

  const trunkBottom = new THREE.Vector3(0, 0, 0)
  const trunkTop = new THREE.Vector3(0, params.trunkHeight, 0)
  segments.push({
    a: trunkBottom,
    b: trunkTop,
    r0: params.trunkRadiusBottom,
    r1: params.trunkRadiusTop,
  })

  const trunkDir = new THREE.Vector3(0, 1, 0)
  const splits = Math.max(1, Math.floor(params.trunkSplits))
  for (let i = 0; i < splits; i++) {
    const ang = (i / splits) * Math.PI * 2 + rng() * 0.4
    const outward = new THREE.Vector3(Math.cos(ang), 0.35 + rng() * 0.4, Math.sin(ang)).normalize()
    grow(
      trunkTop.clone(),
      outward,
      params.firstBranchLength * (0.75 + rng() * 0.5),
      params.trunkRadiusTop,
      params.maxDepth,
    )
  }

  const geoms = []
  for (const s of segments) {
    const g = cylinderBetween(
      s.a,
      s.b,
      s.r0,
      s.r1,
      Math.max(5, Math.floor(params.branchRadialSegments)),
    )
    if (g) geoms.push(g)
  }

  const group = new THREE.Group()
  group.name = 'ProceduralPlant'

  if (geoms.length) {
    const merged = mergeGeometries(geoms, false)
    for (const g of geoms) g.dispose()
    const bark = new THREE.MeshStandardMaterial({
      color: 0x7a5844,
      roughness: 0.88,
      metalness: 0.05,
      flatShading: false,
    })
    const wood = new THREE.Mesh(merged, bark)
    wood.name = 'Wood'
    wood.castShadow = true
    wood.receiveShadow = true
    group.add(wood)
  }

  const leavesPerTip = Math.max(0, Math.floor(params.leavesPerTip))
  const leafCount = tips.length * leavesPerTip
  let leafDrawn = 0
  if (leafCount > 0) {
    const baseGeo = new THREE.PlaneGeometry(1, 1)
    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x4a8f5c,
      roughness: 0.55,
      metalness: 0,
      side: THREE.DoubleSide,
      transparent: true,
      alphaTest: 0.35,
    })
    const im = new THREE.InstancedMesh(baseGeo, leafMat, leafCount)
    im.name = 'Leaves'
    im.castShadow = true
    im.receiveShadow = true

    const dummy = new THREE.Object3D()
    const q = new THREE.Quaternion()
    const tipNormal = new THREE.Vector3()
    let idx = 0
    for (const tip of tips) {
      for (let k = 0; k < leavesPerTip; k++) {
        if (idx >= leafCount) break
        const size =
          params.leafSize * (1 - params.leafSizeJitter * 0.5 + rng() * params.leafSizeJitter)
        tipNormal.copy(tip.dir).normalize()
        const angle = rng() * Math.PI * 2
        const tilt = 0.25 + rng() * 0.85
        const bin = new THREE.Vector3(1, 0, 0)
        if (Math.abs(bin.dot(tipNormal)) > 0.9) bin.set(0, 1, 0)
        const tangent = new THREE.Vector3().crossVectors(tipNormal, bin).normalize()
        const bitangent = new THREE.Vector3().crossVectors(tipNormal, tangent).normalize()
        const dir = tangent
          .clone()
          .multiplyScalar(Math.cos(angle))
          .add(bitangent.clone().multiplyScalar(Math.sin(angle)))
        const lean = tipNormal.clone().multiplyScalar(tilt).add(dir.multiplyScalar(1 - tilt)).normalize()
        q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), lean)
        dummy.position.copy(tip.pos).addScaledVector(lean, size * 0.2)
        dummy.quaternion.copy(q)
        dummy.scale.set(size, size * 1.35, 1)
        dummy.updateMatrix()
        im.setMatrixAt(idx, dummy.matrix)
        idx++
        leafDrawn++
      }
    }
    im.instanceMatrix.needsUpdate = true
    im.count = idx
    group.add(im)
  }

  return {
    group,
    stats: {
      branchSegments: segments.length,
      leafInstances: leafDrawn,
    },
  }
}
