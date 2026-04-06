import * as THREE from 'three'

/**
 * 按场景尺度调整 SSAO 采样距离（默认 maxDistance=0.1 对大型号会像「全域遮蔽」→ 画面发黑）。
 * @param {any} ssaoPass
 * @param {import('three').Object3D | null} root
 */
export function applySsaoWorldScale(ssaoPass, root) {
  if (!ssaoPass) return
  if (!root) {
    ssaoPass.minDistance = 0.02
    ssaoPass.maxDistance = 2
    ssaoPass.kernelRadius = 10
    return
  }
  const box = new THREE.Box3().setFromObject(root)
  if (box.isEmpty()) {
    ssaoPass.minDistance = 0.02
    ssaoPass.maxDistance = 2
    return
  }
  const size = box.getSize(new THREE.Vector3())
  const extent = Math.max(size.x, size.y, size.z, 0.35)
  ssaoPass.minDistance = Math.max(extent * 0.0012, 0.002)
  ssaoPass.maxDistance = Math.min(Math.max(extent * 0.1, 0.06), 16)
  ssaoPass.kernelRadius = Math.min(22, Math.max(6, extent * 0.22))
}

/**
 * orbit 等会改 near/far / projection；SSAOPass 构造时写入的矩阵会陈旧，需每帧同步。
 * @param {any} ssaoPass
 * @param {import('three').PerspectiveCamera | null} camera
 */
export function patchSsaoCameraUniforms(ssaoPass, camera) {
  if (!ssaoPass?.ssaoMaterial?.uniforms || !camera) return
  const u = ssaoPass.ssaoMaterial.uniforms
  u.cameraNear.value = camera.near
  u.cameraFar.value = camera.far
  u.cameraProjectionMatrix.value.copy(camera.projectionMatrix)
  u.cameraInverseProjectionMatrix.value.copy(camera.projectionMatrixInverse)
  const d = ssaoPass.depthRenderMaterial?.uniforms
  if (d) {
    d.cameraNear.value = camera.near
    d.cameraFar.value = camera.far
  }
}

const _axisDir = new THREE.Vector3()
const _axisClearSaved = new THREE.Color()

/**
 * 右上角 XYZ→RGB 轴辅助（与 Three AxesHelper 一致：X 红、Y 绿、Z 蓝）。
 */
export function createAxisGizmoContext() {
  const scene = new THREE.Scene()
  const axes = new THREE.AxesHelper(1.35)
  scene.add(axes)
  const cam = new THREE.PerspectiveCamera(50, 1, 0.05, 120)
  return { scene, cam }
}

/**
 * 在主画布上以视口局部区块渲染轴辅助（需在主场景 `render` 或 `composer.render` 之后调用）。
 * @param {import('three').WebGLRenderer} renderer
 * @param {import('three').PerspectiveCamera} mainCamera
 * @param {{ scene: import('three').Scene, cam: import('three').PerspectiveCamera } | null} ctx
 */
export function renderCornerAxisGizmo(renderer, mainCamera, ctx) {
  if (!renderer || !mainCamera || !ctx?.scene || !ctx?.cam) return
  mainCamera.getWorldDirection(_axisDir)
  ctx.cam.position.copy(_axisDir).multiplyScalar(-2.75)
  ctx.cam.quaternion.copy(mainCamera.quaternion)
  ctx.cam.near = Math.max(0.02, mainCamera.near)
  ctx.cam.far = Math.min(mainCamera.far, 250)
  ctx.cam.fov = mainCamera.fov
  ctx.cam.aspect = 1
  ctx.cam.updateProjectionMatrix()

  const canvas = renderer.domElement
  const dpr = renderer.getPixelRatio()
  const fullW = canvas.width
  const fullH = canvas.height
  const size = Math.max(44, Math.round(66 * dpr))
  const pad = Math.round(8 * dpr)
  const x = Math.max(0, fullW - size - pad)
  const y = pad

  const prevAuto = renderer.autoClear
  const prevAlpha = renderer.getClearAlpha()
  renderer.getClearColor(_axisClearSaved)

  renderer.autoClear = true
  renderer.setClearColor(0x1a1d24, 0.9)
  renderer.setScissorTest(true)
  renderer.setViewport(x, y, size, size)
  renderer.setScissor(x, y, size, size)
  renderer.clear()
  renderer.render(ctx.scene, ctx.cam)

  renderer.setScissorTest(false)
  renderer.setViewport(0, 0, fullW, fullH)
  renderer.setScissor(0, 0, fullW, fullH)
  renderer.setClearColor(_axisClearSaved, prevAlpha)
  renderer.autoClear = prevAuto
}
