<script setup>
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js'

const emit = defineEmits(['viewer-error', 'viewer-state'])
const props = defineProps({
  focusMode: {
    type: Boolean,
    default: false,
  },
})

const viewerRootEl = ref(null)
const viewportEl = ref(null)
const outlineItems = ref([])
const selectedUuid = ref('')
const transformTool = ref('move')
const viewLayout = ref('single')
const panelCount = ref(2)
const activeView = ref('persp')
const expandedUuids = ref(new Set())
const selectedInfo = ref(null)
const shadingMode = ref('lit')
const textureEnabled = ref(true)
const materialEnabled = ref(true)
const showGrid = ref(true)
const showGridXZ = ref(true)
const showGridXY = ref(false)
const showGridYZ = ref(false)
const showViewportDebug = ref(false)
const showAxes = ref(true)
const showPivot = ref(false)
const showViewPivot = ref(false)
const pivotSize = ref('md')
const showBones = ref(true)
const boneNodeScale = ref(1)
const boneLineThickness = ref(2)
const showLightObjects = ref(true)
const showCameraObjects = ref(true)
const graphScale = ref(1)
const graphOffsetX = ref(0)
const graphOffsetY = ref(0)
const graphDragging = ref(false)
const dockPinned = ref(true)
const dockCollapsed = ref(false)
const viewerFullscreen = ref(false)
const envSectionOpen = ref(true)
const displaySectionOpen = ref(true)
const cameraSectionOpen = ref(true)
const backgroundColor = ref('#2a2a2a')
const ambientIntensity = ref(1.0)
const keyLightIntensity = ref(1.0)
const fillLightIntensity = ref(1.0)
const selectionOffsetFactor = ref(0.0)
const selectionOffsetUnits = ref(0.0)
const selectionDepthNear = ref(0.0)
const selectionDepthFar = ref(0.9999999)
const selectionWireWidth = ref(1.0)
let graphDragStartX = 0
let graphDragStartY = 0
let graphDragOriginX = 0
let graphDragOriginY = 0

let renderer
let scene
let camera
let cameraFront
let cameraSide
let cameraTop
let controls
let controlsFront
let controlsSide
let controlsTop
let transformControls
let animationId = 0
let mixer
const clock = new THREE.Clock()
const loader = new GLTFLoader()
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('/draco/')
dracoLoader.preload()
loader.setDRACOLoader(dracoLoader)
let currentRoot = null
let ambientLight
let keyLight
let fillLight
let gridXZ
let gridXY
let gridYZ
let sceneObjectHelpers = []
let axesScene
let axesCamera
let axesWidget
let pivotMarker
let pivotAxes
let cameraCenterMarker
let altPressed = false
let altRightDragging = false
let lastRightDragY = 0
let pointerDownX = 0
let pointerDownY = 0
let pointerDownButton = -1
let lastPointerX = 0
let lastPointerY = 0
let selectionBox
let currentTransformMode = 'translate'
let viewportRects = {}
const viewportOverlayRects = ref([])
let lastViewportW = 0
let lastViewportH = 0
let viewportResizeObserver
const orbitAnchor = new THREE.Vector3(0, 0, 0)
const HELPER_COLORS = {
  boneBase: 0xffd24a,
  boneHighlight: 0x4ea3ff,
  lightBase: 0x6b4c2a,
  lightHighlight: 0xffcb7a,
  cameraBase: 0x264f37,
  cameraHighlight: 0x8fe3a8,
}
let cameraTransition = null

function setOrbitAnchor(v) {
  if (!v) return
  orbitAnchor.copy(v)
  if (cameraCenterMarker) cameraCenterMarker.position.copy(orbitAnchor)
}

function applyPivotMarkerAppearance() {
  if (!pivotMarker) return
  const sizeMap = { sm: 0.75, md: 1, lg: 1.35 }
  const scale = sizeMap[pivotSize.value] || 1
  pivotMarker.scale.setScalar(scale)
  pivotMarker.visible = showPivot.value
  if (cameraCenterMarker) cameraCenterMarker.visible = showViewPivot.value
}

function applyGridVisibility() {
  const overall = showGrid.value
  if (gridXZ) gridXZ.visible = overall && showGridXZ.value
  if (gridXY) gridXY.visible = overall && showGridXY.value
  if (gridYZ) gridYZ.visible = overall && showGridYZ.value
}

function setHelperColor(helper, colorHex) {
  if (!helper?.material) return
  const mats = Array.isArray(helper.material) ? helper.material : [helper.material]
  mats.forEach((m) => {
    if (m?.color?.setHex) m.color.setHex(colorHex)
    m.needsUpdate = true
  })
}

function applyHelperSelectionHighlight(selectedObj) {
  const selectedUuid = selectedObj?.uuid || ''
  for (const h of sceneObjectHelpers) {
    const base = h.userData?.__baseColor
    const hi = h.userData?.__highlightColor || base
    const src = h.userData?.__sourceUuid || ''
    const srcBones = h.userData?.__sourceBoneUuids || []
    const selected = !!selectedUuid && (selectedUuid === src || (Array.isArray(srcBones) && srcBones.includes(selectedUuid)))
    if (base !== undefined) setHelperColor(h, selected ? hi : base)
    if (h.material) {
      const mats = Array.isArray(h.material) ? h.material : [h.material]
      mats.forEach((m) => {
        if (h.userData?.__helperType === 'bone' && m?.linewidth !== undefined) {
          m.linewidth = boneLineThickness.value
        }
        m.opacity = selected ? 0.98 : 0.72
        m.transparent = true
        m.needsUpdate = true
      })
    }
  }
}

function applyRenderEnvironmentSettings() {
  if (scene) {
    scene.background = new THREE.Color(backgroundColor.value)
  }
  if (ambientLight) ambientLight.intensity = Number(ambientIntensity.value) || 0
  if (keyLight) keyLight.intensity = Number(keyLightIntensity.value) || 0
  if (fillLight) fillLight.intensity = Number(fillLightIntensity.value) || 0
}

function applySelectionHelperSettings() {
  if (!selectionBox?.userData?.__selectionHelper || !selectionBox.material) return
  const mats = Array.isArray(selectionBox.material) ? selectionBox.material : [selectionBox.material]
  mats.forEach((m) => {
    m.polygonOffset = true
    m.polygonOffsetFactor = selectionOffsetFactor.value
    m.polygonOffsetUnits = selectionOffsetUnits.value
    m.needsUpdate = true
  })
  const inflate = 1 + Math.max(0, selectionWireWidth.value) * 0.001
  selectionBox.scale.set(inflate, inflate, inflate)
}

function fmt(v, digits = 2) {
  return Number.isFinite(v) ? Number(v).toFixed(digits) : '-'
}

function getActiveCameraInfo() {
  const cam = cameraByView(activeView.value)
  const ctl = controlsByView(activeView.value)
  const rect = viewportRects[activeView.value]
  return {
    view: activeView.value.toUpperCase(),
    fov: cam?.fov ?? 0,
    near: cam?.near ?? 0,
    far: cam?.far ?? 0,
    pos: cam?.position ? { x: cam.position.x, y: cam.position.y, z: cam.position.z } : null,
    target: ctl?.target ? { x: ctl.target.x, y: ctl.target.y, z: ctl.target.z } : null,
    viewport: rect ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h } : null,
  }
}

async function toggleSystemFullscreen() {
  try {
    if (!document.fullscreenElement) {
      const target = viewerRootEl.value || viewportEl.value
      if (!target?.requestFullscreen) return
      await target.requestFullscreen()
      viewerFullscreen.value = true
    } else {
      await document.exitFullscreen()
      viewerFullscreen.value = false
    }
  } catch {
    // Browser policy can reject fullscreen; ignore hard failure.
  }
}

function onFullscreenChange() {
  if (!document.fullscreenElement) {
    viewerFullscreen.value = false
  }
}

function emitViewerState() {
  emit('viewer-state', {
    transformTool: transformTool.value,
    viewLayout: viewLayout.value,
    panelCount: panelCount.value,
  })
}

function applyPanelCount(count) {
  const next = Math.max(1, Math.min(4, Number(count) || 2))
  panelCount.value = next
  if (next === 1) setViewLayoutMode('single')
  else if (next === 2) setViewLayoutMode('single')
  else if (next === 3) setViewLayoutMode('single')
  else setViewLayoutMode('quad')
  emitViewerState()
}

function buildViewportRects(w, h) {
  if (viewLayout.value === 'single') {
    const singleId = activeView.value || 'persp'
    return { [singleId]: { x: 0, y: 0, w, h } }
  }
  if (viewLayout.value === 'dual') {
    const hw = Math.floor(w / 2)
    return {
      persp: { x: 0, y: 0, w: hw, h },
      front: { x: hw, y: 0, w: w - hw, h },
    }
  }
  if (viewLayout.value === 'quad') {
    const hw = Math.floor(w / 2)
    const hh = Math.floor(h / 2)
    // Maya-like quad arrangement: Top / Persp / Front / Side
    return {
      top: { x: 0, y: hh, w: hw, h: hh },
      persp: { x: hw, y: hh, w: w - hw, h: hh },
      front: { x: 0, y: 0, w: hw, h: h - hh },
      side: { x: hw, y: 0, w: w - hw, h: h - hh },
    }
  }
  const lw = Math.floor(w * 0.65)
  const rw = w - lw
  const hh = Math.floor(h / 2)
  return {
    persp: { x: 0, y: 0, w: lw, h },
    front: { x: lw, y: hh, w: rw, h: h - hh },
    top: { x: lw, y: 0, w: rw, h: hh },
  }
}

function cameraByView(id) {
  if (id === 'front') return cameraFront
  if (id === 'side') return cameraSide
  if (id === 'top') return cameraTop
  return camera
}

function controlsByView(id) {
  if (id === 'front') return controlsFront
  if (id === 'side') return controlsSide
  if (id === 'top') return controlsTop
  return controls
}

function pointInRect(px, py, r) {
  return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h
}

function clearModel() {
  if (mixer) {
    mixer.stopAllAction()
    mixer = undefined
  }
  if (currentRoot) {
    currentRoot.traverse((obj) => {
      const override = obj.userData?.__overrideMaterial
      if (override?.dispose) override.dispose()
    })
    scene.remove(currentRoot)
    currentRoot.traverse((obj) => {
      if (obj.userData?.__selectionHelper) {
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
          mats.forEach((m) => m.dispose())
        }
        return
      }
      if (obj.geometry) obj.geometry.dispose()
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        mats.forEach((m) => {
          if (m.map) m.map.dispose()
          m.dispose()
        })
      }
    })
    currentRoot = undefined
  }
  if (sceneObjectHelpers.length) {
    for (const h of sceneObjectHelpers) {
      if (h.parent) h.parent.remove(h)
      else scene.remove(h)
      h.geometry?.dispose?.()
      if (Array.isArray(h.material)) {
        h.material.forEach((m) => m?.dispose?.())
      } else {
        h.material?.dispose?.()
      }
    }
    sceneObjectHelpers = []
  }
  outlineItems.value = []
  selectedUuid.value = ''
  if (selectionBox) {
    scene.remove(selectionBox)
    selectionBox.geometry?.dispose?.()
    selectionBox.material?.dispose?.()
    selectionBox = undefined
  }
  selectedInfo.value = null
}

function rebuildSceneObjectHelpers(root) {
  if (!scene || !root) return
  const bs = new THREE.Box3().setFromObject(root).getBoundingSphere(new THREE.Sphere())
  const boneMarkerSize = THREE.MathUtils.clamp(Math.max(bs.radius, 0.1) * 0.012, 0.015, 0.22) * boneNodeScale.value

  for (const h of sceneObjectHelpers) {
    if (h.parent) h.parent.remove(h)
    else scene.remove(h)
    h.geometry?.dispose?.()
    if (Array.isArray(h.material)) h.material.forEach((m) => m?.dispose?.())
    else h.material?.dispose?.()
  }
  sceneObjectHelpers = []

  const skeletonRoots = new Set()
  const allBones = []
  root.traverse((obj) => {
    if (obj.isSkinnedMesh) skeletonRoots.add(obj)
    if (obj.isBone && obj.parent?.isBone === false && obj.parent) skeletonRoots.add(obj.parent)
    if (obj.isBone) allBones.push(obj)
  })
  for (const skinned of skeletonRoots) {
    try {
      const helper = new THREE.SkeletonHelper(skinned)
      helper.material.depthTest = false
      helper.material.transparent = true
      helper.material.opacity = 0.9
      helper.userData.__helperType = 'bone'
      helper.userData.__baseColor = HELPER_COLORS.boneBase
      helper.userData.__highlightColor = HELPER_COLORS.boneHighlight
      helper.visible = showBones.value
      helper.renderOrder = 999
      setHelperColor(helper, HELPER_COLORS.boneBase)
      scene.add(helper)
      sceneObjectHelpers.push(helper)
    } catch {}
  }

  // Fallback/augment: show each bone as a visible handle.
  const boneLinks = []
  for (const bone of allBones) {
    if (bone.parent?.isBone) boneLinks.push({ parent: bone.parent, child: bone })

    // Node marker like Maya joint display.
    // IMPORTANT: keep helpers out of original model hierarchy.
    try {
      const marker = new THREE.Mesh(
        new THREE.OctahedronGeometry(boneMarkerSize, 0),
        new THREE.MeshBasicMaterial({
          color: 0x8ec3ff,
          wireframe: true,
          depthTest: false,
          depthWrite: false,
          transparent: true,
          opacity: 0.98,
        }),
      )
      marker.userData.__helperType = 'bone'
      marker.userData.__sourceUuid = bone.uuid
      marker.userData.__baseColor = HELPER_COLORS.boneBase
      marker.userData.__highlightColor = HELPER_COLORS.boneHighlight
      marker.userData.__boneNodeSource = bone
      marker.visible = showBones.value
      marker.renderOrder = 1001
      marker.material.color.setHex(HELPER_COLORS.boneBase)
      marker.material.opacity = 0.78
      scene.add(marker)
      sceneObjectHelpers.push(marker)
    } catch {}
  }

  // Parent-child relationship lines (Maya-like joint chain display).
  // One line helper per bone -> parent segment, so selection can highlight only current segment.
  for (const link of boneLinks) {
    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    const mat = new THREE.LineBasicMaterial({
      color: HELPER_COLORS.boneBase,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      linewidth: boneLineThickness.value,
    })
    const line = new THREE.LineSegments(geom, mat)
    line.userData.__helperType = 'bone'
    line.userData.__sourceUuid = link.child.uuid
    line.userData.__baseColor = HELPER_COLORS.boneBase
    line.userData.__highlightColor = HELPER_COLORS.boneHighlight
    line.userData.__boneLink = link
    line.visible = showBones.value
    line.renderOrder = 1000
    scene.add(line)
    sceneObjectHelpers.push(line)
  }

  root.traverse((obj) => {
    let helper = null
    if (obj.isDirectionalLight) helper = new THREE.DirectionalLightHelper(obj, 0.35, 0x89b7ff)
    else if (obj.isPointLight) helper = new THREE.PointLightHelper(obj, 0.25, 0xffe08a)
    else if (obj.isSpotLight) helper = new THREE.SpotLightHelper(obj, 0xffd38a)
    else if (obj.isHemisphereLight) helper = new THREE.HemisphereLightHelper(obj, 0.35)
    else if (obj.isCamera) helper = new THREE.CameraHelper(obj)
    if (helper) {
      helper.userData.__helperType = obj.isCamera ? 'camera' : 'light'
      helper.userData.__sourceUuid = obj.uuid
      helper.userData.__baseColor = obj.isCamera ? HELPER_COLORS.cameraBase : HELPER_COLORS.lightBase
      helper.userData.__highlightColor = obj.isCamera ? HELPER_COLORS.cameraHighlight : HELPER_COLORS.lightHighlight
      if (helper.userData.__helperType === 'light') helper.visible = showLightObjects.value
      if (helper.userData.__helperType === 'camera') helper.visible = showCameraObjects.value
      helper.renderOrder = 900
      if (helper.material) {
        if (Array.isArray(helper.material)) {
          helper.material.forEach((m) => {
            m.depthTest = false
            m.transparent = true
          })
        } else {
          helper.material.depthTest = false
          helper.material.transparent = true
        }
      }
      setHelperColor(helper, helper.userData.__baseColor)
      scene.add(helper)
      sceneObjectHelpers.push(helper)
    }
  })
  applyHelperSelectionHighlight(currentRoot?.getObjectByProperty?.('uuid', selectedUuid.value) || null)
}

function applyHelperVisibility() {
  for (const h of sceneObjectHelpers) {
    const t = h.userData?.__helperType
    if (t === 'bone') h.visible = showBones.value
    else if (t === 'light') h.visible = showLightObjects.value
    else if (t === 'camera') h.visible = showCameraObjects.value
  }
}

function updateBoneLinkHelpers() {
  if (!sceneObjectHelpers.length) return
  const p = new THREE.Vector3()
  const c = new THREE.Vector3()
  const q = new THREE.Quaternion()
  for (const h of sceneObjectHelpers) {
    const nodeSource = h.userData?.__boneNodeSource
    if (nodeSource) {
      nodeSource.getWorldPosition(p)
      nodeSource.getWorldQuaternion(q)
      h.position.copy(p)
      h.quaternion.copy(q)
      continue
    }
    const link = h.userData?.__boneLink
    if (!link) continue
    const attr = h.geometry?.getAttribute?.('position')
    if (!attr) continue
    link.parent.getWorldPosition(p)
    link.child.getWorldPosition(c)
    attr.array[0] = p.x
    attr.array[1] = p.y
    attr.array[2] = p.z
    attr.array[3] = c.x
    attr.array[4] = c.y
    attr.array[5] = c.z
    attr.needsUpdate = true
    h.geometry.computeBoundingSphere()
  }
}

function makeOutlineItems(root) {
  const items = []
  const walk = (obj, depth, parentUuid = '') => {
    const label = obj.name ? `${obj.name} (${obj.type})` : obj.type
    items.push({
      uuid: obj.uuid,
      parentUuid,
      depth,
      label,
      hasChildren: !!obj.children?.length,
      visible: obj.visible !== false,
    })
    for (const c of obj.children) {
      if (transformControls && c === transformControls) continue
      if (c.userData?.__selectionHelper) continue
      walk(c, depth + 1, obj.uuid)
    }
  }
  walk(root, 0)
  return items
}

function getGraphNodes() {
  const rowH = 34
  const baseX = 18
  const indentX = 44
  return outlineItems.value.map((item, index) => ({
    uuid: item.uuid,
    label: item.label,
    depth: item.depth,
    x: baseX + item.depth * indentX,
    y: 12 + index * rowH,
    w: 170,
    h: 24,
  }))
}

function getGraphEdges(nodes) {
  const byUuid = new Map(nodes.map((n) => [n.uuid, n]))
  const edges = []
  for (const item of outlineItems.value) {
    if (!item.parentUuid) continue
    const from = byUuid.get(item.parentUuid)
    const to = byUuid.get(item.uuid)
    if (!from || !to) continue
    edges.push({
      id: `${item.parentUuid}-${item.uuid}`,
      x1: from.x + from.w,
      y1: from.y + from.h / 2,
      x2: to.x,
      y2: to.y + to.h / 2,
    })
  }
  return edges
}

function getOverlayRects() {
  if (viewportOverlayRects.value.length) return viewportOverlayRects.value
  const el = viewportEl.value
  if (!el) return []
  return [
    {
      id: activeView.value || 'persp',
      x: 0,
      y: 0,
      w: el.clientWidth || 1,
      h: el.clientHeight || 1,
    },
  ]
}

function onGraphWheel(e) {
  const delta = e.deltaY > 0 ? -0.08 : 0.08
  graphScale.value = THREE.MathUtils.clamp(graphScale.value + delta, 0.45, 2.2)
}

function onGraphPointerDown(e) {
  if (e.button !== 1 && e.button !== 0) return
  if (e.target?.closest?.('.graph-node')) return
  graphDragging.value = true
  graphDragStartX = e.clientX
  graphDragStartY = e.clientY
  graphDragOriginX = graphOffsetX.value
  graphDragOriginY = graphOffsetY.value
}

function onGraphPointerMove(e) {
  if (!graphDragging.value) return
  graphOffsetX.value = graphDragOriginX + (e.clientX - graphDragStartX)
  graphOffsetY.value = graphDragOriginY + (e.clientY - graphDragStartY)
}

function onGraphPointerUp() {
  graphDragging.value = false
}

function isExpanded(uuid) {
  return expandedUuids.value.has(uuid)
}

function toggleExpand(uuid) {
  const next = new Set(expandedUuids.value)
  if (next.has(uuid)) next.delete(uuid)
  else next.add(uuid)
  expandedUuids.value = next
}

function isItemVisible(item) {
  let p = item.parentUuid
  while (p) {
    if (!expandedUuids.value.has(p)) return false
    const parent = outlineItems.value.find((x) => x.uuid === p)
    p = parent?.parentUuid || ''
  }
  return true
}

function updateSelectionBox(obj) {
  if (selectionBox) {
    if (selectionBox.parent) selectionBox.parent.remove(selectionBox)
    if (selectionBox.userData?.__selectionHelper) {
      const mats = selectionBox.material ? (Array.isArray(selectionBox.material) ? selectionBox.material : [selectionBox.material]) : []
      mats.forEach((m) => m?.dispose?.())
    } else {
      scene.remove(selectionBox)
      selectionBox.geometry?.dispose?.()
      selectionBox.material?.dispose?.()
    }
    selectionBox = undefined
  }
  if (!obj || (!obj.isMesh && !obj.isSkinnedMesh)) return
  const wireMat = new THREE.MeshBasicMaterial({
    color: 0x66d4ff,
    wireframe: true,
    depthTest: true,
    depthWrite: false,
    transparent: false,
    opacity: 1,
    side: THREE.FrontSide,
    polygonOffset: true,
    polygonOffsetFactor: selectionOffsetFactor.value,
    polygonOffsetUnits: selectionOffsetUnits.value,
    skinning: !!obj.isSkinnedMesh,
    morphTargets: !!obj.morphTargetInfluences,
    morphNormals: !!obj.morphTargetInfluences,
  })
  let wire
  if (obj.isSkinnedMesh) {
    wire = new THREE.SkinnedMesh(obj.geometry, wireMat)
    wire.bindMode = obj.bindMode
    wire.bindMatrix.copy(obj.bindMatrix)
    wire.bindMatrixInverse.copy(obj.bindMatrixInverse)
    wire.bind(obj.skeleton, obj.bindMatrix)
  } else {
    wire = new THREE.Mesh(obj.geometry, wireMat)
  }
  wire.userData.__selectionHelper = true
  wire.raycast = () => {}
  wire.renderOrder = 1004
  wire.frustumCulled = false
  wire.position.set(0, 0, 0)
  wire.rotation.set(0, 0, 0)
  // Keep selected-wireframe shell slightly inflated to avoid z-fighting.
  wire.scale.set(1.001, 1.001, 1.001)
  wire.onBeforeRender = (rendererCtx) => {
    const gl = rendererCtx.getContext()
    const near = Math.max(0, Math.min(0.9999998, Number(selectionDepthNear.value) || 0))
    const farRaw = Math.max(0.1, Math.min(0.9999999, Number(selectionDepthFar.value) || 0.9999999))
    const far = Math.max(near + 0.0000001, farRaw)
    gl.depthRange(near, far)
  }
  wire.onAfterRender = (rendererCtx) => {
    const gl = rendererCtx.getContext()
    gl.depthRange(0, 1)
  }
  if (obj.morphTargetInfluences && wire.morphTargetInfluences) {
    wire.morphTargetInfluences = obj.morphTargetInfluences
  }
  if (obj.morphTargetDictionary && wire.morphTargetDictionary) {
    wire.morphTargetDictionary = obj.morphTargetDictionary
  }
  obj.add(wire)
  selectionBox = wire
  applySelectionHelperSettings()
}

function isFiniteNumber(v) {
  return Number.isFinite(v)
}

function snapshotTransform(obj) {
  if (!obj) return
  obj.userData.__lastValidTransform = {
    position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
    rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
    scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
  }
}

function restoreLastValidTransform(obj) {
  const t = obj?.userData?.__lastValidTransform
  if (!obj || !t) return false
  obj.position.set(t.position.x, t.position.y, t.position.z)
  obj.rotation.set(t.rotation.x, t.rotation.y, t.rotation.z)
  obj.scale.set(t.scale.x, t.scale.y, t.scale.z)
  obj.updateMatrixWorld(true)
  return true
}

function sanitizeObjectTransform(obj) {
  if (!obj) return
  const valid =
    isFiniteNumber(obj.position.x) &&
    isFiniteNumber(obj.position.y) &&
    isFiniteNumber(obj.position.z) &&
    isFiniteNumber(obj.rotation.x) &&
    isFiniteNumber(obj.rotation.y) &&
    isFiniteNumber(obj.rotation.z) &&
    isFiniteNumber(obj.scale.x) &&
    isFiniteNumber(obj.scale.y) &&
    isFiniteNumber(obj.scale.z)
  if (!valid) {
    const restored = restoreLastValidTransform(obj)
    if (!restored) {
      obj.position.set(0, 0, 0)
      obj.rotation.set(0, 0, 0)
      obj.scale.set(1, 1, 1)
      obj.updateMatrixWorld(true)
    }
    return
  }
  snapshotTransform(obj)
}

function updateSelectedInfo() {
  if (!currentRoot || !selectedUuid.value) {
    selectedInfo.value = null
    return
  }
  const obj = currentRoot.getObjectByProperty('uuid', selectedUuid.value)
  if (!obj) {
    selectedInfo.value = null
    return
  }
  selectedInfo.value = {
    name: obj.name || '(unnamed)',
    type: obj.type,
    uuid: obj.uuid,
    parentName: obj.parent?.name || obj.parent?.type || '-',
    visible: obj.visible !== false,
    position: obj.position ? { x: obj.position.x, y: obj.position.y, z: obj.position.z } : null,
    rotation: obj.rotation
      ? {
          x: THREE.MathUtils.radToDeg(obj.rotation.x),
          y: THREE.MathUtils.radToDeg(obj.rotation.y),
          z: THREE.MathUtils.radToDeg(obj.rotation.z),
        }
      : null,
    scale: obj.scale ? { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z } : null,
  }
}

function selectObject(obj) {
  if (!obj) return
  sanitizeObjectTransform(obj)
  selectedUuid.value = obj.uuid
  updateSelectionBox(obj)
  if (transformControls) transformControls.attach(obj)
  applyHelperSelectionHighlight(obj)
  updateSelectedInfo()
}

function clearSelection() {
  selectedUuid.value = ''
  updateSelectionBox(null)
  transformControls?.detach?.()
  applyHelperSelectionHighlight(null)
  updateSelectedInfo()
}

function selectByUuid(uuid) {
  if (!currentRoot) return
  const obj = currentRoot.getObjectByProperty('uuid', uuid)
  if (obj) selectObject(obj)
}

function toggleNodeVisibility(uuid) {
  if (!currentRoot) return
  const obj = currentRoot.getObjectByProperty('uuid', uuid)
  if (!obj) return
  const nextVisible = !obj.visible
  obj.visible = nextVisible
  // If re-enabling a child while ancestors are hidden, make parent chain visible too.
  if (nextVisible) {
    let p = obj.parent
    while (p && p !== scene) {
      p.visible = true
      p = p.parent
    }
  }
  outlineItems.value = makeOutlineItems(currentRoot)
  updateSelectedInfo()
}

function toggleSelectedVisibility() {
  if (!currentRoot || !selectedUuid.value) return
  const obj = currentRoot.getObjectByProperty('uuid', selectedUuid.value)
  if (!obj) return
  const nextVisible = !obj.visible
  obj.visible = nextVisible
  if (nextVisible) {
    let p = obj.parent
    while (p && p !== scene) {
      p.visible = true
      p = p.parent
    }
  }
  outlineItems.value = makeOutlineItems(currentRoot)
  updateSelectedInfo()
}

function showAllObjects() {
  if (!currentRoot) return
  currentRoot.traverse((obj) => {
    obj.visible = true
  })
  outlineItems.value = makeOutlineItems(currentRoot)
  updateSelectedInfo()
}

function pickFromViewport(clientX, clientY) {
  if (!currentRoot || !renderer) return
  const rect = renderer.domElement.getBoundingClientRect()
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return
  const lx = clientX - rect.left
  const lyFromTop = clientY - rect.top
  const ly = rect.height - lyFromTop // to renderer bottom-left coordinates
  const vp = viewportRects[activeView.value]
  if (!vp) return
  const cam = cameraByView(activeView.value)
  if (!cam) return
  const nx = ((lx - vp.x) / Math.max(vp.w, 1)) * 2 - 1
  const ny = ((ly - vp.y) / Math.max(vp.h, 1)) * 2 - 1
  if (nx < -1 || nx > 1 || ny < -1 || ny > 1) return
  const raycaster = new THREE.Raycaster()
  raycaster.setFromCamera(new THREE.Vector2(nx, ny), cam)
  const hits = raycaster.intersectObject(currentRoot, true)
  const hit = hits.find((h) => h.object && h.object !== transformControls && !h.object.userData?.__selectionHelper)
  if (hit?.object) selectObject(hit.object)
  else clearSelection()
}

function fitCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const center = sphere.center
  const radius = Math.max(sphere.radius, 1e-6)
  setOrbitAnchor(center)
  const dist = radius / Math.sin(((camera.fov / 2) * Math.PI) / 180)
  const offset = dist * 1.35
  const dir = new THREE.Vector3(1.2, 1.0, 1.4).normalize()
  camera.position.copy(orbitAnchor.clone().add(dir.multiplyScalar(offset)))
  camera.near = Math.max(offset / 500, 0.01)
  camera.far = offset * 500
  camera.updateProjectionMatrix()
  controls.target.copy(orbitAnchor)
  camera.lookAt(orbitAnchor)
  cameraFront.position.set(orbitAnchor.x, orbitAnchor.y, orbitAnchor.z + offset)
  controlsFront.target.copy(orbitAnchor)
  cameraFront.lookAt(orbitAnchor)
  cameraSide.position.set(orbitAnchor.x + offset, orbitAnchor.y, orbitAnchor.z)
  controlsSide.target.copy(orbitAnchor)
  cameraSide.lookAt(orbitAnchor)
  cameraTop.position.set(orbitAnchor.x, orbitAnchor.y + offset, orbitAnchor.z)
  controlsTop.target.copy(orbitAnchor)
  cameraTop.lookAt(orbitAnchor)

  // OrbitControls can skip update while disabled; force one sync pass.
  ;[controls, controlsFront, controlsSide, controlsTop].forEach((c) => {
    if (!c) return
    const prev = c.enabled
    c.enabled = true
    c.update()
    c.enabled = prev
  })
}

function getModelBoundingSphere() {
  if (!currentRoot) return null
  const box = new THREE.Box3().setFromObject(currentRoot)
  if (box.isEmpty()) return null
  return box.getBoundingSphere(new THREE.Sphere())
}

function ensureActiveOrbitAnchor() {
  const active = controlsByView(activeView.value)
  const cam = cameraByView(activeView.value)
  const sphere = getModelBoundingSphere()
  if (!active || !cam || !sphere) return
  const center = sphere.center
  const radius = Math.max(sphere.radius, 1e-4)
  const t = active.target
  if (!Number.isFinite(t.x) || !Number.isFinite(t.y) || !Number.isFinite(t.z) || t.distanceTo(center) > radius * 20) {
    setOrbitAnchor(center)
    active.target.copy(orbitAnchor)
  } else {
    setOrbitAnchor(t)
  }
  const dist = cam.position.distanceTo(active.target)
  if (!Number.isFinite(dist) || dist < radius * 0.02) {
    const safeDist = radius * 2.2
    const dir = new THREE.Vector3(1.2, 0.9, 1.3).normalize()
    cam.position.copy(active.target.clone().add(dir.multiplyScalar(safeDist)))
    cam.updateProjectionMatrix()
  }
}

function syncViewAnchors() {
  const active = controlsByView(activeView.value)
  if (active && Number.isFinite(active.target.x) && Number.isFinite(active.target.y) && Number.isFinite(active.target.z)) {
    setOrbitAnchor(active.target)
  }
  const pairs = [
    [camera, controls],
    [cameraFront, controlsFront],
    [cameraSide, controlsSide],
    [cameraTop, controlsTop],
  ]
  for (const [cam, ctl] of pairs) {
    if (!cam || !ctl) continue
    ctl.target.copy(orbitAnchor)
    cam.lookAt(orbitAnchor)
    ctl.update()
  }
}

function resetCamera() {
  if (currentRoot) fitCameraToObject(currentRoot)
}

function resetToDefaultView() {
  cameraTransition = null
  setOrbitAnchor(new THREE.Vector3(0, 0, 0))
  camera.position.set(2, 1.5, 3)
  cameraFront.position.set(0, 0, 6)
  cameraSide.position.set(6, 0, 0)
  cameraTop.position.set(0, 6, 0)
  ;[camera, cameraFront, cameraSide, cameraTop].forEach((cam) => {
    cam.lookAt(orbitAnchor)
    cam.updateProjectionMatrix()
  })
  ;[controls, controlsFront, controlsSide, controlsTop].forEach((ctl) => {
    if (!ctl) return
    ctl.target.copy(orbitAnchor)
    ctl.update()
  })
}

function frameObjectWithCurrentPose(object) {
  const cam = cameraByView(activeView.value)
  const ctl = controlsByView(activeView.value)
  if (!object || !cam || !ctl) return
  const box = new THREE.Box3().setFromObject(object)
  if (box.isEmpty()) return
  const sphere = box.getBoundingSphere(new THREE.Sphere())
  const center = sphere.center
  const radius = Math.max(sphere.radius, 1e-6)

  // Keep current camera attitude (direction/up/quaternion), only translate.
  const viewDir = new THREE.Vector3()
  cam.getWorldDirection(viewDir)
  if (viewDir.lengthSq() < 1e-8) viewDir.set(0, 0, -1)
  viewDir.normalize()

  const fovRad = THREE.MathUtils.degToRad(cam.fov)
  const dist = radius / Math.sin(Math.max(fovRad * 0.5, 1e-3))
  const framedDistance = Math.max(dist * 1.15, 0.05)
  const targetPos = center.clone().addScaledVector(viewDir, -framedDistance)
  startCameraTransition(cam, ctl, targetPos, center, 1000, framedDistance)
}

function startCameraTransition(cam, ctl, toPos, toTarget, durationMs, framedDistance) {
  cameraTransition = {
    cam,
    ctl,
    fromPos: cam.position.clone(),
    fromTarget: ctl.target.clone(),
    toPos: toPos.clone(),
    toTarget: toTarget.clone(),
    startMs: performance.now(),
    durationMs: Math.max(16, durationMs || 1000),
    near: Math.max((framedDistance || cam.position.distanceTo(ctl.target)) / 500, 0.01),
    far: Math.max((framedDistance || cam.position.distanceTo(ctl.target)) * 500, 1),
  }
}

function applyShading() {
  if (!currentRoot) return
  const wireframe = shadingMode.value === 'wireframe'
  currentRoot.traverse((obj) => {
    if (!obj.material) return
    if (!obj.userData.__origMaterial) {
      obj.userData.__origMaterial = obj.material
    }

    if (!materialEnabled.value) {
      if (!obj.userData.__overrideMaterial) {
        obj.userData.__overrideMaterial = new THREE.MeshStandardMaterial({
          color: 0x9a9a9a,
          roughness: 0.9,
          metalness: 0,
        })
      }
      obj.userData.__overrideMaterial.wireframe = wireframe
      obj.userData.__overrideMaterial.needsUpdate = true
      obj.material = obj.userData.__overrideMaterial
      return
    }

    obj.material = obj.userData.__origMaterial
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
    mats.forEach((m) => {
      // Viewer-first behavior: keep meshes visible from all angles.
      m.side = THREE.DoubleSide
      m.wireframe = wireframe
      if (!m.userData.__origMaps) {
        m.userData.__origMaps = {
          map: m.map || null,
          normalMap: m.normalMap || null,
          roughnessMap: m.roughnessMap || null,
          metalnessMap: m.metalnessMap || null,
          emissiveMap: m.emissiveMap || null,
          aoMap: m.aoMap || null,
          alphaMap: m.alphaMap || null,
          bumpMap: m.bumpMap || null,
        }
      }
      if (textureEnabled.value) {
        const o = m.userData.__origMaps
        m.map = o.map
        m.normalMap = o.normalMap
        m.roughnessMap = o.roughnessMap
        m.metalnessMap = o.metalnessMap
        m.emissiveMap = o.emissiveMap
        m.aoMap = o.aoMap
        m.alphaMap = o.alphaMap
        m.bumpMap = o.bumpMap
      } else {
        m.map = null
        m.normalMap = null
        m.roughnessMap = null
        m.metalnessMap = null
        m.emissiveMap = null
        m.aoMap = null
        m.alphaMap = null
        m.bumpMap = null
      }
      m.needsUpdate = true
    })
  })
}

function setViewPreset(kind) {
  const target = orbitAnchor.clone()
  const dist = Math.max(camera.position.distanceTo(target), 2)
  if (kind === 'persp') camera.position.set(target.x + dist * 0.8, target.y + dist * 0.7, target.z + dist * 0.9)
  if (kind === 'front') camera.position.set(target.x, target.y, target.z + dist)
  if (kind === 'side') camera.position.set(target.x + dist, target.y, target.z)
  if (kind === 'top') camera.position.set(target.x, target.y + dist, target.z)
  camera.updateProjectionMatrix()
  controls.update()
}

function setTransformTool(mode) {
  transformTool.value = mode
  if (transformControls) {
    if (mode === 'move') transformControls.setMode('translate')
    if (mode === 'rotate') transformControls.setMode('rotate')
    if (mode === 'scale') transformControls.setMode('scale')
  }
  emitViewerState()
}

function setViewLayoutMode(mode) {
  viewLayout.value = mode
  const validByLayout = {
    single: ['persp', 'front', 'side', 'top'],
    dual: ['persp', 'front'],
    triple: ['persp', 'front', 'top'],
    quad: ['persp', 'front', 'side', 'top'],
  }
  const allowed = validByLayout[mode] || validByLayout.single
  if (!allowed.includes(activeView.value)) {
    activeView.value = 'persp'
  }
  if (altPressed) setMayaNavigationEnabled(true)
  emitViewerState()
}

function setMayaNavigationEnabled(enabled) {
  const active = controlsByView(activeView.value)
  if (!active) return
  ;[controls, controlsFront, controlsSide, controlsTop].forEach((c) => {
    if (c) c.enabled = false
  })
  active.enabled = enabled
  if (enabled) {
    active.mouseButtons.LEFT = THREE.MOUSE.ROTATE
    active.mouseButtons.MIDDLE = THREE.MOUSE.PAN
    // Alt+RMB uses custom dolly logic below, keep OrbitControls from handling RMB.
    active.mouseButtons.RIGHT = THREE.MOUSE.PAN
  }
}

function animate() {
  animationId = requestAnimationFrame(animate)
  onResize()
  const delta = clock.getDelta()
  if (mixer) mixer.update(delta)
  if (cameraTransition) {
    const now = performance.now()
    const tRaw = (now - cameraTransition.startMs) / cameraTransition.durationMs
    const t = THREE.MathUtils.clamp(tRaw, 0, 1)
    const ease = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2
    cameraTransition.cam.position.lerpVectors(cameraTransition.fromPos, cameraTransition.toPos, ease)
    cameraTransition.ctl.target.lerpVectors(cameraTransition.fromTarget, cameraTransition.toTarget, ease)
    cameraTransition.cam.near = cameraTransition.near
    cameraTransition.cam.far = Math.max(cameraTransition.far, cameraTransition.near + 1)
    cameraTransition.cam.updateProjectionMatrix()
    setOrbitAnchor(cameraTransition.ctl.target)
    if (t >= 1) cameraTransition = null
  }
  updateBoneLinkHelpers()
  controls?.update()
  controlsFront?.update()
  controlsSide?.update()
  controlsTop?.update()
  syncViewAnchors()

  const el = viewportEl.value
  const w = el?.clientWidth || 1
  const h = el?.clientHeight || 1

  viewportRects = buildViewportRects(w, h)
  viewportOverlayRects.value = Object.entries(viewportRects).map(([id, r]) => ({ id, ...r }))
  if (transformControls) {
    transformControls.camera = cameraByView(activeView.value) || camera
  }
  renderer.clear(true, true, true)
  renderer.setScissorTest(true)
  if (viewLayout.value === 'single') {
    const [singleId, v] = Object.entries(viewportRects)[0] || ['persp', { x: 0, y: 0, w, h }]
    const singleCam = cameraByView(singleId) || camera
    renderer.setViewport(v.x, v.y, v.w, v.h)
    renderer.setScissor(v.x, v.y, v.w, v.h)
    renderer.render(scene, singleCam)
  } else if (viewLayout.value === 'dual') {
    const vPersp = viewportRects.persp
    const vFront = viewportRects.front
    renderer.setViewport(vPersp.x, vPersp.y, vPersp.w, vPersp.h)
    renderer.setScissor(vPersp.x, vPersp.y, vPersp.w, vPersp.h)
    renderer.render(scene, camera)
    renderer.setViewport(vFront.x, vFront.y, vFront.w, vFront.h)
    renderer.setScissor(vFront.x, vFront.y, vFront.w, vFront.h)
    renderer.render(scene, cameraFront)
  } else if (viewLayout.value === 'quad') {
    const vTop = viewportRects.top
    const vPersp = viewportRects.persp
    const vFront = viewportRects.front
    const vSide = viewportRects.side
    renderer.setViewport(vTop.x, vTop.y, vTop.w, vTop.h)
    renderer.setScissor(vTop.x, vTop.y, vTop.w, vTop.h)
    renderer.render(scene, cameraTop)
    renderer.setViewport(vPersp.x, vPersp.y, vPersp.w, vPersp.h)
    renderer.setScissor(vPersp.x, vPersp.y, vPersp.w, vPersp.h)
    renderer.render(scene, camera)
    renderer.setViewport(vFront.x, vFront.y, vFront.w, vFront.h)
    renderer.setScissor(vFront.x, vFront.y, vFront.w, vFront.h)
    renderer.render(scene, cameraFront)
    renderer.setViewport(vSide.x, vSide.y, vSide.w, vSide.h)
    renderer.setScissor(vSide.x, vSide.y, vSide.w, vSide.h)
    renderer.render(scene, cameraSide)
  } else {
    const vPersp = viewportRects.persp
    const vFront = viewportRects.front
    const vTop = viewportRects.top
    renderer.setViewport(vPersp.x, vPersp.y, vPersp.w, vPersp.h)
    renderer.setScissor(vPersp.x, vPersp.y, vPersp.w, vPersp.h)
    renderer.render(scene, camera)
    renderer.setViewport(vFront.x, vFront.y, vFront.w, vFront.h)
    renderer.setScissor(vFront.x, vFront.y, vFront.w, vFront.h)
    renderer.render(scene, cameraFront)
    renderer.setViewport(vTop.x, vTop.y, vTop.w, vTop.h)
    renderer.setScissor(vTop.x, vTop.y, vTop.w, vTop.h)
    renderer.render(scene, cameraTop)
  }
  renderer.setScissorTest(false)

  // Fixed corner axes widget (Maya-like viewport indicator)
  if (showAxes.value && axesScene && axesCamera && axesWidget) {
    const inset = Math.max(36, Math.round(Math.min(w, h) * 0.07))
    const pad = 4
    const viewDir = camera.position.clone().sub(controls.target)
    if (viewDir.lengthSq() < 1e-8) viewDir.set(1, 1, 1)
    axesCamera.position.copy(viewDir.setLength(2.4))
    axesCamera.lookAt(0, 0, 0)

    renderer.clearDepth()
    renderer.setScissorTest(true)
    renderer.setScissor(pad, pad, inset, inset)
    renderer.setViewport(pad, pad, inset, inset)
    renderer.render(axesScene, axesCamera)
    renderer.setScissorTest(false)
    renderer.setViewport(0, 0, w, h)
  }
}

function onResize() {
  const el = viewportEl.value
  if (!el || !renderer || !camera) return
  const w = el.clientWidth
  const h = el.clientHeight
  if (!w || !h) return
  if (w === lastViewportW && h === lastViewportH) return
  lastViewportW = w
  lastViewportH = h
  camera.aspect = w / Math.max(h, 1)
  camera.updateProjectionMatrix()
  cameraFront.aspect = w / Math.max(h, 1)
  cameraFront.updateProjectionMatrix()
  cameraSide.aspect = w / Math.max(h, 1)
  cameraSide.updateProjectionMatrix()
  cameraTop.aspect = w / Math.max(h, 1)
  cameraTop.updateProjectionMatrix()
  renderer.setSize(w, h, false)
  syncViewAnchors()
}

function attachRendererToViewport() {
  const el = viewportEl.value
  if (!el || !renderer?.domElement) return
  if (!viewportResizeObserver) {
    viewportResizeObserver = new ResizeObserver(() => {
      // Force re-compute after layout changes (panel count / dock / focus mode).
      lastViewportW = 0
      lastViewportH = 0
      onResize()
    })
  }
  viewportResizeObserver.disconnect()
  viewportResizeObserver.observe(el)
  if (renderer.domElement.parentNode !== el) {
    el.appendChild(renderer.domElement)
  }
  lastViewportW = 0
  lastViewportH = 0
  onResize()
}

function init() {
  const el = viewportEl.value
  if (!el) return

  scene = new THREE.Scene()
  // Maya-like neutral dark gray viewport background
  scene.background = new THREE.Color(backgroundColor.value)

  camera = new THREE.PerspectiveCamera(50, 1, 0.01, 5000)
  camera.position.set(2, 1.5, 3)
  cameraFront = new THREE.PerspectiveCamera(45, 1, 0.01, 5000)
  cameraFront.position.set(0, 0, 6)
  cameraFront.lookAt(0, 0, 0)
  cameraSide = new THREE.PerspectiveCamera(45, 1, 0.01, 5000)
  cameraSide.position.set(6, 0, 0)
  cameraSide.lookAt(0, 0, 0)
  cameraTop = new THREE.PerspectiveCamera(45, 1, 0.01, 5000)
  cameraTop.position.set(0, 6, 0)
  cameraTop.lookAt(0, 0, 0)

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.autoClear = false
  el.appendChild(renderer.domElement)

  controls = new OrbitControls(camera, renderer.domElement)
  controlsFront = new OrbitControls(cameraFront, renderer.domElement)
  controlsSide = new OrbitControls(cameraSide, renderer.domElement)
  controlsTop = new OrbitControls(cameraTop, renderer.domElement)
  // Maya interaction is immediate; no inertia/damping.
  ;[controls, controlsFront, controlsSide, controlsTop].forEach((c) => {
    c.enableDamping = false
    c.dampingFactor = 0
    c.enabled = false
  })
  setMayaNavigationEnabled(false)

  transformControls = new TransformControls(camera, renderer.domElement)
  transformControls.setMode('translate')
  transformControls.addEventListener('dragging-changed', (ev) => {
    const active = controlsByView(activeView.value)
    if (active) active.enabled = !ev.value
  })
  transformControls.addEventListener('objectChange', () => {
    if (!currentRoot) return
    outlineItems.value = makeOutlineItems(currentRoot)
    const obj = transformControls.object
    if (obj) {
      sanitizeObjectTransform(obj)
      updateSelectionBox(obj)
    }
    updateSelectedInfo()
  })
  scene.add(transformControls)

  ambientLight = new THREE.AmbientLight(0xffffff, ambientIntensity.value)
  scene.add(ambientLight)
  keyLight = new THREE.DirectionalLight(0xffffff, keyLightIntensity.value)
  keyLight.position.set(4, 10, 6)
  scene.add(keyLight)
  fillLight = new THREE.DirectionalLight(0xb8c6ff, fillLightIntensity.value)
  fillLight.position.set(-6, 2, -4)
  scene.add(fillLight)

  // Three orthogonal grid planes with black center lines (axis=0 lines).
  gridXZ = new THREE.GridHelper(40, 40, 0x101010, 0x3b3b3b)
  gridXZ.position.y = -0.0001
  scene.add(gridXZ)

  gridXY = new THREE.GridHelper(40, 40, 0x101010, 0x3b3b3b)
  gridXY.rotation.x = Math.PI / 2
  gridXY.position.z = -0.0001
  scene.add(gridXY)

  gridYZ = new THREE.GridHelper(40, 40, 0x101010, 0x3b3b3b)
  gridYZ.rotation.z = Math.PI / 2
  gridYZ.position.x = -0.0001
  scene.add(gridYZ)
  applyGridVisibility()

  // World-origin marker: always fixed at (0, 0, 0), independent from orbit anchor.
  pivotMarker = new THREE.Group()
  // Add XYZ axis lines (RGB) with unit length 1 at pivot center.
  pivotAxes = new THREE.AxesHelper(1)
  pivotAxes.setColors(
    new THREE.Color(0xff0000), // X
    new THREE.Color(0x00ff00), // Y
    new THREE.Color(0x0000ff), // Z
  )
  if (Array.isArray(pivotAxes.material)) {
    pivotAxes.material.forEach((m) => {
      m.depthTest = false
      m.transparent = true
      m.opacity = 0.95
    })
  } else {
    pivotAxes.material.depthTest = false
    pivotAxes.material.transparent = true
    pivotAxes.material.opacity = 0.95
  }
  pivotAxes.renderOrder = 1002
  pivotMarker.add(pivotAxes)
  pivotMarker.position.set(0, 0, 0)
  applyPivotMarkerAppearance()
  scene.add(pivotMarker)

  // Camera center marker: always follows current orbit anchor (camera focus point).
  cameraCenterMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.035, 12, 10),
    new THREE.MeshBasicMaterial({
      color: 0x9fd0ff,
      depthTest: true,
      transparent: true,
      opacity: 0.9,
    }),
  )
  cameraCenterMarker.renderOrder = 1003
  cameraCenterMarker.position.copy(orbitAnchor)
  cameraCenterMarker.visible = showViewPivot.value
  scene.add(cameraCenterMarker)
  applyRenderEnvironmentSettings()

  axesScene = new THREE.Scene()
  axesScene.background = null
  axesCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 10)
  axesWidget = new THREE.AxesHelper(0.55)
  axesWidget.setColors(
    new THREE.Color(0xff0000), // X
    new THREE.Color(0x00ff00), // Y
    new THREE.Color(0x0000ff), // Z
  )
  axesScene.add(axesWidget)

  renderer.domElement.addEventListener('contextmenu', (ev) => ev.preventDefault())
  renderer.domElement.addEventListener('pointerdown', onPointerDown)
  renderer.domElement.addEventListener('pointermove', onPointerMove)
  renderer.domElement.addEventListener('pointerup', onPointerUp)
  renderer.domElement.addEventListener('pointerleave', onPointerUp)
  window.addEventListener('blur', onWindowBlur)
  document.addEventListener('fullscreenchange', onFullscreenChange)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  onResize()
  window.addEventListener('resize', onResize)
  animate()
}

function dispose() {
  window.removeEventListener('resize', onResize)
  window.removeEventListener('blur', onWindowBlur)
  document.removeEventListener('fullscreenchange', onFullscreenChange)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
  renderer?.domElement?.removeEventListener('pointerdown', onPointerDown)
  renderer?.domElement?.removeEventListener('pointermove', onPointerMove)
  renderer?.domElement?.removeEventListener('pointerup', onPointerUp)
  renderer?.domElement?.removeEventListener('pointerleave', onPointerUp)
  viewportResizeObserver?.disconnect?.()
  viewportResizeObserver = undefined
  cancelAnimationFrame(animationId)
  clearModel()
  transformControls?.detach?.()
  transformControls?.dispose?.()
  controls?.dispose()
  controlsFront?.dispose()
  controlsSide?.dispose()
  controlsTop?.dispose()
  ;[gridXZ, gridXY, gridYZ].forEach((g) => {
    if (!g) return
    scene?.remove?.(g)
    g.geometry?.dispose?.()
    if (Array.isArray(g.material)) g.material.forEach((m) => m?.dispose?.())
    else g.material?.dispose?.()
  })
  gridXZ = undefined
  gridXY = undefined
  gridYZ = undefined
  ambientLight = undefined
  keyLight = undefined
  fillLight = undefined
  renderer?.dispose()
  if (renderer?.domElement?.parentNode) {
    renderer.domElement.parentNode.removeChild(renderer.domElement)
  }
  if (pivotMarker) {
    scene?.remove?.(pivotMarker)
    pivotMarker.traverse((obj) => {
      obj.geometry?.dispose?.()
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m?.dispose?.())
      else obj.material?.dispose?.()
    })
    pivotMarker = undefined
    pivotAxes = undefined
  }
  if (cameraCenterMarker) {
    scene?.remove?.(cameraCenterMarker)
    cameraCenterMarker.geometry?.dispose?.()
    if (Array.isArray(cameraCenterMarker.material)) cameraCenterMarker.material.forEach((m) => m?.dispose?.())
    else cameraCenterMarker.material?.dispose?.()
    cameraCenterMarker = undefined
  }
}

function onKeyDown(e) {
  if (e.key === 'F10') {
    e.preventDefault()
    toggleSystemFullscreen()
    return
  }
  if (e.key === 'Escape' && viewerFullscreen.value) {
    viewerFullscreen.value = false
    return
  }
  if (e.key === 'f' || e.key === 'F') {
    if (currentRoot) {
      if (selectedUuid.value) {
        const obj = currentRoot.getObjectByProperty('uuid', selectedUuid.value)
        if (obj) {
          frameObjectWithCurrentPose(obj)
          updateSelectionBox(obj)
        } else {
          frameObjectWithCurrentPose(currentRoot)
        }
      } else {
        frameObjectWithCurrentPose(currentRoot)
      }
    } else {
      resetToDefaultView()
    }
  }
  if (e.key === 'w' || e.key === 'W') setTransformTool('move')
  if (e.key === 'e' || e.key === 'E') setTransformTool('rotate')
  if (e.key === 'r' || e.key === 'R') setTransformTool('scale')
  if (e.key !== 'Alt') return
  if (altPressed) return
  altPressed = true
  setMayaNavigationEnabled(true)
}

function onKeyUp(e) {
  if (e.key !== 'Alt') return
  altPressed = false
  altRightDragging = false
  setMayaNavigationEnabled(false)
}

function syncAltStateByEvent(e) {
  const isAlt = !!e?.altKey
  if (isAlt === altPressed) return
  altPressed = isAlt
  if (!isAlt) altRightDragging = false
  setMayaNavigationEnabled(isAlt)
}

function onPointerDown(e) {
  syncAltStateByEvent(e)
  pointerDownX = e.clientX
  pointerDownY = e.clientY
  pointerDownButton = e.button
  lastPointerX = e.clientX
  lastPointerY = e.clientY
  if (renderer) {
    const rect = renderer.domElement.getBoundingClientRect()
    const lx = e.clientX - rect.left
    const ly = rect.height - (e.clientY - rect.top)
    for (const [id, r] of Object.entries(viewportRects)) {
      if (pointInRect(lx, ly, r)) {
        activeView.value = id
        if (altPressed) setMayaNavigationEnabled(true)
        break
      }
    }
  }
  if (altPressed && e.button === 0) {
    ensureActiveOrbitAnchor()
  }
  if (!altPressed || e.button !== 2) return
  altRightDragging = true
  lastRightDragY = e.clientY
}

function onPointerMove(e) {
  syncAltStateByEvent(e)
  lastPointerX = e.clientX
  lastPointerY = e.clientY
  if (!altRightDragging) return
  const dy = e.clientY - lastRightDragY
  lastRightDragY = e.clientY
  const active = controlsByView(activeView.value)
  const cam = cameraByView(activeView.value)
  if (!active || !cam) return

  // Maya-like push/pull: camera moves along view direction, and view pivot
  // also shifts along the same direction (smaller ratio) to keep center evolving.
  const target = active.target.clone()
  const viewDir = target.clone().sub(cam.position)
  const distance = Math.max(viewDir.length(), 0.001)
  viewDir.normalize()
  const move = dy * distance * 0.02
  const pivotMove = move * 0.35
  cam.position.addScaledVector(viewDir, move)
  target.addScaledVector(viewDir, pivotMove)
  setOrbitAnchor(target)
  active.target.copy(orbitAnchor)
  cam.updateProjectionMatrix()
  active.update()
}

function onPointerUp(e) {
  syncAltStateByEvent(e)
  if (!altPressed && pointerDownButton === 0) {
    const moved = Math.hypot(lastPointerX - pointerDownX, lastPointerY - pointerDownY)
    if (moved < 4) pickFromViewport(lastPointerX, lastPointerY)
  }
  altRightDragging = false
  pointerDownButton = -1
}

function onWindowBlur() {
  altPressed = false
  altRightDragging = false
  setMayaNavigationEnabled(false)
}

onMounted(() => {
  init()
  emitViewerState()
})

watch(
  viewportEl,
  async () => {
    await nextTick()
    attachRendererToViewport()
  },
  { flush: 'post' },
)

watch(
  [() => props.focusMode, panelCount, viewLayout, dockPinned, dockCollapsed, viewerFullscreen],
  async () => {
    await nextTick()
    lastViewportW = 0
    lastViewportH = 0
    attachRendererToViewport()
    syncViewAnchors()
  },
  { flush: 'post' },
)

watch([boneNodeScale, boneLineThickness], () => {
  if (!currentRoot) return
  rebuildSceneObjectHelpers(currentRoot)
})

watch([selectionOffsetFactor, selectionOffsetUnits], () => {
  applySelectionHelperSettings()
})

watch([selectionDepthNear, selectionDepthFar], () => {
  applySelectionHelperSettings()
})
watch(selectionWireWidth, () => {
  applySelectionHelperSettings()
})

onBeforeUnmount(() => {
  dispose()
})

function applyGltf(gltf) {
  clearModel()
  currentRoot = gltf.scene
  // Some GLTF assets have unstable/incorrect runtime bounds and can be
  // wrongly frustum-culled when orbiting. Keep model meshes always renderable.
  currentRoot.traverse((obj) => {
    if (obj.isMesh || obj.isSkinnedMesh || obj.isPoints || obj.isLine) {
      obj.frustumCulled = false
    }
    if (obj.position && obj.rotation && obj.scale) {
      snapshotTransform(obj)
    }
  })
  scene.add(currentRoot)
  rebuildSceneObjectHelpers(currentRoot)
  outlineItems.value = makeOutlineItems(currentRoot)
  expandedUuids.value = new Set(outlineItems.value.filter((i) => i.hasChildren).map((i) => i.uuid))
  selectObject(currentRoot)
  updateSelectedInfo()
  applyShading()

  if (gltf.animations?.length) {
    mixer = new THREE.AnimationMixer(currentRoot)
    for (const clip of gltf.animations) {
      mixer.clipAction(clip).play()
    }
  }

  fitCameraToObject(currentRoot)
}

async function loadUrl(url) {
  try {
    const gltf = await loader.loadAsync(url)
    applyGltf(gltf)
  } catch (e) {
    const msg = e?.message || String(e)
    emit('viewer-error', msg)
    throw e
  }
}

async function loadFile(file) {
  const objectUrl = URL.createObjectURL(file)
  try {
    const gltf = await loader.loadAsync(objectUrl)
    applyGltf(gltf)
  } catch (e) {
    const msg = e?.message || String(e)
    emit('viewer-error', msg)
    throw e
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

async function loadFiles(fileList) {
  const files = Array.from(fileList || [])
  if (!files.length) throw new Error('未选择文件')

  // 如果是单个 GLB，沿用单文件逻辑
  if (files.length === 1 && files[0].name.toLowerCase().endsWith('.glb')) {
    await loadFile(files[0])
    return
  }

  const map = new Map()
  for (const f of files) {
    map.set(f.name, URL.createObjectURL(f))
  }

  const gltfFile =
    files.find((f) => f.name.toLowerCase().endsWith('.gltf')) ||
    files.find((f) => f.name.toLowerCase().endsWith('.glb'))
  if (!gltfFile) {
    for (const u of map.values()) URL.revokeObjectURL(u)
    throw new Error('请至少选择一个 .gltf 或 .glb 文件')
  }

  const manager = new THREE.LoadingManager()
  manager.setURLModifier((url) => {
    const normalized = url.replace(/\\/g, '/')
    const noQuery = normalized.split('?')[0].split('#')[0]
    const basename = noQuery.split('/').pop()
    const decodedBase = basename ? decodeURIComponent(basename) : basename
    return (
      map.get(url) ||
      map.get(normalized) ||
      map.get(noQuery) ||
      (basename && map.get(basename)) ||
      (decodedBase && map.get(decodedBase)) ||
      url
    )
  })
  const localLoader = new GLTFLoader(manager)
  localLoader.setDRACOLoader(dracoLoader)

  try {
    const gltf = await localLoader.loadAsync(map.get(gltfFile.name))
    applyGltf(gltf)
  } catch (e) {
    const raw = e?.message || String(e)
    const msg =
      /Failed to load buffer|Failed to load texture|404|Not Found/i.test(raw)
        ? '本地 .gltf 缺少依赖文件。请一次性多选 .gltf + .bin + 贴图文件，或改用单文件 .glb。'
        : raw
    emit('viewer-error', msg)
    throw new Error(msg)
  } finally {
    for (const u of map.values()) URL.revokeObjectURL(u)
  }
}

defineExpose({ loadUrl, loadFile, loadFiles, resetCamera, setTransformTool, setViewLayoutMode, applyPanelCount })
</script>

<template>
  <div ref="viewerRootEl" class="gltf-viewer" :class="{ 'viewer-fullscreen': viewerFullscreen }">
    <aside v-if="!viewerFullscreen && panelCount >= 2 && panelCount < 4" class="outline-panel">
      <div class="outline-menubar">
        <div class="menu-root">
          <button class="menu-item" type="button">View</button>
          <div class="menu-popover">
            <button class="menu-cmd" type="button" @click="expandedUuids = new Set(outlineItems.filter((i) => i.hasChildren).map((i) => i.uuid))">
              Expand All
            </button>
            <button class="menu-cmd" type="button" @click="expandedUuids = new Set()">Collapse All</button>
          </div>
        </div>
        <div class="menu-root">
          <button class="menu-item" type="button">Select</button>
          <div class="menu-popover">
            <button class="menu-cmd" type="button" @click="toggleSelectedVisibility()">Toggle Visibility (H)</button>
            <button class="menu-cmd" type="button" @click="showAllObjects()">Show All Objects</button>
          </div>
        </div>
        <button class="menu-item" type="button">Dock</button>
      </div>
      <div class="outline-title">Outliner</div>
      <ul class="outline-list">
        <li
          v-for="item in outlineItems"
          :key="item.uuid"
          v-show="isItemVisible(item)"
          class="outline-row"
          :class="{ active: item.uuid === selectedUuid }"
          :style="{ paddingLeft: (8 + item.depth * 14) + 'px' }"
          @click="selectByUuid(item.uuid)"
        >
          <span
            class="twisty"
            :class="{ empty: !item.hasChildren }"
            @click.stop="item.hasChildren && toggleExpand(item.uuid)"
          >
            {{ item.hasChildren ? (isExpanded(item.uuid) ? '▾' : '▸') : '·' }}
          </span>
          <button class="eye-btn" @click.stop="toggleNodeVisibility(item.uuid)">
            {{ item.visible ? '👁' : '◌' }}
          </button>
          {{ item.label }}
        </li>
      </ul>
    </aside>

    <div class="viewer-main">
      <div v-if="!viewerFullscreen" class="viewport-menubar" @pointerdown.stop @wheel.stop>
          <div class="menu-root">
            <button class="menu-item" type="button">View</button>
            <div class="menu-popover">
              <button class="menu-cmd" :class="{ checked: activeView === 'persp' }" type="button" @click="setViewPreset('persp')">Perspective</button>
              <button class="menu-cmd" :class="{ checked: activeView === 'front' }" type="button" @click="setViewPreset('front')">Front</button>
              <button class="menu-cmd" :class="{ checked: activeView === 'side' }" type="button" @click="setViewPreset('side')">Side</button>
              <button class="menu-cmd" :class="{ checked: activeView === 'top' }" type="button" @click="setViewPreset('top')">Top</button>
              <div class="menu-sep" />
              <button class="menu-cmd" type="button" @click="resetCamera()">Frame All</button>
              <button class="menu-cmd" :class="{ checked: viewLayout === 'single' }" type="button" @click="setViewLayoutMode('single')">Single View</button>
              <button class="menu-cmd" :class="{ checked: viewLayout === 'dual' }" type="button" @click="setViewLayoutMode('dual')">Two View</button>
              <button class="menu-cmd" :class="{ checked: viewLayout === 'triple' }" type="button" @click="setViewLayoutMode('triple')">Three View</button>
              <button class="menu-cmd" :class="{ checked: viewLayout === 'quad' }" type="button" @click="setViewLayoutMode('quad')">Four View</button>
            </div>
          </div>
          <div class="menu-root">
            <button class="menu-item" type="button">Shading</button>
            <div class="menu-popover">
              <button class="menu-cmd" :class="{ checked: shadingMode === 'lit' }" type="button" @click="shadingMode = 'lit'; applyShading()">Lit</button>
              <button class="menu-cmd" :class="{ checked: shadingMode === 'wireframe' }" type="button" @click="shadingMode = 'wireframe'; applyShading()">Wireframe</button>
              <div class="menu-sep" />
              <button class="menu-cmd" :class="{ checked: textureEnabled }" type="button" @click="textureEnabled = !textureEnabled; applyShading()">
                Texture: {{ textureEnabled ? 'On' : 'Off' }}
              </button>
              <button class="menu-cmd" :class="{ checked: materialEnabled }" type="button" @click="materialEnabled = !materialEnabled; applyShading()">
                Material: {{ materialEnabled ? 'On' : 'Off' }}
              </button>
            </div>
          </div>
          <div class="menu-root">
            <button class="menu-item" type="button">Show</button>
            <div class="menu-popover">
              <button class="menu-cmd" :class="{ checked: showGrid }" type="button" @click="showGrid = !showGrid; applyGridVisibility()">
                Grid: {{ showGrid ? 'On' : 'Off' }}
              </button>
              <button class="menu-cmd" :class="{ checked: showGridXZ }" type="button" @click="showGridXZ = !showGridXZ; applyGridVisibility()">
                Grid Plane XZ (Y=0): {{ showGridXZ ? 'On' : 'Off' }}
              </button>
              <button class="menu-cmd" :class="{ checked: showGridXY }" type="button" @click="showGridXY = !showGridXY; applyGridVisibility()">
                Grid Plane XY (Z=0): {{ showGridXY ? 'On' : 'Off' }}
              </button>
              <button class="menu-cmd" :class="{ checked: showGridYZ }" type="button" @click="showGridYZ = !showGridYZ; applyGridVisibility()">
                Grid Plane YZ (X=0): {{ showGridYZ ? 'On' : 'Off' }}
              </button>
              <button class="menu-cmd" :class="{ checked: showAxes }" type="button" @click="showAxes = !showAxes">Axis: {{ showAxes ? 'On' : 'Off' }}</button>
              <button class="menu-cmd" :class="{ checked: showViewportDebug }" type="button" @click="showViewportDebug = !showViewportDebug">
                Debug Viewport Rect: {{ showViewportDebug ? 'On' : 'Off' }}
              </button>
              <div class="menu-sep" />
              <div class="menu-group-title">Origin</div>
              <button class="menu-cmd" :class="{ checked: showPivot }" type="button" @click="showPivot = !showPivot; applyPivotMarkerAppearance()">
                Origin: {{ showPivot ? 'On' : 'Off' }}
              </button>
              <button class="menu-cmd" :class="{ checked: pivotSize === 'sm' }" type="button" @click="pivotSize = 'sm'; applyPivotMarkerAppearance()">
                Origin Size: Small
              </button>
              <button class="menu-cmd" :class="{ checked: pivotSize === 'md' }" type="button" @click="pivotSize = 'md'; applyPivotMarkerAppearance()">
                Origin Size: Medium
              </button>
              <button class="menu-cmd" :class="{ checked: pivotSize === 'lg' }" type="button" @click="pivotSize = 'lg'; applyPivotMarkerAppearance()">
                Origin Size: Large
              </button>
              <div class="menu-sep" />
              <div class="menu-group-title">View Pivot</div>
              <button class="menu-cmd" :class="{ checked: showViewPivot }" type="button" @click="showViewPivot = !showViewPivot; applyPivotMarkerAppearance()">
                View Pivot: {{ showViewPivot ? 'On' : 'Off' }}
              </button>
              <div class="menu-sep" />
              <button class="menu-cmd" :class="{ checked: showBones }" type="button" @click="showBones = !showBones; applyHelperVisibility()">
                Helpers/Bones: {{ showBones ? 'On' : 'Off' }}
              </button>
              <button class="menu-cmd" :class="{ checked: showLightObjects }" type="button" @click="showLightObjects = !showLightObjects; applyHelperVisibility()">
                Helpers/Lights: {{ showLightObjects ? 'On' : 'Off' }}
              </button>
              <button class="menu-cmd" :class="{ checked: showCameraObjects }" type="button" @click="showCameraObjects = !showCameraObjects; applyHelperVisibility()">
                Helpers/Cameras: {{ showCameraObjects ? 'On' : 'Off' }}
              </button>
            </div>
          </div>
          <div class="menu-root">
            <button class="menu-item" type="button">Select</button>
            <div class="menu-popover">
              <button class="menu-cmd" type="button" @click="toggleSelectedVisibility()">Toggle Visibility (H)</button>
              <button class="menu-cmd" type="button" @click="showAllObjects()">Show All Objects</button>
            </div>
          </div>
          <button class="menu-item" type="button">Renderer</button>
          <button class="menu-item" type="button">Panels</button>
      </div>

      <div v-if="!viewerFullscreen" class="viewport-toolbar" @pointerdown.stop @wheel.stop>
        <button type="button" :class="{ active: transformTool === 'move' }" title="Move (W)" @click="setTransformTool('move')">Move</button>
        <button type="button" :class="{ active: transformTool === 'rotate' }" title="Rotate (E)" @click="setTransformTool('rotate')">Rotate</button>
        <button type="button" :class="{ active: transformTool === 'scale' }" title="Scale (R)" @click="setTransformTool('scale')">Scale</button>
        <div class="toolbar-sep" />
        <button type="button" :class="{ active: viewLayout === 'single' }" @click="setViewLayoutMode('single')">1</button>
        <button type="button" :class="{ active: viewLayout === 'dual' }" @click="setViewLayoutMode('dual')">2</button>
        <button type="button" :class="{ active: viewLayout === 'triple' }" @click="setViewLayoutMode('triple')">3</button>
        <button type="button" :class="{ active: viewLayout === 'quad' }" @click="setViewLayoutMode('quad')">4</button>
        <div class="toolbar-sep" />
        <button type="button" class="active-view-chip">{{ activeView }}</button>
      </div>

      <div v-if="!viewerFullscreen && panelCount === 3" class="viewport-stack">
        <div ref="viewportEl" class="viewport-area">
          <div class="view-overlays">
            <button
              v-for="v in getOverlayRects()"
              :key="v.id"
              class="view-overlay"
              :class="{ active: v.id === activeView, debug: showViewportDebug }"
              :style="{
                left: v.x + 'px',
                bottom: v.y + 'px',
                width: Math.max(v.w, 2) + 'px',
                height: Math.max(v.h, 2) + 'px',
              }"
              @pointerdown.stop="activeView = v.id"
            >
              <span class="view-label">{{ v.id.toUpperCase() }}</span>
              <span v-if="showViewportDebug" class="view-debug-label">
                {{ Math.round(v.x) }},{{ Math.round(v.y) }} · {{ Math.round(v.w) }}x{{ Math.round(v.h) }}
              </span>
            </button>
          </div>
        </div>
        <section class="graph-panel">
          <div class="graph-title">Scene Graph (2D)</div>
          <div
            class="graph-canvas"
            @wheel.prevent="onGraphWheel"
            @pointerdown="onGraphPointerDown"
            @pointermove="onGraphPointerMove"
            @pointerup="onGraphPointerUp"
            @pointercancel="onGraphPointerUp"
            @pointerleave="onGraphPointerUp"
          >
            <div
              class="graph-stage"
              :style="{
                transform: `translate(${graphOffsetX}px, ${graphOffsetY}px) scale(${graphScale})`,
                transformOrigin: '0 0',
              }"
            >
              <svg class="graph-svg" xmlns="http://www.w3.org/2000/svg">
                <line
                  v-for="edge in getGraphEdges(getGraphNodes())"
                  :key="edge.id"
                  class="graph-edge"
                  :x1="edge.x1"
                  :y1="edge.y1"
                  :x2="edge.x2"
                  :y2="edge.y2"
                />
              </svg>
              <button
                v-for="node in getGraphNodes()"
                :key="`graph-${node.uuid}`"
                class="graph-node"
                :class="{ active: node.uuid === selectedUuid }"
                :style="{
                  left: node.x + 'px',
                  top: node.y + 'px',
                  width: node.w + 'px',
                  height: node.h + 'px',
                }"
                @click="selectByUuid(node.uuid)"
              >
                <span class="graph-node-name">{{ node.label }}</span>
              </button>
            </div>
          </div>
        </section>
      </div>
      <div v-else ref="viewportEl" class="viewport-area">
        <div class="view-overlays">
          <button
            v-for="v in getOverlayRects()"
            :key="v.id"
            class="view-overlay"
            :class="{ active: v.id === activeView, debug: showViewportDebug }"
            :style="{
              left: v.x + 'px',
              bottom: v.y + 'px',
              width: Math.max(v.w, 2) + 'px',
              height: Math.max(v.h, 2) + 'px',
            }"
            @pointerdown.stop="activeView = v.id"
          >
            <span class="view-label">{{ v.id.toUpperCase() }}</span>
            <span v-if="showViewportDebug" class="view-debug-label">
              {{ Math.round(v.x) }},{{ Math.round(v.y) }} · {{ Math.round(v.w) }}x{{ Math.round(v.h) }}
            </span>
          </button>
        </div>
      </div>
    </div>
    <aside
      v-show="!props.focusMode && !viewerFullscreen"
      class="right-dock"
      :class="{ pinned: dockPinned, floating: !dockPinned, collapsed: dockCollapsed }"
    >
      <div class="dock-menubar">
        <div v-if="!dockCollapsed" class="menu-root">
          <button class="menu-item" type="button">View</button>
          <div class="menu-popover">
            <button class="menu-cmd" type="button" @click="resetCamera()">Frame Selected / All</button>
          </div>
        </div>
        <button v-if="!dockCollapsed" class="menu-item" type="button">Dock</button>
        <button
          class="menu-item dock-toggle"
          type="button"
          :title="dockCollapsed ? '展开 Dock' : '折叠 Dock'"
          @click="dockCollapsed = !dockCollapsed"
        >
          {{ dockCollapsed ? '⟨' : '⟩' }}
        </button>
        <button
          class="menu-item dock-toggle dock-pin-toggle"
          type="button"
          :title="dockPinned ? '取消固定（浮动）' : '固定到右侧'"
          :class="{ active: dockPinned }"
          @click="dockPinned = !dockPinned"
        >
          <span class="dock-pin-icon" />
        </button>
      </div>
      <div class="dock-title" :title="dockCollapsed ? '点击展开 Attribute Editor' : ''" @click="dockCollapsed && (dockCollapsed = false)">
        Attribute Editor
      </div>
      <div class="dock-body" v-if="!dockCollapsed && selectedInfo">
        <div class="attr-row"><span class="k">Name</span><span class="v">{{ selectedInfo.name }}</span></div>
        <div class="attr-row"><span class="k">Type</span><span class="v">{{ selectedInfo.type }}</span></div>
        <div class="attr-row"><span class="k">Parent</span><span class="v">{{ selectedInfo.parentName }}</span></div>
        <div class="attr-row"><span class="k">Visible</span><span class="v">{{ selectedInfo.visible ? 'true' : 'false' }}</span></div>
        <div class="attr-group">Transform</div>
        <div class="attr-row mono">
          <span class="k">Translate</span>
          <span class="v">
            X {{ selectedInfo.position?.x?.toFixed?.(3) ?? '0.000' }}
            Y {{ selectedInfo.position?.y?.toFixed?.(3) ?? '0.000' }}
            Z {{ selectedInfo.position?.z?.toFixed?.(3) ?? '0.000' }}
          </span>
        </div>
        <div class="attr-row mono">
          <span class="k">Rotate</span>
          <span class="v">
            X {{ selectedInfo.rotation?.x?.toFixed?.(2) ?? '0.00' }}
            Y {{ selectedInfo.rotation?.y?.toFixed?.(2) ?? '0.00' }}
            Z {{ selectedInfo.rotation?.z?.toFixed?.(2) ?? '0.00' }}
          </span>
        </div>
        <div class="attr-row mono">
          <span class="k">Scale</span>
          <span class="v">
            X {{ selectedInfo.scale?.x?.toFixed?.(3) ?? '1.000' }}
            Y {{ selectedInfo.scale?.y?.toFixed?.(3) ?? '1.000' }}
            Z {{ selectedInfo.scale?.z?.toFixed?.(3) ?? '1.000' }}
          </span>
        </div>
        <div class="attr-row uuid"><span class="k">UUID</span><span class="v">{{ selectedInfo.uuid }}</span></div>
      </div>
      <div class="dock-empty" v-else-if="!dockCollapsed">未选中对象</div>
      <div v-if="!dockCollapsed" class="dock-body env-panel">
        <button class="env-section-title" type="button" @click="envSectionOpen = !envSectionOpen">
          <span class="env-chevron">{{ envSectionOpen ? '▾' : '▸' }}</span> Environment
        </button>
        <div v-show="envSectionOpen" class="env-section-body">
          <div class="attr-row">
            <span class="k">Background</span>
            <span class="v"><input v-model="backgroundColor" class="env-color" type="color" @input="applyRenderEnvironmentSettings" /></span>
          </div>
          <div class="attr-row">
            <span class="k">Ambient</span>
            <span class="v"><input v-model.number="ambientIntensity" class="env-range" type="range" min="0" max="3" step="0.01" @input="applyRenderEnvironmentSettings" /> {{ fmt(ambientIntensity) }}</span>
          </div>
          <div class="attr-row">
            <span class="k">Key Light</span>
            <span class="v"><input v-model.number="keyLightIntensity" class="env-range" type="range" min="0" max="3" step="0.01" @input="applyRenderEnvironmentSettings" /> {{ fmt(keyLightIntensity) }}</span>
          </div>
          <div class="attr-row">
            <span class="k">Fill Light</span>
            <span class="v"><input v-model.number="fillLightIntensity" class="env-range" type="range" min="0" max="3" step="0.01" @input="applyRenderEnvironmentSettings" /> {{ fmt(fillLightIntensity) }}</span>
          </div>
        </div>

        <button class="env-section-title" type="button" @click="displaySectionOpen = !displaySectionOpen">
          <span class="env-chevron">{{ displaySectionOpen ? '▾' : '▸' }}</span> Display
        </button>
        <div v-show="displaySectionOpen" class="env-section-body">
          <label class="env-check"><input v-model="showGrid" type="checkbox" @change="applyGridVisibility" /> Grid Master</label>
          <label class="env-check"><input v-model="showGridXZ" type="checkbox" @change="applyGridVisibility" /> Grid XZ</label>
          <label class="env-check"><input v-model="showGridXY" type="checkbox" @change="applyGridVisibility" /> Grid XY</label>
          <label class="env-check"><input v-model="showGridYZ" type="checkbox" @change="applyGridVisibility" /> Grid YZ</label>
          <label class="env-check"><input v-model="showAxes" type="checkbox" /> View Axis</label>
          <label class="env-check"><input v-model="showPivot" type="checkbox" @change="applyPivotMarkerAppearance" /> Origin</label>
          <label class="env-check"><input v-model="showViewPivot" type="checkbox" @change="applyPivotMarkerAppearance" /> View Pivot</label>
          <label class="env-check"><input v-model="showBones" type="checkbox" @change="applyHelperVisibility" /> Bone Helpers</label>
          <div class="attr-row">
            <span class="k">Bone Size</span>
            <span class="v"><input v-model.number="boneNodeScale" class="env-range" type="range" min="0.4" max="2.5" step="0.05" /> {{ fmt(boneNodeScale) }}</span>
          </div>
          <div class="attr-row">
            <span class="k">Bone Line</span>
            <span class="v"><input v-model.number="boneLineThickness" class="env-range" type="range" min="1" max="6" step="0.5" /> {{ fmt(boneLineThickness, 1) }}</span>
          </div>
          <label class="env-check"><input v-model="showLightObjects" type="checkbox" @change="applyHelperVisibility" /> Light Helpers</label>
          <label class="env-check"><input v-model="showCameraObjects" type="checkbox" @change="applyHelperVisibility" /> Camera Helpers</label>
          <div class="attr-row">
            <span class="k">Sel Offset F</span>
            <span class="v">
              <input v-model.number="selectionOffsetFactor" class="env-range" type="range" min="-6" max="6" step="0.25" />
              {{ fmt(selectionOffsetFactor, 2) }}
            </span>
          </div>
          <div class="attr-row">
            <span class="k">Sel Offset U</span>
            <span class="v">
              <input v-model.number="selectionOffsetUnits" class="env-range" type="range" min="-6" max="6" step="0.25" />
              {{ fmt(selectionOffsetUnits, 2) }}
            </span>
          </div>
          <div class="attr-row">
            <span class="k">Sel Depth N</span>
            <span class="v">
              <input v-model.number="selectionDepthNear" class="env-range" type="range" min="0" max="1" step="0.0000001" />
              {{ fmt(selectionDepthNear, 7) }}
            </span>
          </div>
          <div class="attr-row">
            <span class="k">Sel Depth F</span>
            <span class="v">
              <input v-model.number="selectionDepthFar" class="env-range" type="range" min="0" max="1" step="0.0000001" />
              {{ fmt(selectionDepthFar, 7) }}
            </span>
          </div>
          <div class="attr-row">
            <span class="k">Sel Wire</span>
            <span class="v">
              <input v-model.number="selectionWireWidth" class="env-range" type="range" min="0" max="6" step="0.1" />
              {{ fmt(selectionWireWidth, 1) }}
            </span>
          </div>
        </div>

        <button class="env-section-title" type="button" @click="cameraSectionOpen = !cameraSectionOpen">
          <span class="env-chevron">{{ cameraSectionOpen ? '▾' : '▸' }}</span> Camera
        </button>
        <div v-show="cameraSectionOpen" class="env-section-body">
          <div class="attr-row mono"><span class="k">View</span><span class="v">{{ getActiveCameraInfo().view }}</span></div>
          <div class="attr-row mono"><span class="k">FOV/N/F</span><span class="v">{{ fmt(getActiveCameraInfo().fov, 1) }} / {{ fmt(getActiveCameraInfo().near, 3) }} / {{ fmt(getActiveCameraInfo().far, 1) }}</span></div>
          <div class="attr-row mono">
            <span class="k">Position</span>
            <span class="v">
              X {{ fmt(getActiveCameraInfo().pos?.x, 3) }} Y {{ fmt(getActiveCameraInfo().pos?.y, 3) }} Z {{ fmt(getActiveCameraInfo().pos?.z, 3) }}
            </span>
          </div>
          <div class="attr-row mono">
            <span class="k">Target</span>
            <span class="v">
              X {{ fmt(getActiveCameraInfo().target?.x, 3) }} Y {{ fmt(getActiveCameraInfo().target?.y, 3) }} Z {{ fmt(getActiveCameraInfo().target?.z, 3) }}
            </span>
          </div>
          <div class="attr-row mono">
            <span class="k">Viewport</span>
            <span class="v">
              {{ getActiveCameraInfo().viewport ? `${Math.round(getActiveCameraInfo().viewport.x)},${Math.round(getActiveCameraInfo().viewport.y)} ${Math.round(getActiveCameraInfo().viewport.w)}x${Math.round(getActiveCameraInfo().viewport.h)}` : '-' }}
            </span>
          </div>
        </div>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.gltf-viewer :deep(*) {
  scrollbar-width: thin;
  scrollbar-color: #5f6775 #24272d;
}
.gltf-viewer :deep(*::-webkit-scrollbar) {
  width: 10px;
  height: 10px;
}
.gltf-viewer :deep(*::-webkit-scrollbar-track) {
  background: linear-gradient(#2b2e35, #252830);
  border: 1px solid #1d1f24;
}
.gltf-viewer :deep(*::-webkit-scrollbar-thumb) {
  background: linear-gradient(#5d6675, #4f5764);
  border: 1px solid #3b414c;
  border-radius: 8px;
}
.gltf-viewer :deep(*::-webkit-scrollbar-thumb:hover) {
  background: linear-gradient(#6f7a8c, #616b7b);
}
.gltf-viewer :deep(*::-webkit-scrollbar-thumb:active) {
  background: linear-gradient(#7f8da3, #6d7b8e);
}
.gltf-viewer :deep(*::-webkit-scrollbar-corner) {
  background: #24272d;
}

.gltf-viewer {
  width: 100%;
  height: 100%;
  min-height: 0;
  display: flex;
  position: relative;
  overflow: hidden;
}
.gltf-viewer.viewer-fullscreen {
  width: 100%;
  height: 100%;
}
.gltf-viewer.viewer-fullscreen .viewer-main {
  flex: 1 1 100%;
}
.right-dock {
  width: 280px;
  min-width: 240px;
  background: #2d2d2d;
  border-left: 1px solid #1f1f1f;
  display: flex;
  flex-direction: column;
  z-index: 8;
  transition: width 0.16s ease, transform 0.16s ease;
}
.right-dock.collapsed {
  width: 34px;
  min-width: 34px;
}
.right-dock.floating {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  min-width: 0;
  box-shadow: -8px 0 18px rgba(0, 0, 0, 0.32);
}
.dock-toggle {
  min-width: 38px;
  padding: 2px 6px;
}
.dock-pin-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.dock-pin-toggle.active {
  border-color: #84a8d4;
  background: linear-gradient(#4c77a8, #3f628a);
}
.dock-pin-icon {
  position: relative;
  width: 12px;
  height: 12px;
  display: inline-block;
}
.dock-pin-icon::before {
  content: '';
  position: absolute;
  left: 2px;
  top: 0;
  width: 8px;
  height: 5px;
  border: 1px solid currentColor;
  border-bottom: none;
  border-radius: 2px 2px 0 0;
}
.dock-pin-icon::after {
  content: '';
  position: absolute;
  left: 5px;
  top: 4px;
  width: 2px;
  height: 8px;
  background: currentColor;
}
.dock-menubar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 6px;
  background: linear-gradient(#3a3a3a, #2f2f2f);
  border-bottom: 1px solid #1f1f1f;
  border-top: 1px solid #4f4f4f;
}
.right-dock.collapsed .dock-menubar {
  flex-direction: column;
  align-items: stretch;
  padding: 4px 2px;
}
.dock-title {
  padding: 8px 10px;
  font-size: 12px;
  border-bottom: 1px solid #1f1f1f;
  color: #c9c9c9;
  background: linear-gradient(#3a3a3a, #313131);
}
.right-dock.collapsed .dock-title {
  writing-mode: vertical-rl;
  text-orientation: mixed;
  letter-spacing: 0.2px;
  text-align: center;
  padding: 8px 4px;
  cursor: pointer;
}
.dock-body {
  padding: 8px 10px;
  overflow: auto;
  font-size: 12px;
}
.env-panel {
  border-top: 1px solid #1f1f1f;
  margin-top: 2px;
}
.env-section-title {
  width: 100%;
  text-align: left;
  margin: 6px 0 4px;
  padding: 4px 6px;
  border: 1px solid #4b5565;
  border-radius: 3px;
  background: linear-gradient(#3c4553, #333c49);
  color: #dce6f6;
  font-size: 11px;
  letter-spacing: 0.2px;
}
.env-chevron {
  display: inline-block;
  width: 12px;
  margin-right: 2px;
  color: #aecaee;
}
.env-section-body {
  padding: 2px 4px 4px;
}
.env-color {
  width: 40px;
  height: 22px;
  padding: 0;
  border: 1px solid #5a6270;
  background: #1f2430;
}
.env-range {
  width: 120px;
  vertical-align: middle;
}
.env-check {
  display: block;
  color: #cdd6e6;
  font-size: 12px;
  margin: 4px 0;
}
.env-check input {
  margin-right: 6px;
}
.dock-empty {
  padding: 12px;
  color: #9ea6b4;
  font-size: 12px;
}
.attr-group {
  margin: 8px 0 6px;
  color: #9fbbe2;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.2px;
}
.attr-row {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
  line-height: 1.35;
}
.attr-row .k {
  width: 72px;
  flex: 0 0 72px;
  color: #a9b2c0;
}
.attr-row .v {
  color: #dde4f1;
  word-break: break-all;
}
.attr-row.mono .v,
.attr-row.uuid .v {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
}
.outline-panel {
  width: 260px;
  background: #2d2d2d;
  border-right: 1px solid #1f1f1f;
  color: #e0e0e0;
  overflow: auto;
}
.outline-title {
  padding: 8px 10px;
  font-size: 12px;
  border-bottom: 1px solid #1f1f1f;
  color: #c9c9c9;
  background: linear-gradient(#3a3a3a, #313131);
}
.outline-menubar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 3px 6px;
  background: linear-gradient(#3a3a3a, #2f2f2f);
  border-bottom: 1px solid #1f1f1f;
  border-top: 1px solid #4f4f4f;
}
.outline-list {
  list-style: none;
  margin: 0;
  padding: 6px;
}
.outline-row {
  list-style: none;
  font-size: 12px;
  padding-top: 4px;
  padding-bottom: 4px;
  border-radius: 4px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 6px;
}
.outline-row:hover {
  background: #464646;
}
.outline-row.active {
  background: linear-gradient(#4a79ad, #3a6798);
  color: #fff;
}
.twisty {
  width: 12px;
  text-align: center;
  color: #cfcfcf;
  user-select: none;
}
.twisty.empty {
  color: #666;
}
.eye-btn {
  border: none;
  background: transparent;
  color: #cfcfcf;
  font-size: 12px;
  padding: 0;
  cursor: pointer;
}
.eye-btn:hover {
  color: #fff;
}
.viewport-area {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.viewport-stack {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
.viewport-stack .viewport-area {
  flex: 1 1 58%;
  min-height: 0;
}
.graph-panel {
  flex: 1 1 42%;
  min-height: 140px;
  border-top: 1px solid #1f1f1f;
  background: #232323;
  display: flex;
  flex-direction: column;
}
.graph-title {
  flex: 0 0 auto;
  padding: 6px 10px;
  border-bottom: 1px solid #1f1f1f;
  font-size: 12px;
  color: #cfcfcf;
  background: linear-gradient(#3a3a3a, #313131);
}
.graph-canvas {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 8px;
  cursor: grab;
  user-select: none;
}
.graph-canvas:active {
  cursor: grabbing;
}
.graph-stage {
  position: relative;
  min-height: 260px;
  min-width: 620px;
}
.graph-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.graph-edge {
  stroke: #6f8fb4;
  stroke-width: 1.5;
}
.graph-node {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  padding: 0 8px;
  border-radius: 5px;
  border: 1px solid #5a6d84;
  background: linear-gradient(#2f3945, #29323c);
  color: #d7d7d7;
  cursor: pointer;
  text-align: left;
}
.graph-node:hover {
  border-color: #7f9fc5;
  background: linear-gradient(#3b4a59, #32404d);
}
.graph-node.active {
  border-color: #8ebfff;
  background: linear-gradient(#3a6ea5, #315f90);
  color: #fff;
}
.graph-node-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
}
.viewer-main {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-width: 0;
}
.view-overlays {
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
}
.view-overlay {
  position: absolute;
  box-sizing: border-box;
  border: 1px solid rgba(180, 180, 180, 0.25);
  background: transparent;
  cursor: default;
  padding: 0;
  pointer-events: none;
}
.view-overlay.active {
  border: 2px solid rgba(91, 170, 255, 0.85);
}
.view-overlay.debug {
  border: 2px dashed rgba(255, 180, 80, 0.9);
  background: rgba(255, 180, 80, 0.06);
  pointer-events: none;
}
.view-overlay.debug.active {
  border-style: solid;
  border-color: rgba(90, 190, 255, 0.95);
  background: rgba(90, 190, 255, 0.08);
}
.view-label {
  position: absolute;
  left: 6px;
  top: 4px;
  font-size: 10px;
  color: rgba(220, 220, 220, 0.9);
  background: rgba(20, 20, 20, 0.55);
  border-radius: 3px;
  padding: 1px 5px;
  pointer-events: none;
}
.view-debug-label {
  position: absolute;
  right: 6px;
  bottom: 4px;
  font-size: 10px;
  color: rgba(250, 246, 228, 0.95);
  background: rgba(26, 20, 10, 0.6);
  border: 1px solid rgba(232, 185, 110, 0.85);
  border-radius: 3px;
  padding: 1px 4px;
  pointer-events: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.viewport-area :deep(canvas) {
  position: absolute;
  inset: 0;
  display: block;
  width: 100% !important;
  height: 100% !important;
}
.viewport-menubar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 2px;
  background: linear-gradient(#3a3a3a, #2f2f2f);
  border-bottom: 1px solid #1f1f1f;
  border-top: 1px solid #4f4f4f;
  padding: 3px 6px;
}
.menu-item {
  border: 1px solid #3c3c3c;
  background: transparent;
  color: #cfcfcf;
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 3px;
  cursor: pointer;
}
.menu-item:hover {
  border-color: #626262;
  background: #454545;
  color: #e8e8e8;
}
.menu-root:hover > .menu-item,
.menu-root:focus-within > .menu-item {
  border-color: #6e7a8f;
  background: #3b4452;
  color: #e9f2ff;
}
.menu-root {
  position: relative;
}
.menu-popover {
  display: none;
  position: absolute;
  left: 0;
  top: calc(100% + 2px);
  min-width: 170px;
  background: linear-gradient(#32353c, #2a2d33);
  border: 1px solid #535353;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.28);
  padding: 4px;
  z-index: 20;
}
.menu-root:hover .menu-popover,
.menu-root:focus-within .menu-popover {
  display: block;
}
.menu-cmd {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  background: transparent;
  color: #d7dbe3;
  font-size: 12px;
  border-radius: 3px;
  padding: 4px 8px;
  cursor: pointer;
}
.menu-cmd:hover {
  border-color: #6e7a8f;
  background: #3b4452;
}
.menu-cmd.checked {
  border-color: #6084b2;
  background: #33465f;
  color: #eff6ff;
}
.menu-cmd.checked::before {
  content: '✓ ';
  color: #a7c9ff;
}
.menu-sep {
  height: 1px;
  margin: 4px 2px;
  background: #4f5663;
}
.menu-group-title {
  margin: 4px 4px 2px;
  padding: 2px 4px;
  border-left: 2px solid #6a89b3;
  color: #a9c2e1;
  font-size: 11px;
  letter-spacing: 0.2px;
  text-transform: uppercase;
  user-select: none;
}
.viewport-toolbar {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  background: linear-gradient(#3a3a3a, #2f2f2f);
  border-bottom: 1px solid #1f1f1f;
}
.viewport-toolbar button {
  border: 1px solid #5c5c5c;
  background: linear-gradient(#4a4a4a, #3c3c3c);
  color: #e7e7e7;
  border-radius: 4px;
  padding: 3px 8px;
  font-size: 12px;
}
.viewport-toolbar button:hover {
  border-color: #7b7b7b;
  background: linear-gradient(#535353, #454545);
}
.viewport-toolbar button.active {
  border-color: #84a8d4;
  background: linear-gradient(#4c77a8, #3f628a);
  color: #f7fbff;
}
.toolbar-sep {
  width: 1px;
  height: 20px;
  background: #676767;
  margin: 0 3px;
}
.group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.label {
  font-size: 12px;
  color: #cfcfcf;
}
.viewport-menu button {
  border: 1px solid #666;
  background: #4a4a4a;
  color: #e5e5e5;
  border-radius: 6px;
  padding: 4px 8px;
  font-size: 12px;
  cursor: pointer;
}
.viewport-menu button:hover {
  background: #585858;
}
.viewport-menu button.active {
  background: #3f3f3f;
  border-color: #8a8a8a;
  color: #ffffff;
}
.active-view-chip {
  min-width: 64px;
  text-transform: uppercase;
  letter-spacing: 0.3px;
}
.hint {
  margin-left: auto;
  font-size: 12px;
  color: #c4c4c4;
}
</style>
