import { AcApDocManager } from '@mlightcad/cad-simple-viewer'
import { AcDbLine, AcDbMText, AcDbPolyline, AcGePoint2d } from '@mlightcad/data-model'
import { ElMessage } from 'element-plus'

import { getAnnotation, isFileAnnotation, type DrawAnnotation } from './annotationRegistry'
import { hexFromEntityColor, pixelsFromWorldSize, worldSizeFromPixels } from './drawHelpers'
import { getCadEntityById } from './existingEntities'
import { activateDrawLayer, DRAW_LAYER_BY_TOOL, getActiveDrawLayer } from './drawLayers'
import { createLineAnnotation } from './lineCmd'
import { findAnnotationAtWorld, findSheetMoveTarget, getSheetPartWorldBounds } from './moveDrawings'
import { createPointAnnotation } from './pointCmd'
import { createRegionAnnotation } from './regionCmd'
import {
  createScaleAnnotation,
  formatScaleDistance,
  metersPerDrawingUnit,
  DEFAULT_SCALE_COLOR,
  type ScaleDrawOptions
} from './scaleCmd'
import {
  createSheetAnnotation,
  resolveSheetTable,
  sheetLabelText,
  shiftSheetTableBounds,
  type SheetDrawOptions,
  type SheetMoveTarget
} from './sheetCmd'
import { createTableAnnotation, normalizeTableOptions, type TableDrawOptions } from './tableCmd'
import { createTextAnnotation, stripMTextFormat } from './textCmd'
import { recordDrawUndo } from './drawUndoStack'
import { DEFAULT_TABLE_FONT } from './textStyles'
import { store } from '../store'

const COPYABLE = new Set(['point', 'line', 'region', 'text', 'sheet'])

type CopiedPoint = {
  kind: 'point'
  x: number
  y: number
  z?: number
  fillMode: 'fill' | 'transparent'
  fillColor: string
  strokeColor: string
  size: number
  layer?: string
}

type CopiedLine = {
  kind: 'line'
  points: { x: number; y: number }[]
  closed: boolean
  strokeColor: string
  lineType: string
  strokeWidth: number
  layer?: string
}

type CopiedRegion = {
  kind: 'region'
  points: { x: number; y: number }[]
  mode: 'polygon' | 'rectangle'
  fillMode: 'fill' | 'transparent'
  fillColor: string
  strokeColor: string
  lineType: string
  strokeWidth: number
  layer?: string
}

type CopiedText = {
  kind: 'text'
  contents: string
  font: string
  fontSize: number
  rotation: number
  color: string
  x: number
  y: number
  z?: number
  layer?: string
}

type CopiedSheet = {
  kind: 'sheet'
  minX: number
  minY: number
  maxX: number
  maxY: number
  sheet: SheetDrawOptions
  layer?: string
}

type CopiedTable = {
  kind: 'table'
  minX: number
  minY: number
  maxX: number
  maxY: number
  table: TableDrawOptions
  layer?: string
}

type CopiedScale = ScaleDrawOptions & {
  kind: 'scale'
  layer?: string
}

export type CopiedDrawObject = CopiedPoint | CopiedLine | CopiedRegion | CopiedText | CopiedSheet | CopiedTable | CopiedScale

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

let copiedObject: CopiedDrawObject | null = null
let menuSheetPart: SheetMoveTarget | undefined

const clientToWorld = (clientX: number, clientY: number) => {
  const view = AcApDocManager.instance.curView
  return view.screenToWorld(view.viewportToCanvas({ x: clientX, y: clientY }))
}

const readPolyline = (annotation: DrawAnnotation) => {
  for (const entityId of annotation.entityIds) {
    const entity = getCadEntityById(entityId)
    if (entity instanceof AcDbPolyline && entity.numberOfVertices >= 2) {
      return {
        points: Array.from({ length: entity.numberOfVertices }, (_, index) => {
          const point = entity.getPoint2dAt(index)
          return { x: point.x, y: point.y }
        }),
        closed: entity.closed
      }
    }
  }
  return null
}

const snapshotAnnotation = (annotation: DrawAnnotation): CopiedDrawObject | null => {
  if (annotation.kind === 'point' && annotation.point) {
    return {
      kind: 'point',
      x: annotation.point.x,
      y: annotation.point.y,
      z: annotation.point.z,
      fillMode: annotation.point.fillMode,
      fillColor: annotation.point.fillColor,
      strokeColor: annotation.point.strokeColor,
      size: annotation.point.size,
      layer: annotation.layer
    }
  }

  if (annotation.kind === 'text') {
    const entity = annotation.entityIds[0] ? getCadEntityById(annotation.entityIds[0]) : undefined
    const mtext = entity instanceof AcDbMText ? entity : undefined
    const contents = annotation.text?.contents || (mtext ? stripMTextFormat(mtext.contents) : '')
    if (!contents) {
      return null
    }
    return {
      kind: 'text',
      contents,
      font: annotation.text?.font || '',
      fontSize: annotation.text?.fontSize || 20,
      rotation: annotation.text?.rotation ?? (mtext ? (mtext.rotation * 180) / Math.PI : 0),
      color: annotation.text?.color || '',
      x: mtext?.location.x ?? annotation.bounds?.minX ?? 0,
      y: mtext?.location.y ?? annotation.bounds?.minY ?? 0,
      z: mtext?.location.z ?? 0,
      layer: annotation.layer
    }
  }

  if (annotation.kind === 'line' || annotation.kind === 'region') {
    const path = readPolyline(annotation)
    if (!path || path.points.length < 2) {
      return null
    }
    if (annotation.kind === 'line') {
      return {
        kind: 'line',
        points: path.points,
        closed: annotation.closed ?? path.closed,
        strokeColor: annotation.lineStrokeColor || store.lineStrokeColor,
        lineType: annotation.lineLineType || store.lineLineType,
        strokeWidth: annotation.lineStrokeWidth ?? store.lineStrokeWidth,
        layer: annotation.layer
      }
    }
    return {
      kind: 'region',
      points: path.points,
      mode: annotation.regionMode ?? 'polygon',
      fillMode: annotation.regionFillMode ?? 'fill',
      fillColor: annotation.regionFillColor || store.regionFillColor,
      strokeColor: annotation.regionStrokeColor || store.regionStrokeColor,
      lineType: annotation.regionLineType || store.regionLineType,
      strokeWidth: annotation.regionStrokeWidth ?? store.regionStrokeWidth,
      layer: annotation.layer
    }
  }

  if (
    annotation.kind === 'sheet' &&
    annotation.sheet &&
    annotation.gridFrame &&
    !isFileAnnotation(annotation)
  ) {
    return snapshotSheetPart(annotation, menuSheetPart)
  }

  return null
}

const cadTextContents = (entity: unknown) => {
  if (entity instanceof AcDbMText) {
    return stripMTextFormat(entity.contents)
  }
  const record = entity as { contents?: string; textString?: string } | undefined
  if (typeof record?.contents === 'string') {
    return stripMTextFormat(record.contents)
  }
  if (typeof record?.textString === 'string') {
    return record.textString
  }
  return ''
}

const snapshotSheetLabel = (annotation: DrawAnnotation, role: string): CopiedText | null => {
  const entityId = Object.entries(annotation.sheetRoles ?? {}).find((entry) => entry[1] === role)?.[0]
  const entity = entityId ? getCadEntityById(entityId) : undefined
  const loc =
    entity && typeof entity === 'object'
      ? ((entity as { location?: { x: number; y: number; z?: number }; position?: { x: number; y: number; z?: number } })
          .location ??
        (entity as { position?: { x: number; y: number; z?: number } }).position)
      : undefined
  const contents = sheetLabelText(annotation.sheet, role, cadTextContents(entity)).trim()
  if (!contents || !loc) {
    return null
  }
  const view = AcApDocManager.instance.curView
  const height = Number((entity as { height?: number } | undefined)?.height)
  const rotation = Number((entity as { rotation?: number } | undefined)?.rotation)
  const style = annotation.sheet?.labelStyles?.[role]
  return {
    kind: 'text',
    contents,
    font: DEFAULT_TABLE_FONT,
    fontSize:
      style?.fontSize && style.fontSize >= 8
        ? style.fontSize
        : Number.isFinite(height)
          ? pixelsFromWorldSize(view, height)
          : 18,
    rotation: Number.isFinite(rotation) ? (rotation * 180) / Math.PI : 0,
    color: style?.color || (entity ? hexFromEntityColor(entity) : '') || '#000000',
    x: loc.x,
    y: loc.y,
    z: loc.z,
    layer: annotation.layer
  }
}

const snapshotSheetTable = (annotation: DrawAnnotation, role: 'note' | 'legend'): CopiedTable | null => {
  const working = resolveSheetTable(annotation, role)
  if (!working) {
    return null
  }
  return {
    kind: 'table',
    minX: working.bounds.minX,
    minY: working.bounds.minY,
    maxX: working.bounds.maxX,
    maxY: working.bounds.maxY,
    table: cloneJson(working.table),
    layer: annotation.layer
  }
}

const snapshotSheetScale = (annotation: DrawAnnotation): CopiedScale | null => {
  let x: number | undefined
  let y: number | undefined
  let worldLength = 0
  for (const entityId of annotation.entityIds) {
    if (annotation.sheetRoles?.[entityId] !== 'scale') {
      continue
    }
    const entity = getCadEntityById(entityId)
    if (!(entity instanceof AcDbLine)) {
      continue
    }
    const start = entity.startPoint
    const end = entity.endPoint
    const length = Math.hypot(end.x - start.x, end.y - start.y)
    if (length <= worldLength) {
      continue
    }
    worldLength = length
    x = Math.min(start.x, end.x)
    y = Math.min(start.y, end.y)
  }
  if (x == null || y == null || worldLength <= 1e-8) {
    return null
  }
  const meters = worldLength * metersPerDrawingUnit({ x, y })
  const ratio = annotation.sheet?.scaleRatio || 500
  return {
    kind: 'scale',
    x,
    y,
    worldLength,
    meters,
    ratio,
    unitLabel: formatScaleDistance(meters),
    color: DEFAULT_SCALE_COLOR,
    layer: annotation.layer
  }
}

const snapshotSheetNeighbor = (annotation: DrawAnnotation): CopiedTable | null => {
  const bounds = getSheetPartWorldBounds(annotation, { kind: 'neighbor' })
  if (!bounds) {
    return null
  }
  const sheetNo = annotation.sheet?.sheetNo?.trim() || '1'
  return {
    kind: 'table',
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    table: normalizeTableOptions({
      rows: 3,
      cols: 3,
      title: '',
      headers: [],
      cells: [
        ['', '', ''],
        ['', sheetNo, ''],
        ['', '', '']
      ],
      font: DEFAULT_TABLE_FONT,
      fontSize: 18
    }),
    layer: annotation.layer
  }
}

const snapshotSheetPart = (annotation: DrawAnnotation, part?: SheetMoveTarget): CopiedDrawObject | null => {
  if (!annotation.sheet || !annotation.gridFrame || isFileAnnotation(annotation)) {
    return null
  }
  if (part?.kind === 'label') {
    return snapshotSheetLabel(annotation, part.role)
  }
  if (part?.kind === 'table') {
    return snapshotSheetTable(annotation, part.role)
  }
  if (part?.kind === 'scale') {
    return snapshotSheetScale(annotation)
  }
  if (part?.kind === 'neighbor') {
    return snapshotSheetNeighbor(annotation)
  }
  if (part?.kind === 'frame') {
    const { minX, minY, maxX, maxY } = annotation.gridFrame
    return {
      kind: 'sheet',
      minX,
      minY,
      maxX,
      maxY,
      sheet: cloneJson(annotation.sheet),
      layer: annotation.layer
    }
  }
  return null
}

const objectAnchor = (item: CopiedDrawObject) => {
  if (item.kind === 'point' || item.kind === 'text') {
    return { x: item.x, y: item.y }
  }
  if (item.kind === 'scale') {
    return { x: item.x, y: item.y }
  }
  if (item.kind === 'sheet' || item.kind === 'table') {
    return {
      x: (item.minX + item.maxX) / 2,
      y: (item.minY + item.maxY) / 2
    }
  }
  const xs = item.points.map((point) => point.x)
  const ys = item.points.map((point) => point.y)
  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2
  }
}

const findCopyableAtClient = (clientX: number, clientY: number) => {
  const view = AcApDocManager.instance.curView
  const world = clientToWorld(clientX, clientY)
  const annotation = findAnnotationAtWorld(view, world)
  if (annotation && COPYABLE.has(annotation.kind)) {
    return annotation
  }
  return undefined
}

export const closeObjectContextMenu = () => {
  store.objectContextMenu.visible = false
  store.objectContextMenu.annotationId = null
  store.objectContextMenu.canCopy = false
  store.objectContextMenu.canPaste = false
  store.objectContextMenu.canEditText = false
  menuSheetPart = undefined
}

export const closePasteLayerPicker = () => {
  store.pasteLayerPicker.visible = false
}

export const closeCopyPasteUi = () => {
  closeObjectContextMenu()
  closePasteLayerPicker()
}

export const openObjectContextMenu = (
  clientX: number,
  clientY: number,
  preferred?: DrawAnnotation | null,
  extras?: { canEditText?: boolean }
) => {
  const world = clientToWorld(clientX, clientY)
  const annotation =
    preferred && COPYABLE.has(preferred.kind) ? preferred : findCopyableAtClient(clientX, clientY)
  menuSheetPart = undefined
  if (annotation?.kind === 'sheet') {
    const view = AcApDocManager.instance.curView
    menuSheetPart = findSheetMoveTarget(annotation, world, worldSizeFromPixels(view, 8))
  }
  const canCopy = Boolean(annotation && snapshotAnnotation(annotation))
  const canPaste = Boolean(copiedObject)
  const canEditText = Boolean(extras?.canEditText) || annotation?.kind === 'text'
  if (!canCopy && !canPaste && !canEditText) {
    return false
  }

  const width = 168
  const height = 44 * (Number(canCopy) + Number(canPaste) + Number(canEditText)) + 8
  store.objectContextMenu.visible = true
  store.objectContextMenu.clickX = clientX
  store.objectContextMenu.clickY = clientY
  store.objectContextMenu.x = Math.min(Math.max(8, clientX), window.innerWidth - width - 8)
  store.objectContextMenu.y = Math.min(Math.max(8, clientY), window.innerHeight - height - 8)
  store.objectContextMenu.worldX = world.x
  store.objectContextMenu.worldY = world.y
  store.objectContextMenu.annotationId = annotation?.id ?? null
  store.objectContextMenu.canCopy = canCopy
  store.objectContextMenu.canPaste = canPaste
  store.objectContextMenu.canEditText = canEditText
  return true
}

export const copyObjectFromMenu = () => {
  const annotationId = store.objectContextMenu.annotationId
  const annotation = annotationId ? getAnnotation(annotationId) : undefined
  const snapshot = annotation ? snapshotAnnotation(annotation) : null
  closeObjectContextMenu()
  if (!snapshot) {
    ElMessage.warning('Không sao chép được đối tượng này.')
    return false
  }
  copiedObject = snapshot
  ElMessage.success('Đã sao chép đối tượng. Chuột phải rồi chọn Dán để đặt bản sao.')
  return true
}

export const beginPasteLayerPick = () => {
  const item = copiedObject
  const menu = store.objectContextMenu
  const worldX = menu.worldX
  const worldY = menu.worldY
  const clickX = menu.clickX
  const clickY = menu.clickY
  closeObjectContextMenu()
  if (!item) {
    ElMessage.warning('Chưa có đối tượng để dán. Hãy sao chép trước.')
    return false
  }

  const preferred = item.layer || store.drawLayer || DRAW_LAYER_BY_TOOL[item.kind]
  const activated = activateDrawLayer(preferred)
  if (!activated.ok && !store.drawLayer) {
    store.drawLayer = DRAW_LAYER_BY_TOOL[item.kind]
  }

  const width = 360
  const height = 460
  store.pasteLayerPicker.visible = true
  store.pasteLayerPicker.x = Math.min(Math.max(8, clickX), window.innerWidth - width - 8)
  store.pasteLayerPicker.y = Math.min(Math.max(8, clickY), window.innerHeight - height - 8)
  store.pasteLayerPicker.worldX = worldX
  store.pasteLayerPicker.worldY = worldY
  store.pasteLayerPicker.tool = item.kind
  return true
}

export const pasteCopiedObject = () => {
  const item = copiedObject
  const picker = store.pasteLayerPicker
  const x = picker.visible ? picker.worldX : store.objectContextMenu.worldX
  const y = picker.visible ? picker.worldY : store.objectContextMenu.worldY
  if (!item) {
    closeCopyPasteUi()
    ElMessage.warning('Chưa có đối tượng để dán. Hãy sao chép trước.')
    return false
  }

  const chosen = store.drawLayer || item.layer || getActiveDrawLayer(DRAW_LAYER_BY_TOOL[item.kind])
  if (!chosen) {
    ElMessage.warning('Hãy chọn lớp để dán.')
    return false
  }
  const activated = activateDrawLayer(chosen)
  if (!activated.ok) {
    ElMessage.warning(activated.message)
    return false
  }

  closeCopyPasteUi()
  const context = AcApDocManager.instance.context
  const layer = activated.layer
  const anchor = objectAnchor(item)
  const dx = x - anchor.x
  const dy = y - anchor.y

  recordDrawUndo(() => {
  if (item.kind === 'point') {
    createPointAnnotation(
      context,
      { x: item.x + dx, y: item.y + dy, z: item.z },
      {
        fillMode: item.fillMode,
        fillColor: item.fillColor,
        strokeColor: item.strokeColor,
        size: item.size
      },
      layer
    )
  } else if (item.kind === 'text') {
    createTextAnnotation(
      context,
      {
        contents: item.contents,
        font: item.font,
        fontSize: item.fontSize,
        rotation: item.rotation,
        color: item.color,
        x: item.x + dx,
        y: item.y + dy,
        z: item.z
      },
      layer
    )
  } else if (item.kind === 'line') {
    createLineAnnotation(
      context,
      item.points.map((point) => new AcGePoint2d(point.x + dx, point.y + dy)),
      item.closed,
      {
        strokeColor: item.strokeColor,
        lineType: item.lineType,
        strokeWidth: item.strokeWidth
      },
      layer
    )
  } else if (item.kind === 'sheet') {
    const options = cloneJson(item.sheet)
    createSheetAnnotation(
      context,
      item.minX + dx,
      item.minY + dy,
      item.maxX + dx,
      item.maxY + dy,
      {
        ...options,
        tableBounds: shiftSheetTableBounds(options.tableBounds, dx, dy)
      },
      layer
    )
  } else if (item.kind === 'table') {
    createTableAnnotation(
      context,
      item.minX + dx,
      item.minY + dy,
      item.maxX + dx,
      item.maxY + dy,
      item.table,
      layer
    )
  } else if (item.kind === 'scale') {
    createScaleAnnotation(
      context,
      {
        x: item.x + dx,
        y: item.y + dy,
        worldLength: item.worldLength,
        meters: item.meters,
        ratio: item.ratio,
        unitLabel: item.unitLabel,
        color: item.color
      },
      layer
    )
  } else {
    createRegionAnnotation(
      context,
      item.points.map((point) => new AcGePoint2d(point.x + dx, point.y + dy)),
      {
        mode: item.mode,
        fillMode: item.fillMode,
        fillColor: item.fillColor,
        strokeColor: item.strokeColor,
        lineType: item.lineType,
        strokeWidth: item.strokeWidth
      },
      layer
    )
  }
  })

  ElMessage.success('Đã dán đối tượng.')
  return true
}
