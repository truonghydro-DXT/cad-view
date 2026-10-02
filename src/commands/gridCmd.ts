import { AcEdCommand, AcEdOpenMode, type AcApContext } from '@mlightcad/cad-simple-viewer'
import {
  AcDbMText,
  AcGePoint2d,
  AcGiMTextAttachmentPoint,
  type AcDbEntity
} from '@mlightcad/data-model'
import { ElMessage } from 'element-plus'

import {
  collectEntityIds,
  createAnnotationId,
  registerAnnotation
} from './annotationRegistry'
import { recordDrawUndo } from './drawUndoStack'
import {
  appendEntity,
  buildPolyline,
  collectRectangle,
  colorFromHex,
  worldSizeFromPixels
} from './drawHelpers'
import { getActiveDrawLayer } from './drawLayers'
import { applyStrokeStyle, clampStrokeWidth, type RegionLineTypeId } from './lineTypes'
import { applyTableTextStyle, DEFAULT_TABLE_FONT, formatMTextContents } from './textStyles'
import { store } from '../store'

export const DEFAULT_GRID_COLOR = '#382418'
export const DEFAULT_GRID_FONT_SIZE = 12
export const MAX_GRID_LINES = 30

export const GRID_SPACING_PRESETS = [
  { id: 0, label: 'Tự động' },
  { id: 50, label: '50' },
  { id: 100, label: '100' },
  { id: 200, label: '200' },
  { id: 500, label: '500' },
  { id: 1000, label: '1 000' },
  { id: 2000, label: '2 000' },
  { id: 5000, label: '5 000' }
] as const

export type GridDrawOptions = {
  spacing: number
  showLabels: boolean
  strokeColor: string
  lineType: RegionLineTypeId | string
  strokeWidth: number
  font: string
  fontSize: number
}

export const normalizeGridOptions = (options: Partial<GridDrawOptions> = {}): GridDrawOptions => ({
  spacing: Number.isFinite(options.spacing) ? Math.max(0, Number(options.spacing)) : 0,
  showLabels: options.showLabels !== false,
  strokeColor: options.strokeColor || store.gridStrokeColor || DEFAULT_GRID_COLOR,
  lineType: options.lineType || store.gridLineType || 'Continuous',
  strokeWidth: clampStrokeWidth(options.strokeWidth ?? store.gridStrokeWidth),
  font: options.font || DEFAULT_TABLE_FONT,
  fontSize: Math.max(8, Math.min(48, Math.round(options.fontSize || DEFAULT_GRID_FONT_SIZE)))
})

export const getCurrentGridStyle = (): GridDrawOptions =>
  normalizeGridOptions({
    spacing: store.gridSpacing,
    showLabels: store.gridShowLabels,
    strokeColor: store.gridStrokeColor,
    lineType: store.gridLineType,
    strokeWidth: store.gridStrokeWidth
  })

const NICE_MANTISSAS = [1, 2, 2.5, 5, 10]

export const niceGridSpacing = (span: number, targetLines = 8) => {
  if (!(span > 0) || !Number.isFinite(span)) {
    return 1
  }

  const raw = span / Math.max(targetLines, 2)
  const exponent = Math.floor(Math.log10(raw))
  const base = 10 ** exponent
  const mantissa = raw / base
  const nice = NICE_MANTISSAS.find((item) => item >= mantissa) ?? 10
  return Number((nice * base).toPrecision(12))
}

export const formatGridCoordinate = (value: number, spacing: number) => {
  const absSpacing = Math.abs(spacing)
  const decimals =
    absSpacing >= 1
      ? 0
      : absSpacing >= 0.1
        ? 1
        : absSpacing >= 0.01
          ? 2
          : absSpacing >= 0.001
            ? 3
            : 6
  const rounded = Number(value.toFixed(decimals))
  return decimals === 0
    ? String(Math.round(rounded))
    : String(rounded)
}

const collectAxisTicks = (min: number, max: number, spacing: number) => {
  const ticks: number[] = []
  if (!(spacing > 0) || max <= min) {
    return ticks
  }

  const start = Math.ceil(min / spacing - 1e-9) * spacing
  for (let value = start, guard = 0; value <= max + spacing * 1e-9 && guard < MAX_GRID_LINES + 2; value += spacing, guard += 1) {
    const snapped = Number((Math.round(value / spacing) * spacing).toPrecision(12))
    if (snapped >= min - spacing * 1e-9 && snapped <= max + spacing * 1e-9) {
      ticks.push(snapped)
    }
  }
  return ticks
}

const resolveSpacing = (minX: number, minY: number, maxX: number, maxY: number, requested: number) => {
  const span = Math.max(maxX - minX, maxY - minY)
  let spacing = requested > 0 ? requested : niceGridSpacing(span)
  let xs = collectAxisTicks(minX, maxX, spacing)
  let ys = collectAxisTicks(minY, maxY, spacing)

  for (let step = 0; step < 8 && (xs.length > MAX_GRID_LINES || ys.length > MAX_GRID_LINES); step += 1) {
    const next = niceGridSpacing(span, Math.max(4, Math.floor(span / Math.max(spacing, 1e-9) / 2)))
    spacing = next > spacing ? next : spacing * 2
    xs = collectAxisTicks(minX, maxX, spacing)
    ys = collectAxisTicks(minY, maxY, spacing)
    if (spacing >= span) {
      break
    }
  }

  return { spacing, xs, ys, adjusted: requested > 0 && Math.abs(spacing - requested) > requested * 1e-6 }
}

export const gridTicksForFrame = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  requested: number
) => resolveSpacing(minX, minY, maxX, maxY, requested)

export class AcApDrawGridCmd extends AcEdCommand {
  constructor() {
    super()
    this.mode = AcEdOpenMode.Write
    this.globalName = 'DRAWGRID'
    this.localName = 'Tao luoi'
  }

  async execute(context: AcApContext) {
    const style = getCurrentGridStyle()
    const frame = await collectGridFrame(context, style)
    if (!frame) {
      return
    }

    recordDrawUndo(() => {
      createGridAnnotation(context, frame.minX, frame.minY, frame.maxX, frame.maxY, style)
    })
  }
}

export const collectGridFrame = async (
  context: AcApContext,
  style?: GridDrawOptions,
  messages?: { firstMessage: string; nextMessage: string }
) => {
  const previewStyle = style ?? getCurrentGridStyle()
  const stylePreview = (entity: AcDbEntity) => {
    applyStrokeStyle(
      context,
      entity,
      previewStyle.strokeColor,
      previewStyle.lineType,
      undefined,
      previewStyle.strokeWidth
    )
  }

  const points = await collectRectangle(context, {
    firstMessage: messages?.firstMessage ?? 'Click góc thứ nhất của khung lưới',
    nextMessage: messages?.nextMessage ?? 'Click góc đối diện để tạo lưới theo tọa độ đang xem',
    stylePreview
  })

  if (!points || points.length < 4) {
    return null
  }

  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys)
  }
}

const addStyledPolyline = (
  context: AcApContext,
  points: AcGePoint2d[],
  closed: boolean,
  style: GridDrawOptions,
  layer: string,
  entities: AcDbEntity[]
) => {
  const polyline = buildPolyline(points, closed)
  const size = Math.max(
    Math.abs(points[0].x - points[points.length - 1].x),
    Math.abs(points[0].y - points[points.length - 1].y)
  )
  applyStrokeStyle(context, polyline, style.strokeColor, style.lineType, Math.max(size / 25, 1), style.strokeWidth)
  appendEntity(context, polyline, layer)
  entities.push(polyline)
}

const LABEL_CHAR_WIDTH = 0.64

const gridLabelWorldHeight = (
  context: AcApContext,
  spacing: number,
  labels: string[]
) => {
  const longest = labels.reduce((max, text) => Math.max(max, text.length), 4)
  const fitInSpacing = (spacing * 0.74) / (longest * LABEL_CHAR_WIDTH)
  const worldPerPixel = worldSizeFromPixels(context.view, 1)
  const spacingPx = spacing / Math.max(worldPerPixel, 1e-9)
  const preferredPx = Math.max(3, Math.min(9, spacingPx * 0.26))
  const fromZoom = worldPerPixel * preferredPx
  return Math.max(Math.min(fitInSpacing, fromZoom), spacing * 0.015)
}

const addGridLabel = (
  context: AcApContext,
  text: string,
  x: number,
  y: number,
  attachment: AcGiMTextAttachmentPoint,
  style: GridDrawOptions,
  layer: string,
  entities: AcDbEntity[],
  worldHeight: number,
  rotationDeg = 0
) => {
  const rotation = (rotationDeg * Math.PI) / 180
  const mtext = new AcDbMText()
  applyTableTextStyle(context, mtext, style.font, style.fontSize, worldHeight)
  mtext.contents = formatMTextContents(text, style.font)
  mtext.width = Math.max(mtext.height * Math.max(text.length, 3) * LABEL_CHAR_WIDTH, mtext.height * 3)
  mtext.location = { x, y, z: 0 }
  mtext.rotation = rotation
  mtext.direction = { x: Math.cos(rotation), y: Math.sin(rotation), z: 0 }
  mtext.attachmentPoint = attachment
  mtext.color = colorFromHex(style.strokeColor)
  appendEntity(context, mtext, layer)
  entities.push(mtext)
}

export const createGridAnnotation = (
  context: AcApContext,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  options: Partial<GridDrawOptions> = getCurrentGridStyle(),
  layer = getActiveDrawLayer()
) => {
  const style = normalizeGridOptions(options)
  const resolved = resolveSpacing(minX, minY, maxX, maxY, style.spacing)
  if (resolved.adjusted) {
    ElMessage.info(`Khoảng cách quá nhỏ cho khung này, đã dùng ${formatGridCoordinate(resolved.spacing, resolved.spacing)}.`)
  }

  const entities: AcDbEntity[] = []
  addStyledPolyline(
    context,
    [
      new AcGePoint2d(minX, minY),
      new AcGePoint2d(maxX, minY),
      new AcGePoint2d(maxX, maxY),
      new AcGePoint2d(minX, maxY)
    ],
    true,
    style,
    layer,
    entities
  )

  const nearEdge = (value: number, edge: number) => Math.abs(value - edge) <= resolved.spacing * 1e-6

  for (const x of resolved.xs) {
    if (nearEdge(x, minX) || nearEdge(x, maxX)) {
      continue
    }
    addStyledPolyline(
      context,
      [new AcGePoint2d(x, minY), new AcGePoint2d(x, maxY)],
      false,
      style,
      layer,
      entities
    )
  }

  for (const y of resolved.ys) {
    if (nearEdge(y, minY) || nearEdge(y, maxY)) {
      continue
    }
    addStyledPolyline(
      context,
      [new AcGePoint2d(minX, y), new AcGePoint2d(maxX, y)],
      false,
      style,
      layer,
      entities
    )
  }

  if (style.showLabels) {
    const xLabels = resolved.xs.map((value) => formatGridCoordinate(value, resolved.spacing))
    const yLabels = resolved.ys.map((value) => formatGridCoordinate(value, resolved.spacing))
    const worldHeight = gridLabelWorldHeight(context, resolved.spacing, [...xLabels, ...yLabels])
    const pad = Math.min(
      worldSizeFromPixels(context.view, 6),
      Math.max(worldHeight * 0.45, resolved.spacing * 0.04)
    )
    for (let index = 0; index < resolved.xs.length; index += 1) {
      addGridLabel(
        context,
        xLabels[index],
        resolved.xs[index],
        minY - pad,
        AcGiMTextAttachmentPoint.TopCenter,
        style,
        layer,
        entities,
        worldHeight
      )
    }
    for (let index = 0; index < resolved.ys.length; index += 1) {
      addGridLabel(
        context,
        yLabels[index],
        minX - pad,
        resolved.ys[index],
        AcGiMTextAttachmentPoint.MiddleCenter,
        style,
        layer,
        entities,
        worldHeight,
        90
      )
    }
  }

  const labelPad = style.showLabels
    ? Math.min(worldSizeFromPixels(context.view, 20), resolved.spacing * 0.35)
    : 0
  registerAnnotation({
    id: createAnnotationId(),
    kind: 'grid',
    entityIds: collectEntityIds(entities),
    bounds: {
      minX: minX - labelPad,
      minY: minY - labelPad,
      maxX,
      maxY
    },
    grid: style,
    gridFrame: { minX, minY, maxX, maxY },
    layer
  })
}
