import {
  AcApDocManager,
  AcEdCommand,
  AcEdOpenMode,
  AcEdPromptPointOptions,
  AcEdPromptStatus,
  type AcApContext,
  type AcEdBaseView
} from '@mlightcad/cad-simple-viewer'
import {
  AcDbHatch,
  AcDbHatchPatternType,
  AcDbMText,
  AcGePoint2d,
  AcGePolyline2d,
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
import { appendEntity, buildPolyline, colorFromHex, worldSizeFromPixels } from './drawHelpers'
import { getActiveDrawLayer } from './drawLayers'
import { applyStrokeStyle } from './lineTypes'
import { applyTableTextStyle, DEFAULT_TABLE_FONT, formatMTextContents } from './textStyles'

export const DEFAULT_SCALE_COLOR = '#382418'
const NICE_MANTISSAS = [1, 2, 2.5, 5, 10]
const TARGET_BAR_PIXELS = 160
const SCREEN_PIXELS_PER_METER = 96 / 0.0254

export type ScaleDrawOptions = {
  x: number
  y: number
  worldLength: number
  meters: number
  ratio: number
  unitLabel: string
  color: string
}

export const formatScaleRatio = (ratio: number) => {
  const rounded = Math.max(1, Math.round(ratio))
  return `1 : ${rounded.toLocaleString('vi-VN')}`
}

export const formatScaleDistance = (meters: number) => {
  if (meters >= 1000) {
    const km = meters / 1000
    const text = Number.isInteger(km) || km >= 10 ? String(Math.round(km)) : String(Number(km.toFixed(1)))
    return `${text} km`
  }
  const text =
    meters >= 1
      ? String(Math.round(meters))
      : meters >= 0.1
        ? meters.toFixed(1)
        : meters.toFixed(2)
  return `${text} m`
}

const niceNumber = (value: number) => {
  if (!(value > 0) || !Number.isFinite(value)) {
    return 1
  }
  const exponent = Math.floor(Math.log10(value))
  const base = 10 ** exponent
  const mantissa = value / base
  const nice = NICE_MANTISSAS.find((item) => item >= mantissa) ?? 10
  return Number((nice * base).toPrecision(12))
}

const inferMetersPerUnit = (point: { x: number; y: number }) => {
  if (Math.abs(point.x) <= 180 && Math.abs(point.y) <= 90) {
    return Math.max(111_320 * Math.cos((point.y * Math.PI) / 180), 1)
  }
  return 1
}

export const metersPerDrawingUnit = (point: { x: number; y: number }) => inferMetersPerUnit(point)

export const measureMapScale = (view: AcEdBaseView, at?: { x: number; y: number }): ScaleDrawOptions => {
  const origin = at ?? view.center
  const screen = view.worldToScreen(origin)
  const east = view.worldToScreen({ x: origin.x + 1, y: origin.y })
  const pixelsPerUnit = Math.max(
    Math.hypot(east.x - screen.x, east.y - screen.y),
    1e-12
  )
  const metersPerUnit = inferMetersPerUnit(origin)
  const rawMeters = (TARGET_BAR_PIXELS / pixelsPerUnit) * metersPerUnit
  const meters = niceNumber(rawMeters)
  const worldLength = meters / metersPerUnit
  const pixelsPerMeter = pixelsPerUnit / metersPerUnit
  const ratio = niceNumber(SCREEN_PIXELS_PER_METER / Math.max(pixelsPerMeter, 1e-12) / 4)

  return {
    x: origin.x,
    y: origin.y,
    worldLength,
    meters,
    ratio,
    unitLabel: formatScaleDistance(meters),
    color: DEFAULT_SCALE_COLOR
  }
}

const addScaleLine = (
  context: AcApContext,
  points: AcGePoint2d[],
  color: string,
  layer: string,
  entities: AcDbEntity[],
  strokeWidth = 2
) => {
  const line = buildPolyline(points, false)
  applyStrokeStyle(context, line, color, 'Continuous', undefined, strokeWidth)
  appendEntity(context, line, layer)
  entities.push(line)
}

const addScaleFill = (
  context: AcApContext,
  points: AcGePoint2d[],
  color: string,
  layer: string,
  entities: AcDbEntity[]
) => {
  const hatch = new AcDbHatch()
  hatch.patternName = 'SOLID'
  hatch.patternType = AcDbHatchPatternType.Predefined
  hatch.isSolidFill = true
  hatch.color = colorFromHex(color)
  hatch.add(new AcGePolyline2d(points.map((point) => ({ x: point.x, y: point.y })), true))
  appendEntity(context, hatch, layer)
  entities.push(hatch)
}

const addScaleLabel = (
  context: AcApContext,
  text: string,
  x: number,
  y: number,
  attachment: AcGiMTextAttachmentPoint,
  color: string,
  layer: string,
  entities: AcDbEntity[],
  worldHeight: number
) => {
  const mtext = new AcDbMText()
  applyTableTextStyle(context, mtext, DEFAULT_TABLE_FONT, 14, worldHeight)
  mtext.contents = formatMTextContents(text, DEFAULT_TABLE_FONT)
  mtext.width = Math.max(mtext.height * Math.max(text.length, 3) * 0.7, mtext.height * 4)
  mtext.location = { x, y, z: 0 }
  mtext.attachmentPoint = attachment
  mtext.color = colorFromHex(color)
  appendEntity(context, mtext, layer)
  entities.push(mtext)
}

export const createScaleAnnotation = (
  context: AcApContext,
  options: ScaleDrawOptions,
  layer = getActiveDrawLayer()
) => {
  const { x, y, worldLength, color } = options
  const barHeight = Math.max(worldSizeFromPixels(context.view, 8), worldLength * 0.06)
  const tick = Math.max(worldSizeFromPixels(context.view, 4), barHeight * 0.7)
  const labelHeight = Math.max(worldSizeFromPixels(context.view, 12), barHeight * 1.2)
  const entities: AcDbEntity[] = []
  const segments = 4
  const step = worldLength / segments

  addScaleLine(
    context,
    [new AcGePoint2d(x, y), new AcGePoint2d(x + worldLength, y)],
    color,
    layer,
    entities
  )
  addScaleLine(
    context,
    [new AcGePoint2d(x, y + barHeight), new AcGePoint2d(x + worldLength, y + barHeight)],
    color,
    layer,
    entities
  )

  for (let index = 0; index <= segments; index += 1) {
    const px = x + step * index
    addScaleLine(
      context,
      [new AcGePoint2d(px, y), new AcGePoint2d(px, y + barHeight + tick * 0.15)],
      color,
      layer,
      entities
    )
    if (index < segments && index % 2 === 0) {
      addScaleFill(
        context,
        [
          new AcGePoint2d(px, y),
          new AcGePoint2d(px + step, y),
          new AcGePoint2d(px + step, y + barHeight),
          new AcGePoint2d(px, y + barHeight)
        ],
        color,
        layer,
        entities
      )
    }
  }

  const midMeters = options.meters / 2
  addScaleLabel(
    context,
    '0',
    x,
    y - labelHeight * 0.25,
    AcGiMTextAttachmentPoint.TopCenter,
    color,
    layer,
    entities,
    labelHeight
  )
  addScaleLabel(
    context,
    formatScaleDistance(midMeters),
    x + worldLength / 2,
    y - labelHeight * 0.25,
    AcGiMTextAttachmentPoint.TopCenter,
    color,
    layer,
    entities,
    labelHeight
  )
  addScaleLabel(
    context,
    options.unitLabel,
    x + worldLength,
    y - labelHeight * 0.25,
    AcGiMTextAttachmentPoint.TopCenter,
    color,
    layer,
    entities,
    labelHeight
  )
  addScaleLabel(
    context,
    formatScaleRatio(options.ratio),
    x + worldLength / 2,
    y + barHeight + labelHeight * 0.35,
    AcGiMTextAttachmentPoint.BottomCenter,
    color,
    layer,
    entities,
    labelHeight
  )

  const pad = labelHeight * 2.2
  registerAnnotation({
    id: createAnnotationId(),
    kind: 'scale',
    entityIds: collectEntityIds(entities),
    bounds: {
      minX: x - pad,
      minY: y - pad,
      maxX: x + worldLength + pad,
      maxY: y + barHeight + pad
    },
    scale: options,
    layer
  })
}

export class AcApDrawScaleCmd extends AcEdCommand {
  constructor() {
    super()
    this.mode = AcEdOpenMode.Write
    this.globalName = 'DRAWSCALE'
    this.localName = 'Thuoc ty le'
  }

  async execute(context: AcApContext) {
    const preview = measureMapScale(context.view)
    ElMessage.info(
      `Tỷ lệ đang xem ${formatScaleRatio(preview.ratio)}. Click để đặt thước ${preview.unitLabel}.`
    )

    const editor = AcApDocManager.instance.editor
    const pointPrompt = new AcEdPromptPointOptions('Click vị trí đặt thước tỷ lệ')
    const pointResult = await editor.getPoint(pointPrompt)
    if (pointResult.status !== AcEdPromptStatus.OK || !pointResult.value) {
      return
    }

    const scale = measureMapScale(context.view, {
      x: pointResult.value.x,
      y: pointResult.value.y
    })
    recordDrawUndo(() => {
      createScaleAnnotation(context, scale)
    })
    ElMessage.success(`Đã đặt thước tỷ lệ ${scale.unitLabel} (${formatScaleRatio(scale.ratio)}).`)
  }
}
