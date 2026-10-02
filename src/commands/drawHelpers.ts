import type { AcApContext, AcEdBaseView } from '@mlightcad/cad-simple-viewer'
import {
  AcApDocManager,
  AcEdPreviewJig,
  AcEdPromptPointOptions,
  AcEdPromptStatus
} from '@mlightcad/cad-simple-viewer'
import {
  AcCmColor,
  AcDbCircle,
  AcDbEntity,
  AcDbPolyline,
  AcGePoint2d,
  AcGePoint3d,
  type AcGePoint3dLike
} from '@mlightcad/data-model'

export const appendEntity = (context: AcApContext, entity: AcDbEntity, layerName?: string) => {
  if (layerName) {
    entity.layer = layerName
  }
  context.doc.database.tables.blockTable.modelSpace.appendEntity(entity)
}

export const worldSizeFromPixels = (view: AcEdBaseView, pixels: number) => {
  const p0 = view.screenToWorld({ x: 0, y: 0 })
  const p1 = view.screenToWorld({ x: 0, y: pixels })
  return Math.max(Math.abs(p1.y - p0.y), 1e-4)
}

export const pixelsFromWorldSize = (view: AcEdBaseView, worldSize: number) => {
  const unit = worldSizeFromPixels(view, 1)
  if (!Number.isFinite(worldSize) || unit <= 0) {
    return 20
  }
  return Math.max(8, Math.min(200, Math.round(worldSize / unit)))
}

export const hexFromEntityColor = (entity: {
  color?: { RGB?: number; red?: number; green?: number; blue?: number }
}) => {
  const color = entity.color
  if (!color) {
    return ''
  }
  if (typeof color.RGB === 'number' && color.RGB > 0) {
    const rgb = color.RGB
    return `#${[
      (rgb >> 16) & 255,
      (rgb >> 8) & 255,
      rgb & 255
    ]
      .map((item) => item.toString(16).padStart(2, '0'))
      .join('')}`
  }
  if (Number.isFinite(color.red) && Number.isFinite(color.green) && Number.isFinite(color.blue)) {
    return `#${[color.red, color.green, color.blue]
      .map((item) => Math.max(0, Math.min(255, Number(item))).toString(16).padStart(2, '0'))
      .join('')}`
  }
  return ''
}

export const rgbColor = (r: number, g: number, b: number) => {
  const color = new AcCmColor()
  color.setRGB(r, g, b)
  return color
}

/** Nâu đen dùng chung cho bảng, đường, vùng và chữ. */
export const DRAW_COLOR = () => rgbColor(56, 36, 24)
export const FOREGROUND_COLOR = 'foreground'

export const foregroundColor = () => new AcCmColor().setForeground()

export const colorFromHex = (hex: string) => {
  const normalized = hex.replace('#', '').trim()
  const value = normalized.length === 3
    ? normalized.split('').map((item) => item + item).join('')
    : normalized
  const parsed = Number.parseInt(value, 16)
  if (!Number.isFinite(parsed) || value.length !== 6) {
    return DRAW_COLOR()
  }

  return rgbColor((parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255)
}

export const colorFromSpec = (spec: string) => {
  if (spec.trim().toLowerCase() === FOREGROUND_COLOR) {
    return foregroundColor()
  }
  return colorFromHex(spec)
}

export const toPoint2d = (point: AcGePoint3dLike) => new AcGePoint2d(point.x, point.y)

export const buildPolyline = (points: AcGePoint2d[], closed: boolean) => {
  const polyline = new AcDbPolyline()
  points.forEach((point, index) => polyline.addVertexAt(index, point))
  polyline.closed = closed
  return polyline
}

export const circlePolylinePoints = (
  center: { x: number; y: number },
  radius: number,
  segments = 64
) => {
  const count = Math.max(16, Math.round(segments))
  const points: AcGePoint2d[] = []
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2
    points.push(new AcGePoint2d(center.x + Math.cos(angle) * radius, center.y + Math.sin(angle) * radius))
  }
  return points
}

export const circleWorldBounds = (center: { x: number; y: number }, radius: number) => ({
  minX: center.x - radius,
  minY: center.y - radius,
  maxX: center.x + radius,
  maxY: center.y + radius
})

export class DrawCircleJig extends AcEdPreviewJig<AcGePoint3dLike> {
  private readonly circle: AcDbCircle
  private readonly center: AcGePoint2d

  constructor(view: AcEdBaseView, center: AcGePoint2d) {
    super(view)
    this.center = center
    this.circle = new AcDbCircle(new AcGePoint3d(center.x, center.y, 0), 1e-4)
  }

  get entity() {
    return this.circle
  }

  update(point: AcGePoint3dLike) {
    this.circle.radius = Math.max(
      Math.hypot(point.x - this.center.x, point.y - this.center.y),
      1e-6
    )
  }
}

export const collectCircle = async (
  context: AcApContext,
  options: {
    firstMessage: string
    nextMessage: string
    stylePreview?: (entity: AcDbCircle) => void
  }
) => {
  const editor = AcApDocManager.instance.editor
  const firstPrompt = new AcEdPromptPointOptions(options.firstMessage)
  const firstResult = await editor.getPoint(firstPrompt)
  if (firstResult.status !== AcEdPromptStatus.OK || !firstResult.value) {
    return null
  }

  const center = toPoint2d(firstResult.value)
  const secondPrompt = new AcEdPromptPointOptions(options.nextMessage)
  secondPrompt.useBasePoint = true
  secondPrompt.basePoint = new AcGePoint3d(center)
  const circleJig = new DrawCircleJig(context.view, center)
  options.stylePreview?.(circleJig.entity)
  secondPrompt.jig = circleJig

  const secondResult = await editor.getPoint(secondPrompt)
  if (secondResult.status !== AcEdPromptStatus.OK || !secondResult.value) {
    return null
  }

  const radius = Math.hypot(secondResult.value.x - center.x, secondResult.value.y - center.y)
  if (radius < 1e-6) {
    return null
  }

  return {
    center: { x: center.x, y: center.y, z: firstResult.value.z ?? 0 },
    radius
  }
}

export class DrawRectJig extends AcEdPreviewJig<AcGePoint3dLike> {
  private readonly polyline = new AcDbPolyline()
  private readonly firstPoint: AcGePoint2d

  constructor(view: AcEdBaseView, firstPoint: AcGePoint2d) {
    super(view)
    this.firstPoint = firstPoint
  }

  get entity() {
    return this.polyline
  }

  update(point: AcGePoint3dLike) {
    this.polyline.reset(false)
    this.polyline.addVertexAt(0, this.firstPoint)
    this.polyline.addVertexAt(1, new AcGePoint2d(point.x, this.firstPoint.y))
    this.polyline.addVertexAt(2, toPoint2d(point))
    this.polyline.addVertexAt(3, new AcGePoint2d(this.firstPoint.x, point.y))
    this.polyline.closed = true
  }
}

export const rectPointsFromCorners = (first: AcGePoint2d, second: AcGePoint3dLike) => {
  const minX = Math.min(first.x, second.x)
  const maxX = Math.max(first.x, second.x)
  const minY = Math.min(first.y, second.y)
  const maxY = Math.max(first.y, second.y)
  if (maxX - minX < 1e-6 || maxY - minY < 1e-6) {
    return null
  }

  return [
    new AcGePoint2d(minX, minY),
    new AcGePoint2d(maxX, minY),
    new AcGePoint2d(maxX, maxY),
    new AcGePoint2d(minX, maxY)
  ]
}

export const collectRectangle = async (
  context: AcApContext,
  options: {
    firstMessage: string
    nextMessage: string
    stylePreview?: (entity: AcDbPolyline) => void
  }
) => {
  const editor = AcApDocManager.instance.editor
  const firstPrompt = new AcEdPromptPointOptions(options.firstMessage)
  const firstResult = await editor.getPoint(firstPrompt)
  if (firstResult.status !== AcEdPromptStatus.OK || !firstResult.value) {
    return null
  }

  const firstPoint = toPoint2d(firstResult.value)
  const secondPrompt = new AcEdPromptPointOptions(options.nextMessage)
  secondPrompt.useBasePoint = true
  secondPrompt.basePoint = new AcGePoint3d(firstPoint)
  const rectJig = new DrawRectJig(context.view, firstPoint)
  options.stylePreview?.(rectJig.entity)
  secondPrompt.jig = rectJig

  const secondResult = await editor.getPoint(secondPrompt)
  if (secondResult.status !== AcEdPromptStatus.OK || !secondResult.value) {
    return null
  }

  return rectPointsFromCorners(firstPoint, secondResult.value)
}

export class DrawPathJig extends AcEdPreviewJig<AcGePoint3dLike> {
  private readonly polyline = new AcDbPolyline()
  private readonly points: AcGePoint2d[]
  private readonly previewClosed: boolean

  constructor(view: AcEdBaseView, points: AcGePoint2d[], previewClosed = false) {
    super(view)
    this.points = points
    this.previewClosed = previewClosed
  }

  get entity() {
    return this.polyline
  }

  update(point: AcGePoint3dLike) {
    this.polyline.reset(false)
    this.points.forEach((item, index) => this.polyline.addVertexAt(index, item))
    this.polyline.addVertexAt(this.points.length, toPoint2d(point))
    this.polyline.closed = this.previewClosed && this.points.length >= 2
  }
}

const DOUBLE_CLICK_MS = 450
const DOUBLE_CLICK_PX = 12

class DrawFinishController {
  private readonly canvas: HTMLElement
  private readonly view: AcEdBaseView
  private finishRequested = false
  private lastClickAt = 0
  private lastScreen: { x: number; y: number } | null = null
  private readonly onDoubleClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    this.finishRequested = true
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  }

  constructor(view: AcEdBaseView) {
    this.view = view
    this.canvas = view.canvas
    this.canvas.addEventListener('dblclick', this.onDoubleClick, true)
  }

  rememberPoint(point: AcGePoint3dLike) {
    this.lastScreen = this.view.worldToScreen(point)
    this.lastClickAt = performance.now()
  }

  isRepeatClick(point: AcGePoint3dLike) {
    if (!this.lastScreen) {
      return false
    }

    const screen = this.view.worldToScreen(point)
    const elapsed = performance.now() - this.lastClickAt
    const distance = Math.hypot(screen.x - this.lastScreen.x, screen.y - this.lastScreen.y)
    return elapsed <= DOUBLE_CLICK_MS && distance <= DOUBLE_CLICK_PX
  }

  shouldFinish() {
    return this.finishRequested
  }

  dispose() {
    this.canvas.removeEventListener('dblclick', this.onDoubleClick, true)
  }
}

export const collectDrawPath = async (
  context: AcApContext,
  options: {
    firstMessage: string
    nextMessage: string
    minPoints: number
    previewClosed: boolean
    stylePreview?: (entity: AcDbPolyline) => void
  }
): Promise<{ points: AcGePoint2d[]; closed: boolean } | null> => {
  const editor = AcApDocManager.instance.editor
  const points: AcGePoint2d[] = []
  const finisher = new DrawFinishController(context.view)

  try {
    const firstPrompt = new AcEdPromptPointOptions(options.firstMessage)
    const firstResult = await editor.getPoint(firstPrompt)
    if (firstResult.status !== AcEdPromptStatus.OK || !firstResult.value) {
      return null
    }
    points.push(toPoint2d(firstResult.value))
    finisher.rememberPoint(firstResult.value)

    const finish = (closed: boolean) =>
      points.length >= options.minPoints ? { points, closed } : null

    while (true) {
      const nextPrompt = new AcEdPromptPointOptions(options.nextMessage, 'Close Undo')
      nextPrompt.allowNone = true
      nextPrompt.useBasePoint = true
      nextPrompt.useDashedLine = !options.previewClosed
      nextPrompt.basePoint = new AcGePoint3d(points[points.length - 1])
      const pathJig = new DrawPathJig(context.view, points, options.previewClosed && points.length >= 2)
      options.stylePreview?.(pathJig.entity)
      nextPrompt.jig = pathJig
      nextPrompt.keywords.add('Đóng', 'Close', 'Đóng')
      nextPrompt.keywords.add('Hoàn tác', 'Undo', 'Hoàn tác')

      const nextResult = await editor.getPoint(nextPrompt)

      if (finisher.shouldFinish()) {
        return finish(options.previewClosed)
      }

      if (nextResult.status === AcEdPromptStatus.Keyword) {
        const keyword = nextResult.stringResult ?? ''
        if (keyword === 'Undo') {
          if (points.length > 1) {
            points.pop()
          }
          continue
        }
        if (keyword === 'Close') {
          return finish(true)
        }
        continue
      }

      if (nextResult.status === AcEdPromptStatus.None) {
        return finish(options.previewClosed)
      }

      if (nextResult.status !== AcEdPromptStatus.OK || !nextResult.value) {
        return null
      }

      if (finisher.isRepeatClick(nextResult.value)) {
        return finish(options.previewClosed)
      }

      points.push(toPoint2d(nextResult.value))
      finisher.rememberPoint(nextResult.value)
    }
  } finally {
    finisher.dispose()
  }
}
