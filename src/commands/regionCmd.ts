import { AcEdCommand, AcEdOpenMode, type AcApContext } from '@mlightcad/cad-simple-viewer'
import {
  type AcDbEntity,
  AcDbHatch,
  AcDbHatchPatternType,
  type AcGePoint2d,
  AcGePolyline2d
} from '@mlightcad/data-model'

import { createAnnotationId, registerAnnotation } from './annotationRegistry'
import { recordDrawUndo } from './drawUndoStack'
import {
  appendEntity,
  buildPolyline,
  collectDrawPath,
  collectRectangle,
  colorFromHex
} from './drawHelpers'
import { getActiveDrawLayer } from './drawLayers'
import { applyStrokeStyle, clampStrokeWidth, type RegionLineTypeId } from './lineTypes'
import { store, type RegionDrawMode, type RegionFillMode } from '../store'

export type RegionStyle = {
  mode: RegionDrawMode
  fillMode: RegionFillMode
  fillColor: string
  strokeColor: string
  lineType: RegionLineTypeId | string
  strokeWidth: number
}

export const getCurrentRegionStyle = (): RegionStyle => ({
  mode: store.regionMode,
  fillMode: store.regionFillMode,
  fillColor: store.regionFillColor,
  strokeColor: store.regionStrokeColor,
  lineType: store.regionLineType,
  strokeWidth: clampStrokeWidth(store.regionStrokeWidth)
})

export class AcApDrawRegionCmd extends AcEdCommand {
  constructor() {
    super()
    this.mode = AcEdOpenMode.Write
    this.globalName = 'DRAWREGION'
    this.localName = 'Ve vung'
  }

  async execute(context: AcApContext) {
    const style = getCurrentRegionStyle()
    const points = await collectRegionPoints(context, style.mode, style)
    if (!points) {
      return
    }

    recordDrawUndo(() => {
      createRegionAnnotation(context, points, style)
    })
  }
}

export const collectRegionPoints = async (
  context: AcApContext,
  mode: RegionDrawMode,
  style: Pick<RegionStyle, 'strokeColor' | 'lineType' | 'strokeWidth'> = getCurrentRegionStyle()
) => {
  const stylePreview = (entity: AcDbEntity) => {
    applyStrokeStyle(context, entity, style.strokeColor, style.lineType, undefined, style.strokeWidth)
  }

  if (mode === 'rectangle') {
    return collectRectangle(context, {
      firstMessage: 'Click góc thứ nhất của hình chữ nhật',
      nextMessage: 'Click góc đối diện để khép vùng',
      stylePreview
    })
  }

  const path = await collectDrawPath(context, {
    firstMessage: 'Click đỉnh đầu tiên của đa giác',
    nextMessage: 'Click đỉnh tiếp theo. Click đúp để khép vùng [Đóng/Hoàn tác]',
    minPoints: 3,
    previewClosed: true,
    stylePreview
  })

  return path?.points ?? null
}

export const createRegionAnnotation = (
  context: AcApContext,
  points: AcGePoint2d[],
  style: RegionStyle = getCurrentRegionStyle(),
  layer = getActiveDrawLayer()
) => {
  const entityIds = []

  if (style.fillMode === 'fill') {
    const hatch = new AcDbHatch()
    hatch.patternName = 'SOLID'
    hatch.patternType = AcDbHatchPatternType.Predefined
    hatch.isSolidFill = true
    hatch.color = colorFromHex(style.fillColor)
    hatch.add(new AcGePolyline2d(points.map((point) => ({ x: point.x, y: point.y })), true))
    appendEntity(context, hatch, layer)
    if (hatch.objectId) {
      entityIds.push(hatch.objectId)
    }
  }

  const border = buildPolyline(points, true)
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  applyStrokeStyle(context, border, style.strokeColor, style.lineType, size / 25, style.strokeWidth)
  appendEntity(context, border, layer)
  if (border.objectId) {
    entityIds.push(border.objectId)
  }

  registerAnnotation({
    id: createAnnotationId(),
    kind: 'region',
    entityIds,
    regionMode: style.mode,
    regionFillMode: style.fillMode,
    regionFillColor: style.fillColor,
    regionStrokeColor: style.strokeColor,
    regionLineType: style.lineType,
    regionStrokeWidth: style.strokeWidth,
    layer
  })
}
