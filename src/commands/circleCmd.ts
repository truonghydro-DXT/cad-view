import { AcEdCommand, AcEdOpenMode, type AcApContext } from '@mlightcad/cad-simple-viewer'
import {
  AcDbCircle,
  AcDbHatch,
  AcDbHatchPatternType,
  AcGePoint3d,
  AcGePolyline2d
} from '@mlightcad/data-model'

import {
  createAnnotationId,
  registerAnnotation
} from './annotationRegistry'
import {
  appendEntity,
  circlePolylinePoints,
  circleWorldBounds,
  collectCircle,
  colorFromHex
} from './drawHelpers'
import { recordDrawUndo } from './drawUndoStack'
import { getActiveDrawLayer } from './drawLayers'
import { applyStrokeStyle, clampStrokeWidth } from './lineTypes'
import { store, type RegionFillMode } from '../store'

export type CircleStyle = {
  fillMode: RegionFillMode
  fillColor: string
  strokeColor: string
  strokeWidth: number
}

export const getCurrentCircleStyle = (): CircleStyle => ({
  fillMode: store.circleFillMode,
  fillColor: store.circleFillColor,
  strokeColor: store.circleStrokeColor,
  strokeWidth: clampStrokeWidth(store.circleStrokeWidth)
})

export class AcApDrawCircleCmd extends AcEdCommand {
  constructor() {
    super()
    this.mode = AcEdOpenMode.Write
    this.globalName = 'DRAWCIRCLE'
    this.localName = 'Ve hinh tron'
  }

  async execute(context: AcApContext) {
    const style = getCurrentCircleStyle()
    while (true) {
      const result = await collectCircleRadius(context, style)
      if (!result) {
        return
      }
      recordDrawUndo(() => {
        createCircleAnnotation(context, result.center, result.radius, style)
      })
    }
  }
}

export const collectCircleRadius = async (
  context: AcApContext,
  style: CircleStyle = getCurrentCircleStyle(),
  messages?: { firstMessage: string; nextMessage: string }
) =>
  collectCircle(context, {
    firstMessage: messages?.firstMessage ?? 'Click tâm hình tròn',
    nextMessage: messages?.nextMessage ?? 'Click điểm trên vòng tròn để lấy bán kính',
    stylePreview: (entity) => {
      applyStrokeStyle(context, entity, style.strokeColor, 'Continuous', undefined, style.strokeWidth)
    }
  })

export const appendDisk = (
  context: AcApContext,
  center: { x: number; y: number; z?: number },
  radius: number,
  style: CircleStyle,
  layer: string
) => {
  const entityIds: string[] = []
  if (style.fillMode === 'fill') {
    const hatch = new AcDbHatch()
    hatch.patternName = 'SOLID'
    hatch.patternType = AcDbHatchPatternType.Predefined
    hatch.isSolidFill = true
    hatch.color = colorFromHex(style.fillColor)
    hatch.add(
      new AcGePolyline2d(
        circlePolylinePoints(center, radius).map((point) => ({ x: point.x, y: point.y })),
        true
      )
    )
    appendEntity(context, hatch, layer)
    if (hatch.objectId) {
      entityIds.push(hatch.objectId)
    }
  }

  const circle = new AcDbCircle(new AcGePoint3d(center.x, center.y, center.z ?? 0), radius)
  applyStrokeStyle(context, circle, style.strokeColor, 'Continuous', undefined, style.strokeWidth)
  appendEntity(context, circle, layer)
  if (circle.objectId) {
    entityIds.push(circle.objectId)
  }

  return entityIds
}

export const createCircleAnnotation = (
  context: AcApContext,
  center: { x: number; y: number; z?: number },
  radius: number,
  style: CircleStyle = getCurrentCircleStyle(),
  layer = getActiveDrawLayer()
) => {
  const entityIds = appendDisk(context, center, radius, style, layer)
  registerAnnotation({
    id: createAnnotationId(),
    kind: 'circle',
    entityIds,
    bounds: circleWorldBounds(center, radius),
    circle: {
      x: center.x,
      y: center.y,
      z: center.z,
      radius,
      fillMode: style.fillMode,
      fillColor: style.fillColor,
      strokeColor: style.strokeColor,
      strokeWidth: style.strokeWidth
    },
    layer
  })
}
