import {
  AcApDocManager,
  AcEdCommand,
  AcEdOpenMode,
  AcEdPromptPointOptions,
  AcEdPromptStatus,
  type AcApContext
} from '@mlightcad/cad-simple-viewer'

import { createAnnotationId, registerAnnotation } from './annotationRegistry'
import { appendDisk, type CircleStyle } from './circleCmd'
import { recordDrawUndo } from './drawUndoStack'
import { circleWorldBounds, worldSizeFromPixels } from './drawHelpers'
import { getActiveDrawLayer } from './drawLayers'
import { store, type RegionFillMode } from '../store'

export const POINT_SIZES = [8, 12, 16, 24, 32, 40] as const
export const DEFAULT_POINT_SIZE = 16

export const clampPointSize = (value: number) => {
  const rounded = Math.round(Number(value) || DEFAULT_POINT_SIZE)
  if (POINT_SIZES.includes(rounded as (typeof POINT_SIZES)[number])) {
    return rounded
  }
  return POINT_SIZES.reduce((closest, item) =>
    Math.abs(item - rounded) < Math.abs(closest - rounded) ? item : closest
  )
}

export type PointStyle = {
  fillMode: RegionFillMode
  fillColor: string
  strokeColor: string
  size: number
}

export const getCurrentPointStyle = (): PointStyle => ({
  fillMode: store.pointFillMode,
  fillColor: store.pointFillColor,
  strokeColor: store.pointStrokeColor,
  size: clampPointSize(store.pointSize)
})

const diskStyleFromPoint = (style: PointStyle): CircleStyle => ({
  fillMode: style.fillMode,
  fillColor: style.fillColor,
  strokeColor: style.strokeColor,
  strokeWidth: 2
})

export const pointRadiusFromSize = (context: AcApContext, sizePx: number) =>
  Math.max(worldSizeFromPixels(context.view, clampPointSize(sizePx)) / 2, 1e-4)

export class AcApDrawPointCmd extends AcEdCommand {
  constructor() {
    super()
    this.mode = AcEdOpenMode.Write
    this.globalName = 'DRAWPOINT'
    this.localName = 'Ve diem'
  }

  async execute(context: AcApContext) {
    const style = getCurrentPointStyle()
    const editor = AcApDocManager.instance.editor
    while (true) {
      const prompt = new AcEdPromptPointOptions('Click vị trí đặt điểm. Esc để kết thúc')
      const result = await editor.getPoint(prompt)
      if (result.status !== AcEdPromptStatus.OK || !result.value) {
        return
      }
      const center = {
        x: result.value.x,
        y: result.value.y,
        z: result.value.z ?? 0
      }
      recordDrawUndo(() => {
        createPointAnnotation(context, center, style)
      })
    }
  }
}

export const createPointAnnotation = (
  context: AcApContext,
  center: { x: number; y: number; z?: number },
  style: PointStyle = getCurrentPointStyle(),
  layer = getActiveDrawLayer(),
  radius = pointRadiusFromSize(context, style.size)
) => {
  const entityIds = appendDisk(context, center, radius, diskStyleFromPoint(style), layer)
  registerAnnotation({
    id: createAnnotationId(),
    kind: 'point',
    entityIds,
    bounds: circleWorldBounds(center, radius),
    point: {
      x: center.x,
      y: center.y,
      z: center.z,
      size: style.size,
      radius,
      fillMode: style.fillMode,
      fillColor: style.fillColor,
      strokeColor: style.strokeColor
    },
    layer
  })
}
