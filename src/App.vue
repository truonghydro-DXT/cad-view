<template>
  <div id="app-root">
    <!-- Upload screen when no file is selected -->
    <div v-if="!store.selectedFile" class="upload-screen">
      <div class="home-layout">
        <section class="home-open">
          <p class="home-badge">Mở bản vẽ</p>
          <FileUpload @file-select="handleFileSelect" />
        </section>
        <section class="home-convert">
          <p class="home-badge">Chuyển hệ tọa độ</p>
          <ConvertWGS84 embedded />
        </section>
      </div>
    </div>

    <!-- CAD viewer when file is selected -->
    <div v-else class="viewer-screen">
      <DrawTools :ready="viewerReady" />
      <MoveToolbarButton :ready="viewerReady" />
      <div class="viewer-toolbar">
        <ExportDXF :ready="viewerReady" />
        <ExportPDF
          :ready="viewerReady"
          :file-name="`${(store.selectedFile?.name ?? 'ban-ve').replace(/\.[^.]+$/, '')}.pdf`"
        />
        <el-button type="primary" plain @click="convertDialogVisible = true">
          VN2000 -> WGS84
        </el-button>
      </div>
      <el-dialog
        v-model="convertDialogVisible"
        title="VN2000 -> WGS84"
        width="min(96vw, 1200px)"
        top="4vh"
        :close-on-click-modal="false"
        destroy-on-close
      >
        <ConvertWGS84 />
      </el-dialog>
      <el-alert
        v-if="webglFatalError"
        title="Khong the tao WebGL context"
        :description="webglTroubleshootingMessage"
        type="error"
        :closable="false"
        show-icon
        class="viewer-error-alert"
      />
      <el-button
        v-if="webglFatalError"
        type="primary"
        class="viewer-error-retry"
        @click="retryViewerAfterWebglFailure"
      >
        {{ isWebGLAvailableAtStartup ? (webglBlockedByBrowser ? 'Tai lai trang' : 'Thu lai') : 'Kiem tra lai WebGL' }}
      </el-button>
      <el-alert
        v-if="largeFileNotice"
        :title="largeFileNotice"
        type="info"
        :closable="true"
        show-icon
        class="viewer-large-file-alert"
      />
      <FontCAD
        v-if="!webglFatalError && viewerLocalFile"
        :key="`${viewerRenderKey}-${viewerLocalFile.name}-${viewerLocalFile.size}-${viewerLocalFile.lastModified}`"
        locale="en"
        :local-file="viewerLocalFile"
        :use-main-thread-draw="viewerUseMainThreadDraw"
        :large-file-settings="largeFileSettings"
        @create="handleViewerCreate"
        :base-url="CAD_DATA_BASE_URL"
      />

    </div>
  </div>
</template>

<script setup lang="ts">
import { AcApSettingManager } from '@mlightcad/cad-simple-viewer'
import { AcApDocManager, AcEdCommandStack } from '@mlightcad/cad-simple-viewer'
import { onBeforeUnmount, onErrorCaptured, ref, watch, computed } from 'vue'

import {
  AcApDrawCircleCmd,
  AcApDrawGridCmd,
  AcApDrawLineCmd,
  AcApDrawPointCmd,
  AcApDrawRegionCmd,
  AcApDrawScaleCmd,
  AcApDrawSheetCmd,
  AcApDrawTableCmd,
  AcApDrawTextCmd,
  AcApQuitCmd,
  bindDrawEditing,
  clearAnnotations,
  enableLineWeightDisplay,
  ensureDrawLayers
} from './commands'
import ConvertWGS84 from './ConvertWGS84.vue'
import ExportDXF from './components/ExportDXF.vue'
import ExportPDF from './ExportPDF.vue'
import FontCAD from './FontCAD.vue'
import DrawTools from './components/DrawTools.vue'
import FileUpload from './components/FileUpload.vue'
import MoveToolbarButton from './components/MoveToolbarButton.vue'
import { store } from './store'
import {
  formatFileSize,
  getLargeFileSettings
} from './utils/largeFileMode'

const CAD_DATA_BASE_URL = `${import.meta.env.BASE_URL}assets/`
let commandsRegistered = false
let osmOverlayController: OSMOverlayController | null = null
let removeOsmLifecycleBinding: (() => void) | null = null
let removeLibraryExportMenuHider: (() => void) | null = null

type Point2dLike = {
  x: number
  y: number
}

type OSMOverlayController = {
  dispose: () => void
}

const OSM_TILE_SIZE = 256
const OSM_MIN_ZOOM = 10
/** tile.openstreetmap.org chỉ phục vụ tới z19; z20+ trả 404 nên nền biến mất khi zoom lớn. */
const OSM_MAX_TILE_ZOOM = 19
const OSM_ORIGIN_SHIFT = 20037508.342789244
const MAX_MERCATOR_LAT = 85.051129
const OSM_ATTRIBUTION = '© OpenStreetMap'
const OSM_TILE_BASE = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`
/** Ưu tiên proxy local (tránh ISP RST tới Fastly), rồi OSM.org, rồi OSM France. */
const OSM_TILE_SOURCES: Array<(zoom: number, x: number, y: number) => string> = [
  (zoom, x, y) => `${OSM_TILE_BASE}osm-tiles/${zoom}/${x}/${y}.png`.replace(/^\.\//, '/'),
  (zoom, x, y) => `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`,
  (zoom, x, y) =>
    `https://${['a', 'b', 'c'][x % 3]}.tile.openstreetmap.fr/osmfr/${zoom}/${x}/${y}.png`
]
const OSM_TILE_PREFETCH_RING = 2
const OSM_NEW_TILE_BUDGET_PER_FRAME = 14
const OSM_TILE_EVICT_IDLE_MS = 900
const OSM_TILE_POOL_MAX = 420
const OSM_MOTION_SETTLE_MS = 120
const OSM_DRAG_CREATE_BUDGET_PER_FRAME = 1
const OSM_POST_DRAG_BURST_BUDGET_PER_FRAME = 64
const OSM_POST_DRAG_BURST_MS = 220
const WEBGL_CONTEXT_ERROR_MESSAGE = 'Error creating WebGL context'
const WEBGL_CONTEXT_BLOCKED_REASON = 'context loss and was blocked'
const FORCE_MAIN_THREAD_DRAW = import.meta.env.VITE_FORCE_MAIN_THREAD_DRAW === 'true'
const ENABLE_OSM_OVERLAY = import.meta.env.VITE_ENABLE_OSM_OVERLAY !== 'false'

type DxfToMercatorMode = 'auto' | 'identity' | 'epsg4326' | 'affine'

const parseEnvNumber = (value: string | undefined, fallbackValue: number) => {
  if (!value) {
    return fallbackValue
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallbackValue
}

const toMercatorMode = (value: string | undefined): DxfToMercatorMode => {
  const normalized = value?.toLowerCase()
  if (normalized === 'identity' || normalized === 'epsg4326' || normalized === 'affine') {
    return normalized
  }

  return 'auto'
}

const canCreateAnyWebGLContext = () => {
  if (typeof document === 'undefined') {
    return true
  }

  const probeCanvas = document.createElement('canvas')
  const contextNames: Array<'webgl2' | 'webgl' | 'experimental-webgl'> = [
    'webgl2',
    'webgl',
    'experimental-webgl'
  ]

  return contextNames.some((contextName) => {
    try {
      return !!probeCanvas.getContext(contextName)
    } catch {
      return false
    }
  })
}

const DXF_TO_MERCATOR_MODE = toMercatorMode(import.meta.env.VITE_DXF_TO_MERCATOR_MODE)
const OSM_INITIAL_CENTER_LON = parseEnvNumber(import.meta.env.VITE_OSM_INITIAL_LON, 0)
const OSM_INITIAL_CENTER_LAT = parseEnvNumber(import.meta.env.VITE_OSM_INITIAL_LAT, 0)
const DXF_TO_MERCATOR_AFFINE = {
  a: parseEnvNumber(import.meta.env.VITE_DXF_AFFINE_A, 1),
  b: parseEnvNumber(import.meta.env.VITE_DXF_AFFINE_B, 0),
  c: parseEnvNumber(import.meta.env.VITE_DXF_AFFINE_C, 0),
  d: parseEnvNumber(import.meta.env.VITE_DXF_AFFINE_D, 1),
  tx: parseEnvNumber(import.meta.env.VITE_DXF_AFFINE_TX, 0),
  ty: parseEnvNumber(import.meta.env.VITE_DXF_AFFINE_TY, 0)
}

let isCrsWarningShown = false

const positiveModulo = (value: number, modulo: number) => {
  return ((value % modulo) + modulo) % modulo
}

const mercatorToGlobalPixel = (point: Point2dLike, zoom: number): Point2dLike => {
  const worldSize = OSM_TILE_SIZE * Math.pow(2, zoom)

  return {
    x: ((point.x + OSM_ORIGIN_SHIFT) / (2 * OSM_ORIGIN_SHIFT)) * worldSize,
    y: ((OSM_ORIGIN_SHIFT - point.y) / (2 * OSM_ORIGIN_SHIFT)) * worldSize
  }
}

const isLikelyLonLat = (point: Point2dLike) => {
  return Math.abs(point.x) <= 180 && Math.abs(point.y) <= 90
}

const isWithinMercatorBounds = (point: Point2dLike) => {
  return Math.abs(point.x) <= OSM_ORIGIN_SHIFT && Math.abs(point.y) <= OSM_ORIGIN_SHIFT
}

const isFinitePoint = (point: Point2dLike) => {
  return Number.isFinite(point.x) && Number.isFinite(point.y)
}

const lonLatToMercator = (point: Point2dLike): Point2dLike => {
  const longitude = ((((point.x + 180) % 360) + 360) % 360) - 180
  const latitude = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, point.y))

  const x = (longitude * OSM_ORIGIN_SHIFT) / 180
  let y = Math.log(Math.tan(((90 + latitude) * Math.PI) / 360)) / (Math.PI / 180)
  y = (y * OSM_ORIGIN_SHIFT) / 180

  return { x, y }
}

const applyAffineTransform = (point: Point2dLike): Point2dLike => {
  const { a, b, c, d, tx, ty } = DXF_TO_MERCATOR_AFFINE

  return {
    x: a * point.x + b * point.y + tx,
    y: c * point.x + d * point.y + ty
  }
}

const isCustomAffineConfigured = () => {
  const { a, b, c, d, tx, ty } = DXF_TO_MERCATOR_AFFINE
  return a !== 1 || b !== 0 || c !== 0 || d !== 1 || tx !== 0 || ty !== 0
}

const dxfToMercator = (point: Point2dLike): Point2dLike => {
  switch (DXF_TO_MERCATOR_MODE) {
    case 'identity':
      return point
    case 'epsg4326':
      return lonLatToMercator(point)
    case 'affine':
      return applyAffineTransform(point)
    case 'auto':
    default:
      if (isLikelyLonLat(point)) {
        return lonLatToMercator(point)
      }

      if (isWithinMercatorBounds(point)) {
        return point
      }

      if (isCustomAffineConfigured()) {
        return applyAffineTransform(point)
      }

      if (!isCrsWarningShown) {
        console.warn(
          '[osm-overlay] DXF coordinates are not in EPSG:3857. Set VITE_DXF_TO_MERCATOR_MODE and affine params to align with OSM.'
        )
        isCrsWarningShown = true
      }

      return point
  }
}

const createOsmOverlayUnderCadData = (): OSMOverlayController | null => {
  const view = AcApDocManager.instance.curView
  const canvas = view.canvas
  const overlayDocument = canvas.ownerDocument
  const overlayWindow = overlayDocument.defaultView ?? window
  const container = canvas.parentElement ?? view.container

  if (!container) {
    return null
  }

  const previousOverlay = container.querySelector<HTMLElement>('.osm-overlay-layer')
  previousOverlay?.remove()

  const computedStyle = overlayWindow.getComputedStyle(container)
  if (computedStyle.position === 'static') {
    container.style.position = 'relative'
  }

  const overlayLayer = overlayDocument.createElement('div')
  overlayLayer.className = 'osm-overlay-layer'
  overlayLayer.style.position = 'absolute'
  overlayLayer.style.left = '0'
  overlayLayer.style.top = '0'
  overlayLayer.style.width = '100%'
  overlayLayer.style.height = '100%'
  overlayLayer.style.overflow = 'hidden'
  overlayLayer.style.pointerEvents = 'none'
  // Keep overlay above base CAD canvas but do not rewrite CAD internal z-order.
  overlayLayer.style.zIndex = '10'
  overlayLayer.style.opacity = '0.42'

  const attribution = overlayDocument.createElement('div')
  attribution.textContent = OSM_ATTRIBUTION
  attribution.style.position = 'absolute'
  attribution.style.right = '8px'
  attribution.style.bottom = '4px'
  attribution.style.padding = '2px 6px'
  attribution.style.fontSize = '10px'
  attribution.style.borderRadius = '4px'
  attribution.style.background = 'rgba(255, 255, 255, 0.7)'
  attribution.style.color = '#1f2937'
  attribution.style.textShadow = 'none'
  attribution.style.zIndex = '3'

  overlayLayer.appendChild(attribution)
  container.appendChild(overlayLayer)

  const tileElements = new Map<string, HTMLImageElement>()
  const tileSlots = new Map<string, { wrappedX: number; tileY: number }>()
  const tileLastSeenAt = new Map<string, number>()
  const tileSourceIndex = new WeakMap<HTMLImageElement, number>()
  const tileRecyclePool: HTMLImageElement[] = []

  const applyTileSource = (tileImage: HTMLImageElement, zoom: number, x: number, y: number, sourceIndex = 0) => {
    const source = OSM_TILE_SOURCES[sourceIndex]
    if (!source) {
      tileImage.style.visibility = 'hidden'
      return
    }

    tileSourceIndex.set(tileImage, sourceIndex)
    tileImage.dataset.tile = `${zoom}/${x}/${y}`
    tileImage.style.visibility = 'visible'
    tileImage.src = source(zoom, x, y)
  }
  const initialCenterMercator = lonLatToMercator({
    x: OSM_INITIAL_CENTER_LON,
    y: OSM_INITIAL_CENTER_LAT
  })
  let rafId = 0
  let previousCenterScreen: Point2dLike | null = null
  let previousZoomFloat = Number.NaN
  let previousBaseZoom = -1
  let lastMotionAt = 0

  const renderTiles = () => {
    rafId = overlayWindow.requestAnimationFrame(renderTiles)

    const width = container.clientWidth
    const height = container.clientHeight

    if (width <= 0 || height <= 0) {
      return
    }

    if (!overlayLayer.isConnected) {
      container.appendChild(overlayLayer)
    }

    let center: Point2dLike = { x: 0, y: 0 }
    let zoomFloat = 2
    let centerScreen: Point2dLike = { x: width / 2, y: height / 2 }
    let measuredPixelsPerDxfUnitX = 1
    let measuredPixelsPerDxfUnitY = 1

    try {
      center = view.center
      centerScreen = view.worldToScreen(center)
      const eastOneMeter = view.worldToScreen({ x: center.x + 1, y: center.y })

      const northOneMeter = view.worldToScreen({ x: center.x, y: center.y + 1 })
      const pixelsPerDxfUnitX = Math.hypot(eastOneMeter.x - centerScreen.x, eastOneMeter.y - centerScreen.y)
      const pixelsPerDxfUnitY = Math.hypot(
        northOneMeter.x - centerScreen.x,
        northOneMeter.y - centerScreen.y
      )
      measuredPixelsPerDxfUnitX = pixelsPerDxfUnitX
      measuredPixelsPerDxfUnitY = pixelsPerDxfUnitY

      const centerMercator = dxfToMercator(center)
      const eastMercator = dxfToMercator({ x: center.x + 1, y: center.y })
      const northMercator = dxfToMercator({ x: center.x, y: center.y + 1 })
      const mercatorUnitsPerDxfUnitX = Math.hypot(
        eastMercator.x - centerMercator.x,
        eastMercator.y - centerMercator.y
      )

      const mercatorUnitsPerDxfUnitY = Math.hypot(
        northMercator.x - centerMercator.x,
        northMercator.y - centerMercator.y
      )

      const scaleSamples: number[] = []
      if (mercatorUnitsPerDxfUnitX > 0 && Number.isFinite(pixelsPerDxfUnitX)) {
        scaleSamples.push(pixelsPerDxfUnitX / mercatorUnitsPerDxfUnitX)
      }

      if (mercatorUnitsPerDxfUnitY > 0 && Number.isFinite(pixelsPerDxfUnitY)) {
        scaleSamples.push(pixelsPerDxfUnitY / mercatorUnitsPerDxfUnitY)
      }

      const pixelsPerMeter =
        scaleSamples.length > 0
          ? scaleSamples.reduce((sum, value) => sum + value, 0) / scaleSamples.length
          : Number.NaN

      if (Number.isFinite(pixelsPerMeter) && pixelsPerMeter > 0) {
        const metersPerPixel = 1 / pixelsPerMeter
        const baseResolution = (2 * OSM_ORIGIN_SHIFT) / OSM_TILE_SIZE
        const calculatedZoomFloat = Math.log2(baseResolution / metersPerPixel)
        if (Number.isFinite(calculatedZoomFloat)) {
          // Không kẹp zoom camera: tile z19 sẽ được phóng theo CAD khi zoom lớn hơn.
          zoomFloat = calculatedZoomFloat
        }
      }
    } catch {
      // Keep fallback center/zoom so OSM tiles are still rendered.
    }

    const baseZoom = Math.max(
      OSM_MIN_ZOOM,
      Math.min(OSM_MAX_TILE_ZOOM, Math.floor(Number.isFinite(zoomFloat) ? zoomFloat : OSM_MIN_ZOOM))
    )
    const zoomScale = Math.pow(2, Math.max(0, zoomFloat - baseZoom))
    const tileCountPerAxis = Math.pow(2, baseZoom)
    const now = Date.now()

    const previousScreen = previousCenterScreen
    const hasPreviousFrame = previousScreen !== null
    const centerDeltaPx = hasPreviousFrame
      ? Math.hypot(centerScreen.x - previousScreen.x, centerScreen.y - previousScreen.y)
      : 0
    const zoomDelta = hasPreviousFrame ? Math.abs(zoomFloat - previousZoomFloat) : 0
    const isCameraMoving =
      !hasPreviousFrame || centerDeltaPx > 0.35 || zoomDelta > 1e-4 || baseZoom !== previousBaseZoom

    if (isCameraMoving) {
      lastMotionAt = now
    }

    const sinceMotionMs = now - lastMotionAt
    const isMotionSettling = sinceMotionMs < OSM_MOTION_SETTLE_MS
    const isPostMotionBurst =
      !isMotionSettling && sinceMotionMs < OSM_MOTION_SETTLE_MS + OSM_POST_DRAG_BURST_MS

    const mercatorCenter = dxfToMercator(center)
    const centerForTiles = isFinitePoint(mercatorCenter) ? mercatorCenter : initialCenterMercator

    const centerGlobalPixel = mercatorToGlobalPixel(centerForTiles, baseZoom)
    const centerTileX = Math.floor(centerGlobalPixel.x / OSM_TILE_SIZE)
    const centerTileY = Math.floor(centerGlobalPixel.y / OSM_TILE_SIZE)

    // Build an affine transform from OSM global pixel coordinates to screen coordinates.
    // This keeps OSM locked to CAD even when the view is rotated or skewed.
    let m00 = zoomScale
    let m01 = 0
    let m10 = 0
    let m11 = zoomScale
    let mTx = centerScreen.x - m00 * centerGlobalPixel.x - m01 * centerGlobalPixel.y
    let mTy = centerScreen.y - m10 * centerGlobalPixel.x - m11 * centerGlobalPixel.y

    try {
      const sampleDx = Math.max(1e-4, Math.min(100000, 128 / Math.max(1e-6, measuredPixelsPerDxfUnitX)))
      const sampleDy = Math.max(1e-4, Math.min(100000, 128 / Math.max(1e-6, measuredPixelsPerDxfUnitY)))
      const sampleXPlus = { x: center.x + sampleDx, y: center.y }
      const sampleXMinus = { x: center.x - sampleDx, y: center.y }
      const sampleYPlus = { x: center.x, y: center.y + sampleDy }
      const sampleYMinus = { x: center.x, y: center.y - sampleDy }

      const sampleScreenXPlus = view.worldToScreen(sampleXPlus)
      const sampleScreenXMinus = view.worldToScreen(sampleXMinus)
      const sampleScreenYPlus = view.worldToScreen(sampleYPlus)
      const sampleScreenYMinus = view.worldToScreen(sampleYMinus)

      const sampleMercatorXPlus = dxfToMercator(sampleXPlus)
      const sampleMercatorXMinus = dxfToMercator(sampleXMinus)
      const sampleMercatorYPlus = dxfToMercator(sampleYPlus)
      const sampleMercatorYMinus = dxfToMercator(sampleYMinus)
      const sampleGlobalPixelXPlus = mercatorToGlobalPixel(sampleMercatorXPlus, baseZoom)
      const sampleGlobalPixelXMinus = mercatorToGlobalPixel(sampleMercatorXMinus, baseZoom)
      const sampleGlobalPixelYPlus = mercatorToGlobalPixel(sampleMercatorYPlus, baseZoom)
      const sampleGlobalPixelYMinus = mercatorToGlobalPixel(sampleMercatorYMinus, baseZoom)

      const dgxX = sampleGlobalPixelXPlus.x - sampleGlobalPixelXMinus.x
      const dgxY = sampleGlobalPixelXPlus.y - sampleGlobalPixelXMinus.y
      const dgyX = sampleGlobalPixelYPlus.x - sampleGlobalPixelYMinus.x
      const dgyY = sampleGlobalPixelYPlus.y - sampleGlobalPixelYMinus.y

      const dsxX = sampleScreenXPlus.x - sampleScreenXMinus.x
      const dsxY = sampleScreenXPlus.y - sampleScreenXMinus.y
      const dsyX = sampleScreenYPlus.x - sampleScreenYMinus.x
      const dsyY = sampleScreenYPlus.y - sampleScreenYMinus.y

      const detG = dgxX * dgyY - dgxY * dgyX
      if (Math.abs(detG) > 1e-9) {
        const invG00 = dgyY / detG
        const invG01 = -dgxY / detG
        const invG10 = -dgyX / detG
        const invG11 = dgxX / detG

        m00 = dsxX * invG00 + dsyX * invG10
        m01 = dsxX * invG01 + dsyX * invG11
        m10 = dsxY * invG00 + dsyY * invG10
        m11 = dsxY * invG01 + dsyY * invG11
        mTx = centerScreen.x - m00 * centerGlobalPixel.x - m01 * centerGlobalPixel.y
        mTy = centerScreen.y - m10 * centerGlobalPixel.x - m11 * centerGlobalPixel.y
      }
    } catch {
      // Keep fallback non-rotated transform.
    }

    const canUseTransformOnlyPath = isMotionSettling && baseZoom === previousBaseZoom && tileElements.size > 0
    if (canUseTransformOnlyPath) {
      const centerWrappedX = positiveModulo(centerTileX, tileCountPerAxis)

      for (const [tileKey, tileImage] of tileElements.entries()) {
        const slot = tileSlots.get(tileKey)
        if (!slot) {
          continue
        }

        let wrappedDelta = positiveModulo(slot.wrappedX - centerWrappedX, tileCountPerAxis)
        if (wrappedDelta > tileCountPerAxis / 2) {
          wrappedDelta -= tileCountPerAxis
        }

        const tileX = centerTileX + wrappedDelta
        const tileOriginGlobalX = tileX * OSM_TILE_SIZE
        const tileOriginGlobalY = slot.tileY * OSM_TILE_SIZE
        const tileScreenX = m00 * tileOriginGlobalX + m01 * tileOriginGlobalY + mTx
        const tileScreenY = m10 * tileOriginGlobalX + m11 * tileOriginGlobalY + mTy
        tileImage.style.transform = `matrix(${m00}, ${m10}, ${m01}, ${m11}, ${tileScreenX}, ${tileScreenY})`
      }

      previousCenterScreen = { x: centerScreen.x, y: centerScreen.y }
      previousZoomFloat = zoomFloat
      previousBaseZoom = baseZoom
      return
    }

    const detM = m00 * m11 - m01 * m10
    const visibleGlobalPixels: Point2dLike[] = []

    if (Math.abs(detM) > 1e-9) {
      const invM00 = m11 / detM
      const invM01 = -m01 / detM
      const invM10 = -m10 / detM
      const invM11 = m00 / detM

      const screenCorners: Point2dLike[] = [
        { x: 0, y: 0 },
        { x: width, y: 0 },
        { x: 0, y: height },
        { x: width, y: height }
      ]

      for (const corner of screenCorners) {
        const dsx = corner.x - mTx
        const dsy = corner.y - mTy
        const dgpX = invM00 * dsx + invM01 * dsy
        const dgpY = invM10 * dsx + invM11 * dsy

        visibleGlobalPixels.push({
          x: dgpX,
          y: dgpY
        })
      }
    } else {
      // Degenerate transform fallback.
      const topLeftGlobalPixelX = centerGlobalPixel.x - centerScreen.x / zoomScale
      const topLeftGlobalPixelY = centerGlobalPixel.y - centerScreen.y / zoomScale
      const visibleWidthInBasePixels = width / zoomScale
      const visibleHeightInBasePixels = height / zoomScale

      visibleGlobalPixels.push(
        { x: topLeftGlobalPixelX, y: topLeftGlobalPixelY },
        { x: topLeftGlobalPixelX + visibleWidthInBasePixels, y: topLeftGlobalPixelY },
        { x: topLeftGlobalPixelX, y: topLeftGlobalPixelY + visibleHeightInBasePixels },
        {
          x: topLeftGlobalPixelX + visibleWidthInBasePixels,
          y: topLeftGlobalPixelY + visibleHeightInBasePixels
        }
      )
    }

    const visibleMinX = Math.min(...visibleGlobalPixels.map((point) => point.x))
    const visibleMaxX = Math.max(...visibleGlobalPixels.map((point) => point.x))
    const visibleMinY = Math.min(...visibleGlobalPixels.map((point) => point.y))
    const visibleMaxY = Math.max(...visibleGlobalPixels.map((point) => point.y))

    const startTileX = Math.floor(visibleMinX / OSM_TILE_SIZE) - OSM_TILE_PREFETCH_RING
    const endTileX = Math.floor(visibleMaxX / OSM_TILE_SIZE) + OSM_TILE_PREFETCH_RING
    const startTileY = Math.floor(visibleMinY / OSM_TILE_SIZE) - OSM_TILE_PREFETCH_RING
    const endTileY = Math.floor(visibleMaxY / OSM_TILE_SIZE) + OSM_TILE_PREFETCH_RING
    const visibleKeys = new Set<string>()
    const requestedNewTiles: Array<{ key: string; wrappedX: number; tileX: number; tileY: number }> = []

    for (let tileY = startTileY; tileY <= endTileY; tileY += 1) {
      if (tileY < 0 || tileY >= tileCountPerAxis) {
        continue
      }

      for (let tileX = startTileX; tileX <= endTileX; tileX += 1) {
        const wrappedTileX = positiveModulo(tileX, tileCountPerAxis)
        const tileKey = `${baseZoom}/${wrappedTileX}/${tileY}`
        visibleKeys.add(tileKey)
        tileLastSeenAt.set(tileKey, now)

        let tileImage = tileElements.get(tileKey)
        if (!tileImage) {
          requestedNewTiles.push({
            key: tileKey,
            wrappedX: wrappedTileX,
            tileX,
            tileY
          })
          continue
        }

        const tileOriginGlobalX = tileX * OSM_TILE_SIZE
        const tileOriginGlobalY = tileY * OSM_TILE_SIZE
        const tileScreenX = m00 * tileOriginGlobalX + m01 * tileOriginGlobalY + mTx
        const tileScreenY = m10 * tileOriginGlobalX + m11 * tileOriginGlobalY + mTy
        tileImage.style.transform = `matrix(${m00}, ${m10}, ${m01}, ${m11}, ${tileScreenX}, ${tileScreenY})`
      }
    }

    if (requestedNewTiles.length > 0) {
      requestedNewTiles.sort((left, right) => {
        const leftDx = left.tileX - centerTileX
        const leftDy = left.tileY - centerTileY
        const rightDx = right.tileX - centerTileX
        const rightDy = right.tileY - centerTileY

        return leftDx * leftDx + leftDy * leftDy - (rightDx * rightDx + rightDy * rightDy)
      })

      let createBudget = OSM_NEW_TILE_BUDGET_PER_FRAME
      if (isMotionSettling) {
        createBudget = OSM_DRAG_CREATE_BUDGET_PER_FRAME
      } else if (isPostMotionBurst) {
        createBudget = Math.max(OSM_NEW_TILE_BUDGET_PER_FRAME, OSM_POST_DRAG_BURST_BUDGET_PER_FRAME)
      }

      const createCount = Math.min(createBudget, requestedNewTiles.length)
      for (let index = 0; index < createCount; index += 1) {
        const request = requestedNewTiles[index]

        let tileImage = tileRecyclePool.pop()
        if (!tileImage) {
          const created = overlayDocument.createElement('img')
          created.alt = ''
          created.decoding = 'async'
          created.loading = 'eager'
          created.style.position = 'absolute'
          created.style.width = `${OSM_TILE_SIZE}px`
          created.style.height = `${OSM_TILE_SIZE}px`
          created.style.userSelect = 'none'
          created.style.pointerEvents = 'none'
          created.style.transformOrigin = 'top left'
          created.referrerPolicy = 'origin'
          created.addEventListener('error', () => {
            const parts = (created.dataset.tile || '').split('/')
            const zoom = Number(parts[0])
            const tileX = Number(parts[1])
            const tileY = Number(parts[2])
            const nextSource = (tileSourceIndex.get(created) ?? 0) + 1
            if (
              nextSource < OSM_TILE_SOURCES.length &&
              Number.isFinite(zoom) &&
              Number.isFinite(tileX) &&
              Number.isFinite(tileY)
            ) {
              applyTileSource(created, zoom, tileX, tileY, nextSource)
              return
            }
            created.style.visibility = 'hidden'
            attribution.textContent = 'OSM: không tải được bản đồ nền'
          })
          created.addEventListener('load', () => {
            created.style.visibility = 'visible'
            attribution.textContent = OSM_ATTRIBUTION
          })
          tileImage = created
        }

        applyTileSource(tileImage, baseZoom, request.wrappedX, request.tileY)
        overlayLayer.appendChild(tileImage)
        tileElements.set(request.key, tileImage)
        tileSlots.set(request.key, { wrappedX: request.wrappedX, tileY: request.tileY })

        const tileOriginGlobalX = request.tileX * OSM_TILE_SIZE
        const tileOriginGlobalY = request.tileY * OSM_TILE_SIZE
        const tileScreenX = m00 * tileOriginGlobalX + m01 * tileOriginGlobalY + mTx
        const tileScreenY = m10 * tileOriginGlobalX + m11 * tileOriginGlobalY + mTy
        tileImage.style.transform = `matrix(${m00}, ${m10}, ${m01}, ${m11}, ${tileScreenX}, ${tileScreenY})`
      }
    }

    for (const [tileKey, tileImage] of tileElements.entries()) {
      if (isMotionSettling) {
        continue
      }

      if (visibleKeys.has(tileKey)) {
        continue
      }

      const lastSeenAt = tileLastSeenAt.get(tileKey) ?? 0
      if (now - lastSeenAt < OSM_TILE_EVICT_IDLE_MS) {
        continue
      }

      tileImage.remove()
      tileElements.delete(tileKey)
      tileSlots.delete(tileKey)
      tileLastSeenAt.delete(tileKey)
      if (tileRecyclePool.length < OSM_TILE_POOL_MAX) {
        tileRecyclePool.push(tileImage)
      }
    }

    previousCenterScreen = { x: centerScreen.x, y: centerScreen.y }
    previousZoomFloat = zoomFloat
    previousBaseZoom = baseZoom
  }

  renderTiles()

  return {
    dispose: () => {
      if (rafId) {
        overlayWindow.cancelAnimationFrame(rafId)
      }

      for (const tileImage of tileElements.values()) {
        tileImage.remove()
      }

      tileElements.clear()
      tileSlots.clear()
      tileLastSeenAt.clear()
      tileRecyclePool.length = 0
      overlayLayer.remove()
    }
  }
}

const ensureOsmOverlayMounted = () => {
  osmOverlayController?.dispose()
  osmOverlayController = createOsmOverlayUnderCadData()
}

const bindOsmOverlayLifecycle = () => {
  if (!ENABLE_OSM_OVERLAY || !largeFileSettings.value.enableOsmOverlay) {
    return
  }

  if (removeOsmLifecycleBinding) {
    return
  }

  const listener = () => {
    const overlayWindow = window

    // DXF loading can rebuild internal DOM asynchronously.
    overlayWindow.requestAnimationFrame(() => {
      ensureOsmOverlayMounted()
      overlayWindow.requestAnimationFrame(() => {
        ensureOsmOverlayMounted()
      })
    })
  }

  AcApDocManager.instance.events.documentActivated.addEventListener(listener)
  removeOsmLifecycleBinding = () => {
    AcApDocManager.instance.events.documentActivated.removeEventListener(listener)
    removeOsmLifecycleBinding = null
  }
}

/** Mount OSM after CAD open has finished (create fires post-open for local files). */
const mountOsmOverlayAfterLoad = () => {
  if (!ENABLE_OSM_OVERLAY || !largeFileSettings.value.enableOsmOverlay) {
    disableOsmOverlay()
    return
  }

  bindOsmOverlayLifecycle()

  const overlayWindow = window
  overlayWindow.requestAnimationFrame(() => {
    ensureOsmOverlayMounted()
    overlayWindow.requestAnimationFrame(() => {
      ensureOsmOverlayMounted()
    })
  })
}

const viewerLocalFile = ref<File | undefined>(undefined)
const viewerReady = ref(false)
const largeFileNotice = ref<string>()

const viewerRenderKey = ref(0)
const isWebGLAvailableAtStartup = canCreateAnyWebGLContext()
const viewerUseMainThreadDraw = ref(FORCE_MAIN_THREAD_DRAW)
const largeFileSettings = computed(() =>
  getLargeFileSettings(store.selectedFile, FORCE_MAIN_THREAD_DRAW)
)
const webglFallbackTriggered = ref(false)
const webglFatalError = ref(!isWebGLAvailableAtStartup)
const webglBlockedByBrowser = ref(false)
const webglTroubleshootingMessage = ref(
  isWebGLAvailableAtStartup
    ? 'Bat Hardware Acceleration trong trinh duyet, cap nhat driver GPU, sau do bam Thu lai. Neu dang dung Remote Desktop/VM, hay bat GPU acceleration cho phien lam viec.'
    : 'Moi truong hien tai dang tat WebGL (GL_VENDOR/GL_RENDERER bi Disabled), nen khong the khoi tao CAD viewer. Hay bat Hardware Acceleration, tat che do sandbox han che GPU, hoac mo lai bang trinh duyet co WebGL.'
)

const getErrorMessageText = (reason: unknown) => {
  if (!reason) {
    return ''
  }

  if (typeof reason === 'string') {
    return reason
  }

  if (reason instanceof Error) {
    return reason.message
  }

  if (typeof reason === 'object' && 'message' in reason) {
    const maybeMessage = (reason as { message?: unknown }).message
    return typeof maybeMessage === 'string' ? maybeMessage : ''
  }

  return ''
}

const matchesWebGLContextError = (reason: unknown) => {
  const message = getErrorMessageText(reason)
  return message.includes(WEBGL_CONTEXT_ERROR_MESSAGE)
}

const matchesBlockedWebGLReason = (reason: unknown) => {
  const message = getErrorMessageText(reason).toLowerCase()
  return message.includes(WEBGL_CONTEXT_BLOCKED_REASON)
}

const triggerWebglFallback = (reason?: unknown) => {
  if (matchesBlockedWebGLReason(reason)) {
    webglBlockedByBrowser.value = true
    webglFatalError.value = true
    webglTroubleshootingMessage.value =
      'Trinh duyet da chan WebGL do context bi mat lap lai (context loss and was blocked). Dong tab nay, mo lai trang, bat Hardware Acceleration va giam so tab/app dang dung GPU.'
    return
  }

  if (!webglFallbackTriggered.value && !viewerUseMainThreadDraw.value) {
    webglFallbackTriggered.value = true
    webglFatalError.value = false
    viewerUseMainThreadDraw.value = true
    viewerRenderKey.value += 1
    console.warn('[cad-viewer] WebGL context creation failed, fallback to main-thread draw mode.')
    return
  }

  if (viewerUseMainThreadDraw.value) {
    // In CPU fallback mode, some internal WebGL probes may still log errors.
    // Do not switch UI to fatal state if the viewer is already running in main thread draw mode.
    console.warn('[cad-viewer] ignore WebGL context error while main-thread draw mode is active.')
    return
  }

  webglFatalError.value = true
}

const disableOsmOverlay = () => {
  removeOsmLifecycleBinding?.()
  osmOverlayController?.dispose()
  osmOverlayController = null
}

const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
  if (!matchesWebGLContextError(event.reason)) {
    return
  }

  event.preventDefault()
  triggerWebglFallback(event.reason)
}

const retryViewerAfterWebglFailure = () => {
  if (!canCreateAnyWebGLContext()) {
    webglFatalError.value = true
    webglTroubleshootingMessage.value =
      'WebGL van dang Disabled trong phien hien tai. Can bat Hardware Acceleration/GPU cho trinh duyet roi tai lai trang.'
    return
  }

  if (webglBlockedByBrowser.value) {
    window.location.reload()
    return
  }

  webglFatalError.value = false
  viewerRenderKey.value += 1
}

const handleWindowError = (event: ErrorEvent) => {
  if (!matchesWebGLContextError(event.error ?? event.message)) {
    return
  }

  event.preventDefault()
  triggerWebglFallback(event.error ?? event.message)
}

if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', handleUnhandledRejection)
  window.addEventListener('error', handleWindowError)
}

onErrorCaptured((error) => {
  if (!matchesWebGLContextError(error)) {
    return
  }

  triggerWebglFallback(error)
  return false
})

watch(
  () => store.selectedFile,
  (file) => {
    disableOsmOverlay()
    largeFileNotice.value = undefined
    viewerReady.value = false
    viewerLocalFile.value = undefined
    clearAnnotations()
    store.tableEditor.visible = false
    store.tableEditor.mode = 'create'
    store.tableEditor.annotationId = null
    store.tableEditor.sheetTableRole = null
    store.tableCellEditor.visible = false
    store.tableCellEditor.annotationId = null
    store.tableCellEditor.sheetTableRole = null
    store.tableCellEditor.text = ''
    store.tableCellEditor.color = 'foreground'
    store.tableCellEditor.fontSize = 14
    store.textEditor.visible = false
    store.textEditor.mode = 'create'
    store.textEditor.annotationId = null
    store.textEditor.sheetRole = null
    store.textEditor.popupX = null
    store.textEditor.popupY = null
    store.drawLayer = ''
    store.activeDrawTool = null
    store.regionPanelVisible = false
    store.scalePanelVisible = false

    if (!file) {
      viewerUseMainThreadDraw.value = FORCE_MAIN_THREAD_DRAW
      return
    }

    // Prefer File → openDocument (arrayBuffer) over blob URL → openUrl fetch round-trip.
    viewerLocalFile.value = file
    viewerUseMainThreadDraw.value = FORCE_MAIN_THREAD_DRAW

    const settings = getLargeFileSettings(file, FORCE_MAIN_THREAD_DRAW)
    if (settings.isLargeFile) {
      largeFileNotice.value = `Dung lượng file (${formatFileSize(file.size)}). Đang dùng chế độ tải nhanh (worker parse + chunk lớn).`
      console.info('[cad-viewer] large file mode enabled', {
        fileName: file.name,
        fileSize: file.size,
        loadVia: 'localFile',
        settings
      })
    }
  },
  { immediate: true }
)


const LIBRARY_DXF_EXPORT_LABELS = new Set(['Export to DXF', '导出为DXF'])

const hideLibraryDxfExportMenuItems = () => {
  document.querySelectorAll('.el-dropdown-menu__item').forEach((item) => {
    const label = item.textContent?.trim() || ''
    if (!LIBRARY_DXF_EXPORT_LABELS.has(label)) {
      return
    }
    const row = item as HTMLElement
    row.hidden = true
    row.style.display = 'none'
  })
}

const bindLibraryDxfExportMenuHider = () => {
  if (removeLibraryExportMenuHider) {
    return
  }

  const onMainMenuClick = (event: Event) => {
    const target = event.target as HTMLElement | null
    if (!target?.closest('.ml-main-menu-container')) {
      return
    }
    requestAnimationFrame(hideLibraryDxfExportMenuItems)
    window.setTimeout(hideLibraryDxfExportMenuItems, 0)
    window.setTimeout(hideLibraryDxfExportMenuItems, 50)
  }

  document.addEventListener('click', onMainMenuClick, true)
  removeLibraryExportMenuHider = () => {
    document.removeEventListener('click', onMainMenuClick, true)
  }
}

bindLibraryDxfExportMenuHider()

onBeforeUnmount(() => {
  window.removeEventListener('unhandledrejection', handleUnhandledRejection)
  window.removeEventListener('error', handleWindowError)
  removeOsmLifecycleBinding?.()
  osmOverlayController?.dispose()
  osmOverlayController = null
  removeLibraryExportMenuHider?.()
  removeLibraryExportMenuHider = null
})

const registerCommands = () => {
  if (commandsRegistered) {
    return
  }

  const register = AcApDocManager.instance.commandManager
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'quit',
    'quit',
    new AcApQuitCmd()
  )
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'exit',
    'exit',
    new AcApQuitCmd()
  )
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'drawline',
    'drawline',
    new AcApDrawLineCmd()
  )
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'drawregion',
    'drawregion',
    new AcApDrawRegionCmd()
  )
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'drawpoint',
    'drawpoint',
    new AcApDrawPointCmd()
  )
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'drawcircle',
    'drawcircle',
    new AcApDrawCircleCmd()
  )
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'drawtable',
    'drawtable',
    new AcApDrawTableCmd()
  )
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'drawtext',
    'drawtext',
    new AcApDrawTextCmd()
  )
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'drawgrid',
    'drawgrid',
    new AcApDrawGridCmd()
  )
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'drawscale',
    'drawscale',
    new AcApDrawScaleCmd()
  )
  register.addCommand(
    AcEdCommandStack.SYSTEMT_COMMAND_GROUP_NAME,
    'drawsheet',
    'drawsheet',
    new AcApDrawSheetCmd()
  )

  commandsRegistered = true
}

const handleViewerCreate = async () => {
  registerCommands()
  ensureDrawLayers()
  enableLineWeightDisplay()
  bindDrawEditing()
  viewerReady.value = true
  // FontCAD awaits openDocument before emitting create, so OSM starts after load.
  mountOsmOverlayAfterLoad()
}

// Decide whether to show command line vertical toolbar at the right side,
// performance stats, coordinates in status bar, etc.
// AcApSettingManager.instance.isShowCommandLine = false
// AcApSettingManager.instance.isShowToolbar = false
AcApSettingManager.instance.isShowStats = false
// AcApSettingManager.instance.isShowCoordinate = false

const convertDialogVisible = ref(false)

// Handle file selection from upload component
const handleFileSelect = (file: File) => {
  store.selectedFile = file
}
</script>

<style scoped>
#app-root {
  height: 100vh;
  position: fixed;
}

.viewer-screen {
  width: 100vw;
  height: 100vh;
  position: relative;
}

.viewer-toolbar {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 1200;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: stretch;
  pointer-events: auto;
}

.viewer-large-file-alert {
  position: absolute;
  left: 12px;
  top: 12px;
  right: 12px;
  z-index: 1199;
  max-width: 720px;
}

.viewer-error-alert {
  position: absolute;
  left: 12px;
  top: 12px;
  right: 12px;
  z-index: 1201;
}

.viewer-error-retry {
  position: absolute;
  left: 12px;
  top: 96px;
  z-index: 1202;
}

.upload-screen {
  height: 100vh;
  width: 100vw;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  margin: 0;
  padding: 24px 20px;
  overflow: auto;
  position: absolute;
  top: 0;
  left: 0;
  z-index: 1000;
  pointer-events: auto; /* Allow clicks on upload screen */
  box-sizing: border-box;
}

.home-layout {
  width: min(1400px, 100%);
  margin: auto;
  display: grid;
  grid-template-columns: minmax(280px, 420px) minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}

.home-badge {
  margin: 0 0 12px;
  color: #ffffff;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.25);
}

.home-open :deep(.file-upload-container) {
  height: auto;
  padding: 0;
}

@media (max-width: 980px) {
  .home-layout {
    grid-template-columns: 1fr;
  }
}
</style>
