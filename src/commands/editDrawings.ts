import {
  AcApDocManager,
  AcEdPromptPointOptions,
  AcEdPromptStatus
} from '@mlightcad/cad-simple-viewer'
import { AcDbMText, AcDbText } from '@mlightcad/data-model'
import { ElMessage } from 'element-plus'

import {
  eraseAnnotationEntities,
  findAnnotationByEntityId,
  getAnnotation,
  isFileAnnotation,
  listAnnotations,
  type DrawAnnotation
} from './annotationRegistry'
import {
  adoptCadEntityAtWorld,
  adoptCadEntityById,
  boundsFromCadEntity,
  getCadEntityById,
  getFilePathEntity,
  refreshFileTextContent,
  updateFileTextEntity,
  writeFileAnnotationPath
} from './existingEntities'
import {
  bindDrawMoving,
  cancelPointerMove,
  deactivateMoveMode,
  isPointerMoving,
  unbindDrawMoving
} from './moveDrawings'
import { closeCopyPasteUi, openObjectContextMenu } from './copyDrawings'
import { undoDraw } from './drawUndo'
import { recordDrawUndo } from './drawUndoStack'
import { collectGridFrame, createGridAnnotation } from './gridCmd'
import { collectCircleRadius, createCircleAnnotation } from './circleCmd'
import { createScaleAnnotation, formatScaleRatio, measureMapScale } from './scaleCmd'
import {
  applySheetLabelOverride,
  collectSheetFrame,
  createSheetAnnotation,
  inferSheetTextRole,
  rebuildSheetAnnotation,
  resolveSheetTable,
  type SheetTableRole
} from './sheetCmd'
import { collectLinePoints, createLineAnnotation } from './lineCmd'
import { createPointAnnotation } from './pointCmd'
import { collectRegionPoints, createRegionAnnotation } from './regionCmd'
import { hexFromEntityColor, pixelsFromWorldSize, worldSizeFromPixels } from './drawHelpers'
import {
  applyTableEdgeResize,
  createTableAnnotation,
  DEFAULT_TABLE_TEXT_COLOR,
  expandTableBoundsForInsert,
  getTableCellColor,
  getTableCellFontSize,
  getTableCellText,
  hitTableCell,
  hitTableEdge,
  insertTableColumnAfter,
  insertTableRowAfter,
  MAX_TABLE_COLS,
  MAX_TABLE_ROWS,
  getCellMerge,
  getTableLayout,
  mergeTableCells,
  tableCellRect,
  normalizeTableOptions,
  unmergeTableCells,
  removeTableColumnAt,
  removeTableRowAt,
  setTableCellText,
  tableHasTitle,
  type TableDrawInput,
  type TableDrawOptions,
  type TableEdgeHit
} from './tableCmd'
import {
  createTextAnnotation,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_FONT_SIZE,
  glyphSizeForText,
  hitRotatedGlyph,
  normalizeTextOptions,
  stripMTextFormat,
  type TextDrawOptions
} from './textCmd'
import { DEFAULT_TABLE_FONT, DEFAULT_TABLE_FONT_SIZE } from './textStyles'
import { store } from '../store'

let bound = false
let editing = false
let lastEditAt = 0
let editingSheetEntityId: string | null = null
let lastEditClient = { x: 0, y: 0 }
let tableResizeDrag: {
  pointerId: number
  annotationId: string
  sheetTableRole: SheetTableRole | null
  hit: TableEdgeHit
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
  table: TableDrawOptions
  startClient: { x: number; y: number }
} | null = null

const isCollectingPoints = () => {
  const tool = store.activeDrawTool
  return Boolean(tool && tool !== 'move')
}

const isBusy = () => editing || isCollectingPoints() || Boolean(tableResizeDrag)

const clientToWorld = (clientX: number, clientY: number) => {
  const view = AcApDocManager.instance.curView
  return view.screenToWorld(view.viewportToCanvas({ x: clientX, y: clientY }))
}

export const closeTableCellEditor = () => {
  store.tableCellEditor.visible = false
  store.tableCellEditor.annotationId = null
  store.tableCellEditor.sheetTableRole = null
  store.tableCellEditor.text = ''
  store.tableCellEditor.color = DEFAULT_TABLE_TEXT_COLOR
  store.tableCellEditor.fontSize = DEFAULT_TABLE_FONT_SIZE
  store.tableCellEditor.isTitle = false
  store.tableCellEditor.mergeCount = 2
  store.tableCellEditor.colSpan = 1
  store.tableCellEditor.rowSpan = 1
  store.tableCellEditor.popupX = null
  store.tableCellEditor.popupY = null
}

const getWorkingTable = (
  annotation: DrawAnnotation,
  role: SheetTableRole | null | undefined
) => {
  if (role) {
    return resolveSheetTable(annotation, role)
  }
  if (annotation.table && annotation.bounds) {
    return { role: null, table: annotation.table, bounds: annotation.bounds }
  }
  return null
}

const replaceWorkingTable = (
  annotation: DrawAnnotation,
  role: SheetTableRole | null | undefined,
  options: TableDrawOptions,
  bounds: { minX: number; minY: number; maxX: number; maxY: number }
) =>
  recordDrawUndo(() => {
    if (role) {
      if (!annotation.sheet) {
        return false
      }
      return rebuildSheetAnnotation(AcApDocManager.instance.context, annotation, {
        ...annotation.sheet,
        tables: { ...(annotation.sheet.tables ?? {}), [role]: options },
        tableBounds: { ...(annotation.sheet.tableBounds ?? {}), [role]: bounds }
      })
    }
    return replaceTable(annotation, options, bounds)
  })

export const openTableCellEditor = (
  annotation: DrawAnnotation,
  row: number,
  col: number,
  sheetRole: SheetTableRole | null = null
) => {
  const working = getWorkingTable(annotation, sheetRole)
  if (!working) {
    return
  }
  const options = working.table

  try {
    AcApDocManager.instance.curView.applySelection([], 'replace')
  } catch {
    // Selection is optional.
  }

  store.tableEditor.visible = false
  store.textEditor.visible = false
  store.tableCellEditor.visible = true
  store.tableCellEditor.annotationId = annotation.id
  store.tableCellEditor.sheetTableRole = sheetRole
  const merge = getCellMerge(options, row, col)
  store.tableCellEditor.row = merge.originRow
  store.tableCellEditor.col = merge.originCol
  store.tableCellEditor.text = getTableCellText(options, merge.originRow, merge.originCol)
  store.tableCellEditor.color = getTableCellColor(options, merge.originRow, merge.originCol)
  store.tableCellEditor.fontSize = getTableCellFontSize(options, merge.originRow, merge.originCol)
  store.tableCellEditor.isTitle = tableHasTitle(options) && merge.originRow === 0
  store.tableCellEditor.mergeCount = Math.max(merge.colSpan, merge.rowSpan, 2)
  store.tableCellEditor.colSpan = merge.colSpan
  store.tableCellEditor.rowSpan = merge.rowSpan
  store.tableCellEditor.popupX = lastEditClient.x
  store.tableCellEditor.popupY = lastEditClient.y
}

export const closeTextEditor = () => {
  store.textEditor.visible = false
  store.textEditor.mode = 'create'
  store.textEditor.annotationId = null
  store.textEditor.sheetRole = null
  store.textEditor.popupX = null
  store.textEditor.popupY = null
  editingSheetEntityId = null
}

const editText = (annotation: DrawAnnotation) => {
  const entityId = annotation.entityIds[0]
  const entity = entityId ? getCadEntityById(entityId) : undefined
  const saved = annotation.text
  const fileText = isFileAnnotation(annotation)
  const view = AcApDocManager.instance.curView
  const height = Number((entity as { height?: number } | undefined)?.height)
  store.tableEditor.visible = false
  store.tableCellEditor.visible = false
  store.linePanelVisible = false
  store.regionPanelVisible = false
  store.pointPanelVisible = false
  store.circlePanelVisible = false
  store.gridPanelVisible = false
  store.sheetPanelVisible = false
  store.scalePanelVisible = false
  store.textEditor.visible = true
  store.textEditor.mode = 'edit'
  store.textEditor.annotationId = annotation.id
  store.textEditor.sheetRole = null
  store.textEditor.popupX = lastEditClient.x
  store.textEditor.popupY = lastEditClient.y
  store.textEditor.contents =
    saved?.contents ||
    (entity instanceof AcDbMText
      ? stripMTextFormat(entity.contents)
      : entity instanceof AcDbText
        ? entity.textString
        : '')
  store.textEditor.font = saved?.font || DEFAULT_TABLE_FONT
  store.textEditor.fontSize =
    saved?.fontSize && saved.fontSize >= 8
      ? saved.fontSize
      : Number.isFinite(height)
        ? pixelsFromWorldSize(view, height)
        : DEFAULT_TEXT_FONT_SIZE
  store.textEditor.rotation =
    saved?.rotation ??
    (entity instanceof AcDbMText || entity instanceof AcDbText
      ? (entity.rotation * 180) / Math.PI
      : 0)
  store.textEditor.color =
    saved?.color || (entity ? hexFromEntityColor(entity) : '') || DEFAULT_TEXT_COLOR
  if (fileText) {
    ElMessage.info('Sửa nội dung, cỡ chữ, màu hoặc góc xoay, rồi bấm Cập nhật chữ.')
  }
}

const cadTextContents = (entity: unknown) => {
  if (!entity || typeof entity !== 'object') {
    return ''
  }
  if (entity instanceof AcDbMText) {
    return stripMTextFormat(entity.contents)
  }
  if (entity instanceof AcDbText) {
    return entity.textString
  }
  const record = entity as { contents?: unknown; textString?: unknown }
  if (typeof record.contents === 'string') {
    return stripMTextFormat(record.contents)
  }
  if (typeof record.textString === 'string') {
    return record.textString
  }
  return ''
}

const isCadTextEntity = (entity: unknown): entity is AcDbMText | AcDbText => {
  if (!entity || typeof entity !== 'object') {
    return false
  }
  if (entity instanceof AcDbMText || entity instanceof AcDbText) {
    return true
  }
  const type = `${(entity as { type?: string }).type || ''} ${(entity as { dxfTypeName?: string }).dxfTypeName || ''} ${entity.constructor?.name || ''}`.toUpperCase()
  if (type.includes('MTEXT') || type.includes('ACDBTEXT') || /(^|\s)TEXT(\s|$)/.test(type)) {
    return true
  }
  return cadTextContents(entity).length > 0 && ('location' in entity || 'position' in entity)
}

const textAnchor = (entity: AcDbMText | AcDbText | object) => {
  const record = entity as { location?: { x: number; y: number }; position?: { x: number; y: number } }
  return record.location ?? record.position
}

const entityGlyphHit = (entity: object, world: { x: number; y: number }, pad: number) => {
  const loc = textAnchor(entity)
  if (!loc) {
    return null
  }
  const record = entity as {
    height?: number
    rotation?: number
    attachmentPoint?: number
  }
  const height = Math.max(Number(record.height) || 0, 1e-6)
  const size = glyphSizeForText(cadTextContents(entity), height)
  const rotation =
    typeof record.rotation === 'number' && Number.isFinite(record.rotation)
      ? (record.rotation * 180) / Math.PI
      : 0
  return hitRotatedGlyph(loc, size.width, size.height, rotation, Number(record.attachmentPoint) || 7, world, pad)
}

type TextLikeHit =
  | {
      kind: 'text'
      annotation: DrawAnnotation
      score: number
      area: number
      outside: number
    }
  | {
      kind: 'sheet'
      annotation: DrawAnnotation
      entityId: string
      score: number
      area: number
      outside: number
    }
  | {
      kind: 'table'
      annotation: DrawAnnotation
      row: number
      col: number
      score: number
      area: number
      outside: number
    }
  | {
      kind: 'sheet-table'
      annotation: DrawAnnotation
      role: SheetTableRole
      row: number
      col: number
      score: number
      area: number
      outside: number
    }

const betterHit = (left?: TextLikeHit, right?: TextLikeHit) => {
  if (!right) {
    return left
  }
  if (!left) {
    return right
  }
  if (right.outside < left.outside - 1e-12) {
    return right
  }
  if (left.outside < right.outside - 1e-12) {
    return left
  }
  if (right.area < left.area - 1e-12) {
    return right
  }
  if (left.area < right.area - 1e-12) {
    return left
  }
  return right.score < left.score ? right : left
}

const boxHit = (
  box: { minX: number; minY: number; maxX: number; maxY: number },
  world: { x: number; y: number },
  pad: number
) => {
  const outsideX = world.x < box.minX ? box.minX - world.x : world.x > box.maxX ? world.x - box.maxX : 0
  const outsideY = world.y < box.minY ? box.minY - world.y : world.y > box.maxY ? world.y - box.maxY : 0
  const outside = Math.hypot(outsideX, outsideY)
  if (outside > pad) {
    return null
  }
  const width = Math.max(box.maxX - box.minX, 1e-6)
  const height = Math.max(box.maxY - box.minY, 1e-6)
  return {
    dist: Math.hypot(world.x - (box.minX + box.maxX) / 2, world.y - (box.minY + box.maxY) / 2),
    area: width * height,
    outside
  }
}

const tableCellHit = (
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  table: TableDrawOptions,
  world: { x: number; y: number }
) => {
  const cell = hitTableCell(bounds, table, world)
  if (!cell) {
    return null
  }
  const merge = getCellMerge(table, cell.row, cell.col)
  const rect = tableCellRect(
    getTableLayout(bounds, table),
    merge.originRow,
    merge.originCol,
    merge.colSpan,
    merge.rowSpan
  )
  const width = Math.max(Math.abs(rect.right - rect.left), 1e-6)
  const height = Math.max(Math.abs(rect.bottom - rect.top), 1e-6)
  return {
    row: merge.originRow,
    col: merge.originCol,
    dist: Math.hypot(world.x - (rect.left + rect.right) / 2, world.y - (rect.top + rect.bottom) / 2),
    area: width * height,
    outside: 0
  }
}

const pointInBox = (
  box: { minX: number; minY: number; maxX: number; maxY: number },
  world: { x: number; y: number },
  pad = 0
) =>
  world.x >= box.minX - pad &&
  world.x <= box.maxX + pad &&
  world.y >= box.minY - pad &&
  world.y <= box.maxY + pad

const collectTextLikeHits = (
  world: { x: number; y: number },
  pad: number,
  clientX?: number,
  clientY?: number
) => {
  let best: TextLikeHit | undefined

  const add = (hit: TextLikeHit | undefined) => {
    best = betterHit(best, hit)
  }

  for (const annotation of listAnnotations()) {
    if (annotation.kind === 'text') {
      const entity = annotation.entityIds[0] ? getCadEntityById(annotation.entityIds[0]) : undefined
      if (entity && isCadTextEntity(entity)) {
        const hit = entityGlyphHit(entity, world, pad)
        if (hit) {
          add({ kind: 'text', annotation, score: hit.dist, area: hit.area, outside: hit.outside })
        }
      } else if (annotation.bounds) {
        const hit = boxHit(annotation.bounds, world, pad)
        if (hit) {
          add({ kind: 'text', annotation, score: hit.dist, area: hit.area, outside: hit.outside })
        }
      }
      continue
    }

    if (annotation.kind === 'table' && annotation.bounds && annotation.table) {
      const cell = tableCellHit(annotation.bounds, annotation.table, world)
      if (!cell) {
        continue
      }
      add({
        kind: 'table',
        annotation,
        row: cell.row,
        col: cell.col,
        score: cell.dist,
        area: cell.area,
        outside: cell.outside
      })
    }
  }

  for (const annotation of listAnnotations()) {
    if (annotation.kind !== 'sheet' || isFileAnnotation(annotation)) {
      continue
    }

    for (const role of ['note', 'legend'] as SheetTableRole[]) {
      const working = resolveSheetTable(annotation, role)
      if (!working) {
        continue
      }
      const cell = tableCellHit(working.bounds, working.table, world)
      if (!cell) {
        continue
      }
      add({
        kind: 'sheet-table',
        annotation,
        role,
        row: cell.row,
        col: cell.col,
        score: cell.dist,
        area: cell.area,
        outside: cell.outside
      })
    }

    for (const entityId of annotation.entityIds) {
      const entity = getCadEntityById(entityId)
      if (!entity || !isCadTextEntity(entity)) {
        continue
      }
      const loc = textAnchor(entity)
      if (loc) {
        let insideTable = false
        for (const role of ['note', 'legend'] as SheetTableRole[]) {
          const working = resolveSheetTable(annotation, role)
          if (working && pointInBox(working.bounds, loc, 0)) {
            insideTable = true
            break
          }
        }
        if (insideTable) {
          continue
        }
      }
      const hit = entityGlyphHit(entity, world, pad)
      if (hit) {
        add({ kind: 'sheet', annotation, entityId, score: hit.dist, area: hit.area, outside: hit.outside })
      }
    }
  }

  if (!best && clientX != null && clientY != null) {
    try {
      const view = AcApDocManager.instance.curView
      for (const pick of view.pick(view.viewportToCanvas({ x: clientX, y: clientY }), 8, false)) {
        const entity = getCadEntityById(pick.id)
        if (!entity || !isCadTextEntity(entity)) {
          continue
        }
        const glyph = entityGlyphHit(entity, world, pad)
        if (!glyph) {
          continue
        }
        const annotation = findAnnotationByEntityId(String(pick.id)) ?? adoptCadEntityById(String(pick.id))
        if (annotation?.kind === 'text') {
          add({ kind: 'text', annotation, score: glyph.dist, area: glyph.area, outside: glyph.outside })
        } else if (annotation?.kind === 'sheet') {
          add({
            kind: 'sheet',
            annotation,
            entityId: String(pick.id),
            score: glyph.dist,
            area: glyph.area,
            outside: glyph.outside
          })
        }
        if (best) {
          break
        }
      }
    } catch {
      // Picking can fail before the view is ready.
    }
  }

  return best
}

const syncSheetStore = (options: NonNullable<DrawAnnotation['sheet']>) => {
  store.sheetCity = options.city
  store.sheetTitle = options.title
  store.sheetPlace = options.place
  store.sheetNo = options.sheetNo
  store.sheetScaleRatio = options.scaleRatio
  store.sheetSurveyUnit = options.surveyUnit
  store.sheetCertifyUnit = options.certifyUnit
}

const applySheetTextEdit = (
  annotation: DrawAnnotation,
  role: string | null,
  options: TextDrawOptions
) => {
  if (!annotation.sheet || isFileAnnotation(annotation)) {
    return false
  }

  const style = {
    fontSize: options.fontSize,
    color: options.color
  }

  if (role) {
    const next = applySheetLabelOverride(annotation.sheet, role, options.contents, style)
    if (!rebuildSheetAnnotation(AcApDocManager.instance.context, annotation, next)) {
      return false
    }
    syncSheetStore(next)
    return true
  }

  const entity = editingSheetEntityId ? getCadEntityById(editingSheetEntityId) : undefined
  if (!isCadTextEntity(entity) || !updateFileTextEntity(entity, normalizeTextOptions(options))) {
    return false
  }
  refreshFileTextContent(entity)
  return true
}

const editSheetRole = (
  annotation: DrawAnnotation,
  role: string,
  contents: string,
  entity?: unknown
) => {
  if (!annotation.sheet || isFileAnnotation(annotation)) {
    ElMessage.warning('Không sửa được chữ trên khung mẫu này.')
    return
  }

  const saved = role ? annotation.sheet.labelStyles?.[role] : undefined
  const view = AcApDocManager.instance.curView
  const height = Number((entity as { height?: number } | undefined)?.height)
  const objectId = (entity as { objectId?: string } | undefined)?.objectId
  editingSheetEntityId = objectId ? String(objectId) : null
  store.tableEditor.visible = false
  store.tableCellEditor.visible = false
  store.linePanelVisible = false
  store.regionPanelVisible = false
  store.pointPanelVisible = false
  store.circlePanelVisible = false
  store.gridPanelVisible = false
  store.sheetPanelVisible = false
  store.scalePanelVisible = false
  store.textEditor.visible = true
  store.textEditor.mode = 'edit'
  store.textEditor.annotationId = annotation.id
  store.textEditor.sheetRole = role || ''
  store.textEditor.popupX = lastEditClient.x
  store.textEditor.popupY = lastEditClient.y
  store.textEditor.contents = contents
  store.textEditor.font = DEFAULT_TABLE_FONT
  store.textEditor.fontSize =
    saved?.fontSize ||
    (Number.isFinite(height) ? pixelsFromWorldSize(view, height) : DEFAULT_TEXT_FONT_SIZE)
  store.textEditor.rotation =
    entity && typeof (entity as { rotation?: number }).rotation === 'number'
      ? (((entity as { rotation: number }).rotation) * 180) / Math.PI
      : 0
  store.textEditor.color =
    saved?.color || (entity ? hexFromEntityColor(entity as { color?: { RGB?: number } }) : '') || '#000000'
}

const editSheetText = (annotation: DrawAnnotation, entityId: string) => {
  const entity = getCadEntityById(entityId)
  if (!isCadTextEntity(entity) || isFileAnnotation(annotation)) {
    ElMessage.warning('Không sửa được chữ trên khung mẫu này.')
    return
  }

  const contents = cadTextContents(entity)
  const role = inferSheetTextRole(annotation, entityId, contents)
  editSheetRole(annotation, role ?? '', contents, entity)
}

export const applyTextEdit = (options: TextDrawOptions) =>
  recordDrawUndo(() => {
  const annotationId = store.textEditor.annotationId
  const annotation = annotationId ? getAnnotation(annotationId) : undefined
  if (!annotation) {
    return false
  }

  if (annotation.kind === 'sheet') {
    return applySheetTextEdit(annotation, store.textEditor.sheetRole, normalizeTextOptions(options))
  }

  const entityId = annotation.entityIds[0]
  const entity = entityId ? getCadEntityById(entityId) : undefined

  if (isFileAnnotation(annotation)) {
    if (!entity || !updateFileTextEntity(entity, normalizeTextOptions(options))) {
      return false
    }
    refreshFileTextContent(entity)
    annotation.text = {
      contents: options.contents.trim(),
      font: annotation.text?.font || '',
      fontSize: options.fontSize,
      rotation: options.rotation,
      color: options.color
    }
    annotation.bounds = boundsFromCadEntity(entity) ?? annotation.bounds
    return true
  }

  const location = entity instanceof AcDbMText
    ? entity.location
    : annotation.bounds
      ? { x: annotation.bounds.minX, y: annotation.bounds.minY, z: 0 }
      : null
  if (!location) {
    return false
  }

  const style = normalizeTextOptions(options)
  if (!style.contents) {
    return false
  }

  const layer = annotation.layer
  eraseAnnotationEntities(annotation)
  createTextAnnotation(AcApDocManager.instance.context, {
    ...style,
    x: location.x,
    y: location.y,
    z: location.z ?? 0
  }, layer)
  return true
})

const editGrid = async (annotation: DrawAnnotation) => {
  const context = AcApDocManager.instance.context
  store.activeDrawTool = 'grid'
  const style = annotation.grid ?? undefined
  const frame = await collectGridFrame(context, style, {
    firstMessage: 'Click góc thứ nhất để sửa khung lưới',
    nextMessage: 'Click góc đối diện để tạo lại lưới'
  })
  store.activeDrawTool = null
  if (!frame) {
    return
  }

  const layer = annotation.layer
  recordDrawUndo(() => {
    eraseAnnotationEntities(annotation)
    createGridAnnotation(context, frame.minX, frame.minY, frame.maxX, frame.maxY, style, layer)
  })
}

const editSheet = async (annotation: DrawAnnotation) => {
  const origin = annotation.sheet
  if (!origin || isFileAnnotation(annotation)) {
    ElMessage.warning('Đối tượng này chỉ kéo để di chuyển được.')
    return
  }
  const context = AcApDocManager.instance.context
  store.activeDrawTool = 'sheet'
  const frame = await collectSheetFrame(context, {
    firstMessage: 'Click góc thứ nhất để sửa vùng khung mẫu',
    nextMessage: 'Click góc đối diện để dựng lại khung mẫu'
  })
  store.activeDrawTool = null
  if (!frame) {
    return
  }
  const layer = annotation.layer
  const { tableBounds: _resetBounds, scaleOffset: _scale, neighborOffset: _neighbor, labelOffsets: _labels, ...kept } = origin
  recordDrawUndo(() => {
    eraseAnnotationEntities(annotation)
    createSheetAnnotation(context, frame.minX, frame.minY, frame.maxX, frame.maxY, kept, layer, annotation.id)
  })
}

const editPoint = async (annotation: DrawAnnotation) => {
  const origin = annotation.point
  if (!origin || isFileAnnotation(annotation)) {
    ElMessage.warning('Đối tượng này chỉ kéo để di chuyển được.')
    return
  }
  const context = AcApDocManager.instance.context
  store.activeDrawTool = 'point'
  const result = await AcApDocManager.instance.editor.getPoint(
    new AcEdPromptPointOptions('Click vị trí mới của điểm')
  )
  store.activeDrawTool = null
  if (result.status !== AcEdPromptStatus.OK || !result.value) {
    return
  }
  const center = {
    x: result.value.x,
    y: result.value.y,
    z: result.value.z ?? 0
  }
  const layer = annotation.layer
  recordDrawUndo(() => {
    eraseAnnotationEntities(annotation)
    createPointAnnotation(
      context,
      center,
      {
        fillMode: origin.fillMode,
        fillColor: origin.fillColor,
        strokeColor: origin.strokeColor,
        size: origin.size
      },
      layer,
      origin.radius
    )
  })
}

const editCircle = async (annotation: DrawAnnotation) => {
  const origin = annotation.circle
  if (!origin || isFileAnnotation(annotation)) {
    ElMessage.warning('Đối tượng này chỉ kéo để di chuyển được.')
    return
  }
  const context = AcApDocManager.instance.context
  store.activeDrawTool = 'circle'
  const result = await collectCircleRadius(
    context,
    {
      fillMode: origin.fillMode,
      fillColor: origin.fillColor,
      strokeColor: origin.strokeColor,
      strokeWidth: origin.strokeWidth
    },
    {
      firstMessage: 'Click tâm mới của hình tròn',
      nextMessage: 'Click điểm trên vòng tròn để lấy bán kính'
    }
  )
  store.activeDrawTool = null
  if (!result) {
    return
  }
  const layer = annotation.layer
  recordDrawUndo(() => {
    eraseAnnotationEntities(annotation)
    createCircleAnnotation(context, result.center, result.radius, {
      fillMode: origin.fillMode,
      fillColor: origin.fillColor,
      strokeColor: origin.strokeColor,
      strokeWidth: origin.strokeWidth
    }, layer)
  })
}

const editScale = (annotation: DrawAnnotation) => {
  const origin = annotation.scale
  if (!origin) {
    return
  }
  const view = AcApDocManager.instance.curView
  const next = measureMapScale(view, { x: origin.x, y: origin.y })
  const layer = annotation.layer
  recordDrawUndo(() => {
    eraseAnnotationEntities(annotation)
    createScaleAnnotation(AcApDocManager.instance.context, {
      ...next,
      x: origin.x,
      y: origin.y,
      color: origin.color
    }, layer)
  })
  ElMessage.success(`Đã cập nhật thước tỷ lệ ${next.unitLabel} (${formatScaleRatio(next.ratio)}).`)
}

const editFilePath = async (annotation: DrawAnnotation) => {
  const entity = getFilePathEntity(annotation)
  if (!entity || annotation.fileEdit === 'none') {
    ElMessage.warning('Đối tượng này chỉ kéo để di chuyển được.')
    return
  }

  const context = AcApDocManager.instance.context
  const isRegion = annotation.kind === 'region'
  ElMessage.info(
    isRegion
      ? 'Click các đỉnh mới để thay vùng sẵn có. Click đúp để khép vùng.'
      : 'Click các điểm mới để thay đường sẵn có. Click đúp để hoàn thành.'
  )
  store.activeDrawTool = isRegion ? 'region' : 'line'

  const points = isRegion
    ? await collectRegionPoints(context, annotation.regionMode ?? 'polygon', {
        strokeColor: store.regionStrokeColor,
        lineType: store.regionLineType,
        strokeWidth: store.regionStrokeWidth
      })
    : (await collectLinePoints(context, undefined, {
        firstMessage: 'Click điểm bắt đầu để sửa đường',
        nextMessage: 'Click điểm tiếp theo. Click đúp để hoàn thành [Đóng/Hoàn tác]'
      }))?.points

  store.activeDrawTool = null
  if (!points || points.length < (isRegion ? 3 : 2)) {
    return
  }

  recordDrawUndo(() => {
    if (!writeFileAnnotationPath(annotation, points, isRegion || annotation.closed === true)) {
      ElMessage.warning('Không sửa được hình dạng đối tượng này. Hãy kéo để di chuyển.')
      return
    }

    annotation.closed = isRegion || annotation.closed
    const updated = getFilePathEntity(annotation)
    annotation.bounds = updated ? boundsFromCadEntity(updated) ?? annotation.bounds : annotation.bounds
  })
}

const editPath = async (annotation: DrawAnnotation) => {
  if (isFileAnnotation(annotation)) {
    await editFilePath(annotation)
    return
  }

  const context = AcApDocManager.instance.context
  const isRegion = annotation.kind === 'region'
  store.activeDrawTool = isRegion ? 'region' : 'line'

  if (isRegion) {
    const mode = annotation.regionMode ?? 'polygon'
    store.regionMode = mode
    const points = await collectRegionPoints(context, mode, {
      strokeColor: annotation.regionStrokeColor ?? store.regionStrokeColor,
      lineType: annotation.regionLineType ?? store.regionLineType,
      strokeWidth: annotation.regionStrokeWidth ?? store.regionStrokeWidth
    })
    store.activeDrawTool = null
    if (!points) {
      return
    }
    const layer = annotation.layer
    recordDrawUndo(() => {
      eraseAnnotationEntities(annotation)
      createRegionAnnotation(context, points, {
        mode,
        fillMode: annotation.regionFillMode ?? store.regionFillMode,
        fillColor: annotation.regionFillColor ?? store.regionFillColor,
        strokeColor: annotation.regionStrokeColor ?? store.regionStrokeColor,
        lineType: annotation.regionLineType ?? store.regionLineType,
        strokeWidth: annotation.regionStrokeWidth ?? store.regionStrokeWidth
      }, layer)
    })
    return
  }

  const style = {
    strokeColor: annotation.lineStrokeColor ?? store.lineStrokeColor,
    lineType: annotation.lineLineType ?? store.lineLineType,
    strokeWidth: annotation.lineStrokeWidth ?? store.lineStrokeWidth
  }
  const path = await collectLinePoints(context, style, {
    firstMessage: 'Click điểm bắt đầu để sửa đường',
    nextMessage: 'Click điểm tiếp theo. Click đúp để hoàn thành [Đóng/Hoàn tác]'
  })

  store.activeDrawTool = null
  if (!path) {
    return
  }

  const layer = annotation.layer
  recordDrawUndo(() => {
    eraseAnnotationEntities(annotation)
    createLineAnnotation(context, path.points, path.closed, style, layer)
  })
}

const editTable = (annotation: DrawAnnotation, sheetRole: SheetTableRole | null = null) => {
  const working = getWorkingTable(annotation, sheetRole)
  if (!working) {
    return
  }
  const options = working.table

  store.tableEditor.visible = true
  store.tableEditor.mode = 'edit'
  store.tableEditor.annotationId = annotation.id
  store.tableEditor.sheetTableRole = sheetRole
  store.tableEditor.rows = options.rows
  store.tableEditor.cols = options.cols
  store.tableEditor.title = options.title
  store.tableEditor.headers = options.headers.join(', ')
  store.tableEditor.font = options.font || store.tableEditor.font
  store.tableEditor.fontSize = options.fontSize || store.tableEditor.fontSize
}

const replaceTable = (
  annotation: DrawAnnotation,
  options: TableDrawOptions,
  bounds = annotation.bounds
) => {
  if (!bounds) {
    return false
  }

  const { minX, minY, maxX, maxY } = bounds
  const layer = annotation.layer
  eraseAnnotationEntities(annotation)
  createTableAnnotation(AcApDocManager.instance.context, minX, minY, maxX, maxY, options, layer, annotation.id)
  return true
}

export const applyTableEdit = (options: TableDrawInput) => {
  const annotationId = store.tableEditor.annotationId
  const annotation = annotationId ? getAnnotation(annotationId) : undefined
  const role = store.tableEditor.sheetTableRole
  const working = annotation ? getWorkingTable(annotation, role) : null
  if (!annotation || !working) {
    return false
  }

  const next = normalizeTableOptions(
    {
      ...options,
      cells: working.table.cells,
      cellColors: working.table.cellColors,
      cellFontSizes: working.table.cellFontSizes,
      cellColSpans: working.table.cellColSpans,
      cellRowSpans: working.table.cellRowSpans,
      colSpans: options.colSpans ?? working.table.colSpans,
      rowSpans: options.rowSpans ?? working.table.rowSpans
    },
    true
  )
  const bounds = expandTableBoundsForInsert(working.bounds, working.table, next)
  return replaceWorkingTable(annotation, role, next, bounds)
}

export const applyTableCellEdit = (
  text: string,
  color = store.tableCellEditor.color,
  fontSize = store.tableCellEditor.fontSize
) => {
  const editor = store.tableCellEditor
  const annotation = editor.annotationId ? getAnnotation(editor.annotationId) : undefined
  const working = annotation ? getWorkingTable(annotation, editor.sheetTableRole) : null
  if (!annotation || !working) {
    return false
  }

  const next = setTableCellText(working.table, editor.row, editor.col, text, color, fontSize)
  const ok = replaceWorkingTable(annotation, editor.sheetTableRole, next, working.bounds)
  closeTableCellEditor()
  return ok
}

export const applyTableInsert = (kind: 'row' | 'col') => {
  const editor = store.tableCellEditor
  const annotation = editor.annotationId ? getAnnotation(editor.annotationId) : undefined
  const working = annotation ? getWorkingTable(annotation, editor.sheetTableRole) : null
  if (!annotation || !working) {
    return false
  }

  const before = working.table
  if (kind === 'row' && before.rows >= MAX_TABLE_ROWS) {
    ElMessage.warning(`Bảng đã đạt tối đa ${MAX_TABLE_ROWS} hàng.`)
    return false
  }
  if (kind === 'col' && before.cols >= MAX_TABLE_COLS) {
    ElMessage.warning(`Bảng đã đạt tối đa ${MAX_TABLE_COLS} cột.`)
    return false
  }

  const withCell = setTableCellText(
    before,
    editor.row,
    editor.col,
    editor.text,
    editor.color,
    editor.fontSize
  )
  const next =
    kind === 'row'
      ? insertTableRowAfter(withCell, editor.row)
      : insertTableColumnAfter(withCell, editor.col)
  const bounds = expandTableBoundsForInsert(working.bounds, before, next)
  const ok = replaceWorkingTable(annotation, editor.sheetTableRole, next, bounds)
  closeTableCellEditor()
  return ok
}

export const applyTableRemove = (kind: 'row' | 'col') => {
  const editor = store.tableCellEditor
  const annotation = editor.annotationId ? getAnnotation(editor.annotationId) : undefined
  const working = annotation ? getWorkingTable(annotation, editor.sheetTableRole) : null
  if (!annotation || !working) {
    return false
  }

  const before = working.table
  if (kind === 'row' && before.rows <= 1) {
    ElMessage.warning('Bảng chỉ còn 1 hàng, không xóa được.')
    return false
  }
  if (kind === 'col' && before.cols <= 1) {
    ElMessage.warning('Bảng chỉ còn 1 cột, không xóa được.')
    return false
  }

  const next =
    kind === 'row' ? removeTableRowAt(before, editor.row) : removeTableColumnAt(before, editor.col)
  const bounds = expandTableBoundsForInsert(working.bounds, before, next)
  const ok = replaceWorkingTable(annotation, editor.sheetTableRole, next, bounds)
  closeTableCellEditor()
  return ok
}

export const applyTableMerge = (kind: 'row' | 'col') => {
  const editor = store.tableCellEditor
  const annotation = editor.annotationId ? getAnnotation(editor.annotationId) : undefined
  const working = annotation ? getWorkingTable(annotation, editor.sheetTableRole) : null
  if (!annotation || !working) {
    return false
  }

  const count = Math.max(2, Math.round(Number(editor.mergeCount) || 2))
  store.tableCellEditor.mergeCount = count
  if (tableHasTitle(working.table) && editor.row === 0) {
    ElMessage.warning('Hàng tiêu đề đã gộp hết các cột.')
    return false
  }

  const withCell = setTableCellText(
    working.table,
    editor.row,
    editor.col,
    editor.text,
    editor.color,
    editor.fontSize
  )
  const next = mergeTableCells(withCell, editor.row, editor.col, kind, count)
  const beforeMerge = getCellMerge(withCell, editor.row, editor.col)
  const afterMerge = getCellMerge(next, editor.row, editor.col)
  if (afterMerge.colSpan === beforeMerge.colSpan && afterMerge.rowSpan === beforeMerge.rowSpan) {
    ElMessage.warning(
      kind === 'row'
        ? 'Không gộp được theo hàng. Kiểm tra số ô hoặc ô đã gộp bên cạnh.'
        : 'Không gộp được theo cột. Kiểm tra số ô hoặc ô đã gộp bên cạnh.'
    )
    return false
  }

  const ok = replaceWorkingTable(annotation, editor.sheetTableRole, next, working.bounds)
  closeTableCellEditor()
  return ok
}

export const applyTableUnmerge = () => {
  const editor = store.tableCellEditor
  const annotation = editor.annotationId ? getAnnotation(editor.annotationId) : undefined
  const working = annotation ? getWorkingTable(annotation, editor.sheetTableRole) : null
  if (!annotation || !working) {
    return false
  }
  if (tableHasTitle(working.table) && editor.row === 0) {
    ElMessage.warning('Không tách hàng tiêu đề.')
    return false
  }

  const next = unmergeTableCells(working.table, editor.row, editor.col)
  const beforeMerge = getCellMerge(working.table, editor.row, editor.col)
  const afterMerge = getCellMerge(next, editor.row, editor.col)
  if (afterMerge.colSpan === beforeMerge.colSpan && afterMerge.rowSpan === beforeMerge.rowSpan) {
    ElMessage.warning('Ô này chưa được gộp.')
    return false
  }

  const ok = replaceWorkingTable(annotation, editor.sheetTableRole, next, working.bounds)
  closeTableCellEditor()
  return ok
}

export const startEditAtClient = async (clientX: number, clientY: number, shiftKey = false) => {
  const now = performance.now()
  if (now - lastEditAt < 250) {
    return
  }
  lastEditAt = now
  lastEditClient = { x: clientX, y: clientY }

  if (isBusy() && !store.tableCellEditor.visible) {
    return
  }

  if (store.activeDrawTool === 'move') {
    cancelPointerMove()
    deactivateMoveMode()
  }

  const view = AcApDocManager.instance.curView
  const world = clientToWorld(clientX, clientY)
  const textHit = collectTextLikeHits(world, worldSizeFromPixels(view, 5), clientX, clientY)
  if (textHit) {
    if (textHit.kind === 'table') {
      if (shiftKey) {
        closeTableCellEditor()
        editTable(textHit.annotation)
        return
      }
      openTableCellEditor(textHit.annotation, textHit.row, textHit.col)
      return
    }
    if (textHit.kind === 'sheet-table') {
      if (shiftKey) {
        closeTableCellEditor()
        editTable(textHit.annotation, textHit.role)
        return
      }
      openTableCellEditor(textHit.annotation, textHit.row, textHit.col, textHit.role)
      return
    }
    if (textHit.kind === 'sheet') {
      editSheetText(textHit.annotation, textHit.entityId)
      return
    }
    editText(textHit.annotation)
    return
  }

  if (isBusy()) {
    return
  }

  const annotation =
    view
      .pick(view.viewportToCanvas({ x: clientX, y: clientY }), 24, false)
      .map((hit) => findAnnotationByEntityId(hit.id))
      .find((item): item is DrawAnnotation => Boolean(item)) ??
    adoptCadEntityAtWorld(view, world, clientX, clientY)

  if (!annotation) {
    ElMessage.warning('Không tìm thấy đường, vùng, điểm, hình tròn hoặc chữ tại vị trí này.')
    return
  }

  editing = true
  try {
    if (annotation.kind === 'text') {
      editText(annotation)
    } else if (annotation.kind === 'point') {
      await editPoint(annotation)
    } else if (annotation.kind === 'circle') {
      await editCircle(annotation)
    } else if (annotation.kind === 'scale') {
      editScale(annotation)
    } else if (annotation.kind === 'grid') {
      await editGrid(annotation)
    } else if (annotation.kind === 'table' && annotation.bounds && annotation.table) {
      const cell = hitTableCell(annotation.bounds, annotation.table, world) ?? { row: 0, col: 0 }
      openTableCellEditor(annotation, cell.row, cell.col)
    } else if (annotation.kind === 'sheet') {
      await editSheet(annotation)
    } else if (annotation.fileEdit === 'none') {
      ElMessage.warning('Đối tượng này chỉ kéo để di chuyển được.')
    } else {
      await editPath(annotation)
    }
  } finally {
    editing = false
    if (
      store.activeDrawTool === 'line' ||
      store.activeDrawTool === 'region' ||
      store.activeDrawTool === 'point' ||
      store.activeDrawTool === 'circle' ||
      store.activeDrawTool === 'grid' ||
      store.activeDrawTool === 'sheet'
    ) {
      store.activeDrawTool = null
    }
  }
}

const isOnDrawChrome = (target: EventTarget | null) => {
  if (!(target instanceof Element)) {
    return false
  }
  if (target.closest('.draw-tools__move-layer')) {
    return false
  }
  return Boolean(
    target.closest('.draw-tools') ||
      target.closest('.draw-tools__text-popup') ||
      target.closest('.draw-tools__table-popup') ||
      target.closest('.draw-tools__object-menu') ||
      target.closest('.draw-tools__paste-popup') ||
      target.closest('.draw-tools__paste-mask') ||
      target.closest('.viewer-toolbar') ||
      target.closest('.el-overlay') ||
      target.closest('.el-popper') ||
      target.closest('.el-message') ||
      target.closest('.el-dialog')
  )
}

const isOnViewerCanvas = (target: EventTarget | null) => {
  if (!(target instanceof Node)) {
    return false
  }

  if (target instanceof Element && target.closest('.draw-tools__move-layer')) {
    return true
  }

  try {
    const canvas = AcApDocManager.instance.curView.canvas
    if (target instanceof Element) {
      return (
        canvas.contains(target) ||
        Boolean(target.closest('.viewer-screen')) ||
        Boolean(target.closest('canvas'))
      )
    }
    return canvas.contains(target)
  } catch {
    return false
  }
}

const worldToClient = (x: number, y: number) => {
  const view = AcApDocManager.instance.curView
  return view.canvasToViewport(view.worldToScreen({ x, y }))
}

const tableEdgeGuideStyle = (
  hit: TableEdgeHit,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  world: { x: number; y: number }
) => {
  if (hit.axis === 'col') {
    const a = worldToClient(world.x, bounds.minY)
    const b = worldToClient(world.x, bounds.maxY)
    return {
      left: `${Math.min(a.x, b.x) - 1}px`,
      top: `${Math.min(a.y, b.y)}px`,
      width: '2px',
      height: `${Math.max(Math.abs(b.y - a.y), 2)}px`
    }
  }

  const a = worldToClient(bounds.minX, world.y)
  const b = worldToClient(bounds.maxX, world.y)
  return {
    left: `${Math.min(a.x, b.x)}px`,
    top: `${Math.min(a.y, b.y) - 1}px`,
    width: `${Math.max(Math.abs(b.x - a.x), 2)}px`,
    height: '2px'
  }
}

const findTableEdgeAtClient = (clientX: number, clientY: number) => {
  const view = AcApDocManager.instance.curView
  const world = clientToWorld(clientX, clientY)
  const pad = worldSizeFromPixels(view, 8)
  let best:
    | {
        annotation: DrawAnnotation
        sheetTableRole: SheetTableRole | null
        hit: TableEdgeHit
        bounds: { minX: number; minY: number; maxX: number; maxY: number }
        table: TableDrawOptions
        world: { x: number; y: number }
      }
    | undefined

  for (const annotation of listAnnotations()) {
    if (annotation.kind === 'table' && annotation.bounds && annotation.table) {
      const hit = hitTableEdge(annotation.bounds, annotation.table, world, pad)
      if (hit && (!best || hit.dist < best.hit.dist)) {
        best = {
          annotation,
          sheetTableRole: null,
          hit,
          bounds: annotation.bounds,
          table: annotation.table,
          world
        }
      }
      continue
    }
    if (annotation.kind !== 'sheet' || isFileAnnotation(annotation)) {
      continue
    }
    for (const role of ['note', 'legend'] as SheetTableRole[]) {
      const working = resolveSheetTable(annotation, role)
      if (!working) {
        continue
      }
      const hit = hitTableEdge(working.bounds, working.table, world, pad)
      if (hit && (!best || hit.dist < best.hit.dist)) {
        best = {
          annotation,
          sheetTableRole: role,
          hit,
          bounds: working.bounds,
          table: working.table,
          world
        }
      }
    }
  }

  return best
}

const setTableResizeCursor = (cursor: 'col-resize' | 'row-resize' | '') => {
  store.tableResize.cursor = cursor
  document.body.style.cursor = cursor
  try {
    AcApDocManager.instance.curView.canvas.style.cursor = cursor
  } catch {
    // Cursor is optional.
  }
}

const clearTableResizeUi = () => {
  store.tableResize.dragging = false
  store.tableResize.guide = null
  setTableResizeCursor('')
}

const cancelTableResize = () => {
  tableResizeDrag = null
  clearTableResizeUi()
}

const handleTableResizePointerDown = (event: PointerEvent) => {
  if (event.button !== 0 || tableResizeDrag) {
    return
  }
  if (isCollectingPoints() || editing || store.activeDrawTool === 'move') {
    return
  }
  if (store.tableCellEditor.visible || store.textEditor.visible) {
    return
  }
  if (isOnDrawChrome(event.target) || !isOnViewerCanvas(event.target)) {
    return
  }

  const found = findTableEdgeAtClient(event.clientX, event.clientY)
  if (!found) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  tableResizeDrag = {
    pointerId: event.pointerId,
    annotationId: found.annotation.id,
    sheetTableRole: found.sheetTableRole,
    hit: found.hit,
    bounds: { ...found.bounds },
    table: found.table,
    startClient: { x: event.clientX, y: event.clientY }
  }
  store.tableResize.dragging = true
  store.tableResize.guide = tableEdgeGuideStyle(found.hit, found.bounds, found.world)
  setTableResizeCursor(found.hit.axis === 'col' ? 'col-resize' : 'row-resize')
}

const handleTableResizePointerMove = (event: PointerEvent) => {
  if (!tableResizeDrag || event.pointerId !== tableResizeDrag.pointerId) {
    return
  }
  const world = clientToWorld(event.clientX, event.clientY)
  store.tableResize.guide = tableEdgeGuideStyle(tableResizeDrag.hit, tableResizeDrag.bounds, world)
  event.preventDefault()
  event.stopPropagation()
}

const handleTableResizeHoverCursor = (event: PointerEvent) => {
  if (tableResizeDrag) {
    return
  }
  if (isCollectingPoints() || editing || store.activeDrawTool === 'move' || store.tableCellEditor.visible) {
    if (store.tableResize.cursor) {
      setTableResizeCursor('')
    }
    return
  }
  if (isOnDrawChrome(event.target) || !isOnViewerCanvas(event.target)) {
    if (store.tableResize.cursor) {
      setTableResizeCursor('')
    }
    return
  }

  const found = findTableEdgeAtClient(event.clientX, event.clientY)
  setTableResizeCursor(found ? (found.hit.axis === 'col' ? 'col-resize' : 'row-resize') : '')
}

const handleTableResizePointerUp = (event: PointerEvent) => {
  if (!tableResizeDrag || event.pointerId !== tableResizeDrag.pointerId) {
    return
  }

  const current = tableResizeDrag
  tableResizeDrag = null
  store.tableResize.dragging = false
  store.tableResize.guide = null
  event.preventDefault()
  event.stopPropagation()

  const moved = Math.hypot(event.clientX - current.startClient.x, event.clientY - current.startClient.y)
  const annotation = getAnnotation(current.annotationId)
  if (moved >= 3 && annotation) {
    const minSize = worldSizeFromPixels(AcApDocManager.instance.curView, 16)
    const world = clientToWorld(event.clientX, event.clientY)
    const next = applyTableEdgeResize(current.bounds, current.table, current.hit, world, minSize)
    replaceWorkingTable(annotation, current.sheetTableRole, next.options, next.bounds)
  }

  const still = findTableEdgeAtClient(event.clientX, event.clientY)
  setTableResizeCursor(still ? (still.hit.axis === 'col' ? 'col-resize' : 'row-resize') : '')
}

const handleTableResizePointerCancel = (event: PointerEvent) => {
  if (!tableResizeDrag || event.pointerId !== tableResizeDrag.pointerId) {
    return
  }
  cancelTableResize()
}

const isTypingTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true
  }
  if (target.isContentEditable) {
    return true
  }
  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

const handleTableResizeKeyDown = (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey && !event.altKey) {
    if (isTypingTarget(event.target)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    if (tableResizeDrag) {
      cancelTableResize()
      return
    }
    if (isPointerMoving()) {
      cancelPointerMove()
      return
    }
    undoDraw()
    return
  }

  if (event.key !== 'Escape') {
    return
  }
  if (tableResizeDrag) {
    cancelTableResize()
    return
  }
  if (store.pasteLayerPicker.visible) {
    closeCopyPasteUi()
  }
}

const resolveTextEditAtClient = (clientX: number, clientY: number) => {
  const view = AcApDocManager.instance.curView
  const world = clientToWorld(clientX, clientY)
  const pad = worldSizeFromPixels(view, 5)
  const hit = collectTextLikeHits(world, pad, clientX, clientY)
  if (hit) {
    return hit
  }

  const adopted = adoptCadEntityAtWorld(view, world, clientX, clientY)
  if (adopted?.kind === 'text') {
    const entity = adopted.entityIds[0] ? getCadEntityById(adopted.entityIds[0]) : undefined
    if (entity && isCadTextEntity(entity) && entityGlyphHit(entity, world, pad * 2)) {
      return { kind: 'text' as const, annotation: adopted }
    }
  }

  return undefined
}

export const startTextEditForAnnotation = (
  annotation: DrawAnnotation,
  clientX: number,
  clientY: number
) => {
  lastEditClient = { x: clientX, y: clientY }
  if (store.activeDrawTool === 'move') {
    cancelPointerMove()
    deactivateMoveMode()
  }
  if (annotation.kind !== 'text') {
    return false
  }
  editText(annotation)
  return true
}

export const startTextEditAtClient = (clientX: number, clientY: number) => {
  lastEditClient = { x: clientX, y: clientY }

  if (store.activeDrawTool === 'move') {
    cancelPointerMove()
    deactivateMoveMode()
  }

  const target = resolveTextEditAtClient(clientX, clientY)
  if (!target) {
    return false
  }

  if (target.kind === 'table') {
    openTableCellEditor(target.annotation, target.row, target.col)
    return true
  }

  if (target.kind === 'sheet-table') {
    openTableCellEditor(target.annotation, target.row, target.col, target.role)
    return true
  }

  if (target.kind === 'sheet') {
    editSheetText(target.annotation, target.entityId)
    return true
  }

  editText(target.annotation)
  return true
}

const handleDocumentDoubleClick = (event: MouseEvent) => {
  if (isBusy()) {
    return
  }

  if (isOnDrawChrome(event.target) || !isOnViewerCanvas(event.target)) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
  void startEditAtClient(event.clientX, event.clientY, event.shiftKey)
}

const handleDocumentContextMenu = (event: MouseEvent) => {
  if (editing) {
    return
  }

  if (isOnDrawChrome(event.target)) {
    return
  }

  if (store.tableCellEditor.visible || store.textEditor.visible) {
    return
  }

  const textTarget = resolveTextEditAtClient(event.clientX, event.clientY)
  if (textTarget?.kind === 'table') {
    if (!startTextEditAtClient(event.clientX, event.clientY)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    return
  }

  closeCopyPasteUi()
  if (
    !openObjectContextMenu(
      event.clientX,
      event.clientY,
      textTarget?.kind === 'text' || textTarget?.kind === 'sheet' || textTarget?.kind === 'sheet-table'
        ? textTarget.annotation
        : undefined,
      {
        canEditText:
          textTarget?.kind === 'sheet' ||
          textTarget?.kind === 'sheet-table' ||
          textTarget?.kind === 'text'
      }
    )
  ) {
    return
  }

  event.preventDefault()
  event.stopPropagation()
}

let boundCanvas: HTMLElement | null = null

export const bindDrawEditing = () => {
  unbindDrawEditing()
  document.addEventListener('dblclick', handleDocumentDoubleClick, true)
  document.addEventListener('contextmenu', handleDocumentContextMenu, true)
  document.addEventListener('pointerdown', handleTableResizePointerDown, true)
  document.addEventListener('pointermove', handleTableResizePointerMove, true)
  document.addEventListener('pointermove', handleTableResizeHoverCursor)
  document.addEventListener('pointerup', handleTableResizePointerUp, true)
  document.addEventListener('pointercancel', handleTableResizePointerCancel, true)
  window.addEventListener('keydown', handleTableResizeKeyDown, true)
  try {
    boundCanvas = AcApDocManager.instance.curView.canvas
    boundCanvas.addEventListener('contextmenu', handleDocumentContextMenu, true)
  } catch {
    boundCanvas = null
  }
  bindDrawMoving()
  bound = true
}

export const unbindDrawEditing = () => {
  unbindDrawMoving()
  cancelTableResize()
  closeCopyPasteUi()
  document.removeEventListener('dblclick', handleDocumentDoubleClick, true)
  document.removeEventListener('contextmenu', handleDocumentContextMenu, true)
  document.removeEventListener('pointerdown', handleTableResizePointerDown, true)
  document.removeEventListener('pointermove', handleTableResizePointerMove, true)
  document.removeEventListener('pointermove', handleTableResizeHoverCursor)
  document.removeEventListener('pointerup', handleTableResizePointerUp, true)
  document.removeEventListener('pointercancel', handleTableResizePointerCancel, true)
  window.removeEventListener('keydown', handleTableResizeKeyDown, true)
  boundCanvas?.removeEventListener('contextmenu', handleDocumentContextMenu, true)
  boundCanvas = null
  bound = false
}
