import { AcEdCommand, AcEdOpenMode, type AcApContext } from '@mlightcad/cad-simple-viewer'
import type { AcDbEntity, AcGePoint2d } from '@mlightcad/data-model'

import {
  collectEntityIds,
  createAnnotationId,
  registerAnnotation
} from './annotationRegistry'
import { recordDrawUndo } from './drawUndoStack'
import { appendEntity, buildPolyline, collectDrawPath } from './drawHelpers'
import { getActiveDrawLayer } from './drawLayers'
import { applyStrokeStyle, clampStrokeWidth, type RegionLineTypeId } from './lineTypes'
import { store } from '../store'

export type LineStyle = {
  strokeColor: string
  lineType: RegionLineTypeId | string
  strokeWidth: number
}

export const getCurrentLineStyle = (): LineStyle => ({
  strokeColor: store.lineStrokeColor,
  lineType: store.lineLineType,
  strokeWidth: clampStrokeWidth(store.lineStrokeWidth)
})

export class AcApDrawLineCmd extends AcEdCommand {
  constructor() {
    super()
    this.mode = AcEdOpenMode.Write
    this.globalName = 'DRAWLINE'
    this.localName = 'Ve duong'
  }

  async execute(context: AcApContext) {
    const style = getCurrentLineStyle()
    const path = await collectLinePoints(context, style)
    if (!path) {
      return
    }

    recordDrawUndo(() => {
      createLineAnnotation(context, path.points, path.closed, style)
    })
  }
}

export const collectLinePoints = async (
  context: AcApContext,
  style: LineStyle = getCurrentLineStyle(),
  messages?: { firstMessage: string; nextMessage: string }
) => {
  const stylePreview = (entity: AcDbEntity) => {
    applyStrokeStyle(context, entity, style.strokeColor, style.lineType, undefined, style.strokeWidth)
  }

  return collectDrawPath(context, {
    firstMessage: messages?.firstMessage ?? 'Click điểm bắt đầu của đường',
    nextMessage:
      messages?.nextMessage ?? 'Click điểm tiếp theo. Click đúp để hoàn thành [Đóng/Hoàn tác]',
    minPoints: 2,
    previewClosed: false,
    stylePreview
  })
}

export const createLineAnnotation = (
  context: AcApContext,
  points: AcGePoint2d[],
  closed: boolean,
  style: LineStyle = getCurrentLineStyle(),
  layer = getActiveDrawLayer()
) => {
  const polyline = buildPolyline(points, closed)
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  applyStrokeStyle(context, polyline, style.strokeColor, style.lineType, size / 25, style.strokeWidth)
  appendEntity(context, polyline, layer)
  registerAnnotation({
    id: createAnnotationId(),
    kind: 'line',
    entityIds: collectEntityIds([polyline]),
    closed,
    lineStrokeColor: style.strokeColor,
    lineLineType: style.lineType,
    lineStrokeWidth: style.strokeWidth,
    layer
  })
}
