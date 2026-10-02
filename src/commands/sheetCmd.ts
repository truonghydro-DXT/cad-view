import { AcEdCommand, AcEdOpenMode, type AcApContext } from '@mlightcad/cad-simple-viewer'
import {
  AcDbLine,
  AcDbMText,
  AcGePoint2d,
  AcGiMTextAttachmentPoint,
  type AcDbEntity
} from '@mlightcad/data-model'

import {
  collectEntityIds,
  createAnnotationId,
  eraseAnnotationEntities,
  registerAnnotation,
  type DrawAnnotation
} from './annotationRegistry'
import { recordDrawUndo } from './drawUndoStack'
import {
  appendEntity,
  buildPolyline,
  collectRectangle,
  colorFromSpec,
  worldSizeFromPixels,
  FOREGROUND_COLOR
} from './drawHelpers'
import { DRAW_LAYER_BY_TOOL, getActiveDrawLayer } from './drawLayers'
import { formatGridCoordinate, gridTicksForFrame } from './gridCmd'
import { applyStrokeStyle } from './lineTypes'
import { formatScaleDistance, formatScaleRatio, metersPerDrawingUnit } from './scaleCmd'
import { applyTableTextStyle, DEFAULT_TABLE_FONT, formatMTextContents } from './textStyles'
import {
  appendTableEntities,
  expandTableBoundsForInsert,
  normalizeTableOptions,
  type TableDrawInput,
  type TableDrawOptions
} from './tableCmd'
import { store } from '../store'

export const DEFAULT_SHEET_COLOR = FOREGROUND_COLOR
export const TEMPLATE_SPAN = 379

export type SheetTableRole = 'note' | 'legend'

export type SheetTableBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export type SheetTableFrame = SheetTableBounds & {
  prefix: SheetTableRole
  rows: number
  cols: number
  titleRows: number
}

export const DEFAULT_SHEET_TABLE_SIZE: Record<SheetTableRole, { rows: number; cols: number; title: string }> = {
  note: { rows: 10, cols: 16, title: 'GHI CHÚ CÁC THỬA ĐẤT NHỎ' },
  legend: { rows: 14, cols: 6, title: 'BẢNG CÁC THỬA ĐẤT CẦN CHỈNH LÝ' }
}

const NOTE_TABLE_CELLS = () => {
  const cols = 16
  return [
    ['GHI CHÚ CÁC THỬA ĐẤT NHỎ', ...Array.from({ length: cols - 1 }, () => '')],
    ['Thửa số', ...Array.from({ length: cols - 1 }, () => '')],
    ['Diện tích', ...Array.from({ length: cols - 1 }, () => '')],
    ['Loại đất', ...Array.from({ length: cols - 1 }, () => '')],
    ['Thửa số', ...Array.from({ length: cols - 1 }, () => '')],
    ['Diện tích', ...Array.from({ length: cols - 1 }, () => '')],
    ['Loại đất', ...Array.from({ length: cols - 1 }, () => '')],
    ['Thửa số', ...Array.from({ length: cols - 1 }, () => '')],
    ['Diện tích', ...Array.from({ length: cols - 1 }, () => '')],
    ['Loại đất', ...Array.from({ length: cols - 1 }, () => '')]
  ]
}

const LEGEND_TABLE_CELLS = () => [
  ['BẢNG CÁC THỬA ĐẤT CẦN CHỈNH LÝ', '', '', '', '', ''],
  ['TT', 'Thửa thêm', 'Gốc thửa', 'Lân cận', 'TT', 'Thửa bỏ'],
  ...Array.from({ length: 12 }, () => ['', '', '', '', '', ''])
]

export const sheetOuterFrame = (gridFrame: SheetTableBounds) => {
  const mapW = gridFrame.maxX - gridFrame.minX
  const mapH = gridFrame.maxY - gridFrame.minY
  const maxSide = Math.max(mapW, mapH)
  const u = maxSide / TEMPLATE_SPAN
  const gap = Math.max(maxSide * 0.0143, u * 5.4)
  return {
    minX: gridFrame.minX - gap,
    minY: gridFrame.minY - gap,
    maxX: gridFrame.maxX + gap,
    maxY: gridFrame.maxY + gap,
    u,
    gap
  }
}

export const sheetTableFrames = (
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): SheetTableFrame[] => {
  const mapW = maxX - minX
  const mapH = maxY - minY
  const maxSide = Math.max(mapW, mapH)
  const u = maxSide / TEMPLATE_SPAN
  const gap = Math.max(maxSide * 0.0143, u * 5.4)
  const outerMinY = minY - gap
  const outerMaxX = maxX + gap
  const noteTop = outerMinY - u * 22
  const noteBottom = noteTop - u * 58
  const legendMinX = outerMaxX + u * 8
  const legendMaxX = legendMinX + u * 52
  const legendMaxY = maxY
  const legendMinY = legendMaxY - u * 52
  return [
    {
      prefix: 'note',
      minX,
      minY: noteBottom,
      maxX,
      maxY: noteTop,
      rows: 10,
      cols: 16,
      titleRows: 1
    },
    {
      prefix: 'legend',
      minX: legendMinX,
      minY: legendMinY,
      maxX: legendMaxX,
      maxY: legendMaxY,
      rows: 14,
      cols: 6,
      titleRows: 1
    }
  ]
}

export const hitSheetTableCell = (frame: SheetTableFrame, world: { x: number; y: number }) => {
  const width = frame.maxX - frame.minX
  const height = frame.maxY - frame.minY
  if (width <= 1e-6 || height <= 1e-6) {
    return null
  }
  if (
    world.x < frame.minX ||
    world.x > frame.maxX ||
    world.y < frame.minY ||
    world.y > frame.maxY
  ) {
    return null
  }

  const col = Math.min(
    frame.cols - 1,
    Math.max(0, Math.floor(((world.x - frame.minX) / width) * frame.cols))
  )
  const row = Math.min(
    frame.rows - 1,
    Math.max(0, Math.floor(((frame.maxY - world.y) / height) * frame.rows))
  )
  const cellCol = frame.titleRows > 0 && row === 0 ? 0 : col
  return {
    row,
    col: cellCol,
    role: `${frame.prefix}-${row}-${cellCol}`
  }
}

export const defaultSheetTableCellText = (role: string) => {
  const match = /^(note|legend)-(\d+)-(\d+)$/.exec(role)
  if (!match) {
    return ''
  }
  const cells = match[1] === 'note' ? NOTE_TABLE_CELLS() : LEGEND_TABLE_CELLS()
  return cells[Number(match[2])]?.[Number(match[3])] ?? ''
}

const SHEET_TABLE_FONT_SIZE = 18
const SHEET_TABLE_FIT = 0.42

const withSheetTableStyle = (table: TableDrawInput): TableDrawInput => ({
  ...table,
  font: table.font || DEFAULT_TABLE_FONT,
  fontSize: table.fitToCell ? table.fontSize || SHEET_TABLE_FONT_SIZE : SHEET_TABLE_FONT_SIZE,
  fitToCell: table.fitToCell ?? SHEET_TABLE_FIT
})

const defaultSheetTableInput = (role: SheetTableRole) => {
  const cells = role === 'note' ? NOTE_TABLE_CELLS() : LEGEND_TABLE_CELLS()
  const size = DEFAULT_SHEET_TABLE_SIZE[role]
  return withSheetTableStyle({
    rows: size.rows,
    cols: size.cols,
    title: size.title,
    headers: [...(cells[1] ?? [])],
    cells,
    font: DEFAULT_TABLE_FONT,
    fontSize: SHEET_TABLE_FONT_SIZE
  })
}

export const resolveSheetTableOptions = (
  options: SheetDrawOptions | undefined,
  role: SheetTableRole
): TableDrawOptions => {
  const stored = options?.tables?.[role]
  if (stored) {
    return normalizeTableOptions(withSheetTableStyle(stored))
  }

  const table = normalizeTableOptions(defaultSheetTableInput(role))
  const labels = options?.labels ?? {}
  for (const [key, value] of Object.entries(labels)) {
    const match = new RegExp(`^${role}-(\\d+)-(\\d+)$`).exec(key)
    if (!match) {
      continue
    }
    const row = Number(match[1])
    const col = Number(match[2])
    if (!table.cells[row]) {
      continue
    }
    table.cells[row][col] = value ?? ''
    if (row === 0 && col === 0) {
      table.title = (value ?? table.title).trim()
    }
  }
  return normalizeTableOptions(table)
}

export const resolveSheetTable = (
  annotation: { sheet?: SheetDrawOptions; gridFrame?: SheetTableBounds; sheetTables?: SheetTableFrame[] },
  role: SheetTableRole
) => {
  const options = annotation.sheet
  const table = resolveSheetTableOptions(options, role)
  const stored = options?.tableBounds?.[role]
  const fallback =
    annotation.sheetTables?.find((frame) => frame.prefix === role) ??
    (annotation.gridFrame
      ? sheetTableFrames(
          annotation.gridFrame.minX,
          annotation.gridFrame.minY,
          annotation.gridFrame.maxX,
          annotation.gridFrame.maxY
        ).find((frame) => frame.prefix === role)
      : undefined)
  const base = stored ??
    (fallback
      ? { minX: fallback.minX, minY: fallback.minY, maxX: fallback.maxX, maxY: fallback.maxY }
      : null)
  if (!base) {
    return null
  }
  const bounds = stored
    ? base
    : expandTableBoundsForInsert(base, DEFAULT_SHEET_TABLE_SIZE[role], table)
  return { role, table, bounds }
}

export const shiftSheetTableBounds = (
  bounds: Partial<Record<SheetTableRole, SheetTableBounds>> | undefined,
  dx: number,
  dy: number
) => {
  if (!bounds) {
    return undefined
  }
  const next: Partial<Record<SheetTableRole, SheetTableBounds>> = {}
  for (const role of ['note', 'legend'] as SheetTableRole[]) {
    const item = bounds[role]
    if (!item) {
      continue
    }
    next[role] = {
      minX: item.minX + dx,
      minY: item.minY + dy,
      maxX: item.maxX + dx,
      maxY: item.maxY + dy
    }
  }
  return next
}

export type SheetLabelStyle = {
  fontSize?: number
  color?: string
}

export type SheetPartOffset = {
  dx: number
  dy: number
}

export type SheetMoveTarget =
  | { kind: 'frame' }
  | { kind: 'table'; role: SheetTableRole }
  | { kind: 'label'; role: string }
  | { kind: 'scale' }
  | { kind: 'neighbor' }

export type SheetDrawOptions = {
  city: string
  title: string
  place: string
  sheetNo: string
  scaleRatio: number
  gridSpacing: number
  surveyUnit: string
  certifyUnit: string
  color: string
  labels?: Record<string, string>
  labelStyles?: Record<string, SheetLabelStyle>
  labelOffsets?: Record<string, SheetPartOffset>
  tables?: Partial<Record<SheetTableRole, TableDrawOptions>>
  tableBounds?: Partial<Record<SheetTableRole, SheetTableBounds>>
  scaleOffset?: SheetPartOffset
  neighborOffset?: SheetPartOffset
}

export const sheetPartKindForRole = (role: string): SheetMoveTarget['kind'] => {
  if (role === 'neighbor' || role === 'sheetNoCell') {
    return 'neighbor'
  }
  if (role === 'scale' || role === 'scaleRatio' || role === 'scaleCm' || role.startsWith('scaleTick-')) {
    return 'scale'
  }
  if (role === 'frame') {
    return 'frame'
  }
  return 'label'
}

export const offsetForSheetRole = (options: SheetDrawOptions | undefined, role: string): SheetPartOffset => {
  const kind = sheetPartKindForRole(role)
  if (kind === 'scale') {
    return options?.scaleOffset ?? { dx: 0, dy: 0 }
  }
  if (kind === 'neighbor') {
    return options?.neighborOffset ?? { dx: 0, dy: 0 }
  }
  if (kind === 'label') {
    return options?.labelOffsets?.[role] ?? { dx: 0, dy: 0 }
  }
  return { dx: 0, dy: 0 }
}

export const applySheetPartMove = (
  options: SheetDrawOptions,
  target: SheetMoveTarget,
  dx: number,
  dy: number,
  tableBounds?: SheetTableBounds
): SheetDrawOptions => {
  if (target.kind === 'frame') {
    return options
  }
  if (target.kind === 'table') {
    const current = options.tableBounds?.[target.role] ?? tableBounds
    if (!current) {
      return options
    }
    return {
      ...options,
      tableBounds: {
        ...options.tableBounds,
        [target.role]: {
          minX: current.minX + dx,
          minY: current.minY + dy,
          maxX: current.maxX + dx,
          maxY: current.maxY + dy
        }
      }
    }
  }
  if (target.kind === 'label') {
    const prev = options.labelOffsets?.[target.role] ?? { dx: 0, dy: 0 }
    return {
      ...options,
      labelOffsets: {
        ...options.labelOffsets,
        [target.role]: { dx: prev.dx + dx, dy: prev.dy + dy }
      }
    }
  }
  if (target.kind === 'scale') {
    const prev = options.scaleOffset ?? { dx: 0, dy: 0 }
    return {
      ...options,
      scaleOffset: { dx: prev.dx + dx, dy: prev.dy + dy }
    }
  }
  const prev = options.neighborOffset ?? { dx: 0, dy: 0 }
  return {
    ...options,
    neighborOffset: { dx: prev.dx + dx, dy: prev.dy + dy }
  }
}

export const sheetLabelText = (options: SheetDrawOptions, role: string, fallback: string) => {
  const labels = options.labels
  if (labels && Object.prototype.hasOwnProperty.call(labels, role)) {
    return labels[role] ?? ''
  }
  return fallback
}

export const applySheetLabelOverride = (
  options: SheetDrawOptions,
  role: string,
  contents: string,
  style?: SheetLabelStyle
): SheetDrawOptions => {
  const labels = { ...(options.labels ?? {}) }
  const labelStyles = { ...(options.labelStyles ?? {}) }
  const next: SheetDrawOptions = { ...options, labels, labelStyles }
  const text = contents.trim()

  const setSheetNo = (value: string) => {
    next.sheetNo = value.replace(/^TỜ\s*SỐ\s*/i, '').trim() || value.trim()
    delete labels.sheetNoCell
    delete labels.sheetNoBanner
    delete labels.sheetNoSide
  }

  if (role === 'city') {
    next.city = text
    delete labels.city
  } else if (role === 'titleLine') {
    labels.titleLine = contents
  } else if (role === 'surveyUnit') {
    next.surveyUnit = text
    delete labels.surveyUnit
  } else if (role === 'certifyUnit') {
    next.certifyUnit = text
    delete labels.certifyUnit
  } else if (role === 'sheetNoCell') {
    setSheetNo(text)
  } else if (role === 'sheetNoBanner' || role === 'sheetNoSide') {
    const match = text.match(/^TỜ\s*SỐ\s*(.+)$/i)
    if (match) {
      setSheetNo(match[1])
    } else {
      labels[role] = contents
    }
  } else {
    labels[role] = contents
  }

  if (style && role) {
    const fontSize = Number(style.fontSize)
    const color = (style.color ?? '').trim()
    labelStyles[role] = {
      ...labelStyles[role],
      ...(Number.isFinite(fontSize) ? { fontSize } : {}),
      ...(color ? { color } : {})
    }
  }

  if (Object.keys(labels).length === 0) {
    delete next.labels
  }
  if (Object.keys(labelStyles).length === 0) {
    delete next.labelStyles
  }

  return next
}

export const inferSheetTextRole = (
  annotation: DrawAnnotation,
  entityId: string,
  contents: string
) => {
  const mapped = annotation.sheetRoles?.[entityId]
  if (mapped) {
    return mapped
  }

  const options = annotation.sheet
  if (!options) {
    return undefined
  }

  const text = contents.trim()
  if (text === options.city.trim()) {
    return 'city'
  }
  const titleText = [options.title, options.place].filter(Boolean).join(' ').trim()
  if (text === titleText) {
    return 'titleLine'
  }
  if (text === options.surveyUnit.trim()) {
    return 'surveyUnit'
  }
  if (text === options.certifyUnit.trim()) {
    return 'certifyUnit'
  }
  if (text === options.sheetNo.trim()) {
    return 'sheetNoCell'
  }
  if (text === `TỜ SỐ ${options.sheetNo}`.trim()) {
    return 'sheetNoBanner'
  }
  return undefined
}

export const getCurrentSheetOptions = (): SheetDrawOptions => ({
  city: store.sheetCity.trim() || 'THÀNH PHỐ HÀ NỘI',
  title: store.sheetTitle.trim() || 'BẢN ĐỒ ĐỊA CHÍNH',
  place: store.sheetPlace.trim(),
  sheetNo: store.sheetNo.trim() || '1',
  scaleRatio: Number.isFinite(store.sheetScaleRatio) ? Math.max(0, store.sheetScaleRatio) : 0,
  gridSpacing: Number.isFinite(store.gridSpacing) ? Math.max(0, store.gridSpacing) : 0,
  surveyUnit: store.sheetSurveyUnit.trim() || 'Đơn vị đo đạc',
  certifyUnit: store.sheetCertifyUnit.trim() || 'Cơ quan xác nhận',
  color: FOREGROUND_COLOR
})

export class AcApDrawSheetCmd extends AcEdCommand {
  constructor() {
    super()
    this.mode = AcEdOpenMode.Write
    this.globalName = 'DRAWSHEET'
    this.localName = 'Ve khung mau'
  }

  async execute(context: AcApContext) {
    const options = getCurrentSheetOptions()
    const frame = await collectSheetFrame(context)
    if (!frame) {
      return
    }
    recordDrawUndo(() => {
      createSheetAnnotation(
        context,
        frame.minX,
        frame.minY,
        frame.maxX,
        frame.maxY,
        options,
        DRAW_LAYER_BY_TOOL.sheet
      )
    })
  }
}

export const collectSheetFrame = async (
  context: AcApContext,
  messages?: { firstMessage: string; nextMessage: string }
) => {
  const points = await collectRectangle(context, {
    firstMessage: messages?.firstMessage ?? 'Click góc thứ nhất của vùng bản đồ trong khung mẫu',
    nextMessage: messages?.nextMessage ?? 'Click góc đối diện để quét vùng và dựng khung mẫu',
    stylePreview: (entity) => {
      applyStrokeStyle(context, entity, FOREGROUND_COLOR, 'Continuous', undefined, 2)
    }
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

const addLine = (
  context: AcApContext,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  color: string,
  layer: string,
  entities: AcDbEntity[],
  strokeWidth: number,
  role?: string,
  roles?: Record<string, string>
) => {
  const line = new AcDbLine({ x: x1, y: y1, z: 0 }, { x: x2, y: y2, z: 0 })
  applyStrokeStyle(context, line, color, 'Continuous', undefined, strokeWidth)
  appendEntity(context, line, layer)
  entities.push(line)
  if (role && roles && line.objectId) {
    roles[String(line.objectId)] = role
  }
}

const addRect = (
  context: AcApContext,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  color: string,
  layer: string,
  entities: AcDbEntity[],
  strokeWidth: number,
  role?: string,
  roles?: Record<string, string>
) => {
  const polyline = buildPolyline(
    [
      new AcGePoint2d(minX, minY),
      new AcGePoint2d(maxX, minY),
      new AcGePoint2d(maxX, maxY),
      new AcGePoint2d(minX, maxY)
    ],
    true
  )
  applyStrokeStyle(context, polyline, color, 'Continuous', undefined, strokeWidth)
  appendEntity(context, polyline, layer)
  entities.push(polyline)
  if (role && roles && polyline.objectId) {
    roles[String(polyline.objectId)] = role
  }
}

const addLabel = (
  context: AcApContext,
  text: string,
  x: number,
  y: number,
  attachment: AcGiMTextAttachmentPoint,
  color: string,
  layer: string,
  entities: AcDbEntity[],
  worldHeight: number,
  rotationDeg = 0,
  style?: SheetLabelStyle
) => {
  if (!text.trim()) {
    return
  }
  const rotation = (rotationDeg * Math.PI) / 180
  const mtext = new AcDbMText()
  const fontSize = Number(style?.fontSize)
  if (Number.isFinite(fontSize) && fontSize > 0) {
    applyTableTextStyle(context, mtext, DEFAULT_TABLE_FONT, 18)
    mtext.height = worldSizeFromPixels(context.view, Math.max(8, Math.min(200, fontSize)))
  } else {
    applyTableTextStyle(context, mtext, DEFAULT_TABLE_FONT, 18, worldHeight)
  }
  mtext.contents = formatMTextContents(text.trim(), DEFAULT_TABLE_FONT)
  mtext.width = mtext.height * Math.max(text.trim().length, 2) * 1.4
  mtext.location = { x, y, z: 0 }
  mtext.rotation = rotation
  mtext.direction = { x: Math.cos(rotation), y: Math.sin(rotation), z: 0 }
  mtext.attachmentPoint = attachment
  mtext.color = colorFromSpec(style?.color?.trim() || color)
  appendEntity(context, mtext, layer)
  entities.push(mtext)
}

const splitCoordLabel = (value: number, spacing: number) => {
  if (Math.abs(value) < 1000) {
    return { prefix: '', rest: formatGridCoordinate(value, spacing) }
  }
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  const prefix = `${sign}${Math.floor(abs / 1000)}`
  const rest = String(Math.round(abs % 1000)).padStart(3, '0')
  return { prefix, rest }
}

type AddSheetLabel = (
  role: string,
  text: string,
  x: number,
  y: number,
  attachment: AcGiMTextAttachmentPoint,
  worldHeight: number,
  rotationDeg?: number
) => void

export const createSheetAnnotation = (
  context: AcApContext,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  options: SheetDrawOptions = getCurrentSheetOptions(),
  layer = getActiveDrawLayer(DRAW_LAYER_BY_TOOL.sheet),
  annotationId?: string
) => {
  const mapW = maxX - minX
  const mapH = maxY - minY
  const maxSide = Math.max(mapW, mapH)
  const u = maxSide / TEMPLATE_SPAN
  const gap = Math.max(maxSide * 0.0143, u * 5.4)
  const color = FOREGROUND_COLOR
  const outerMinX = minX - gap
  const outerMinY = minY - gap
  const outerMaxX = maxX + gap
  const outerMaxY = maxY + gap
  const entities: AcDbEntity[] = []
  const sheetRoles: Record<string, string> = {}
  const addTaggedLabel: AddSheetLabel = (role, text, x, y, attachment, worldHeight, rotationDeg = 0) => {
    const before = entities.length
    const shift = offsetForSheetRole(options, role)
    addLabel(
      context,
      sheetLabelText(options, role, text),
      x + shift.dx,
      y + shift.dy,
      attachment,
      color,
      layer,
      entities,
      worldHeight,
      rotationDeg,
      options.labelStyles?.[role]
    )
    const entity = entities[entities.length - 1]
    if (entities.length > before && entity?.objectId) {
      sheetRoles[String(entity.objectId)] = role
    }
  }

  addRect(context, minX, minY, maxX, maxY, color, layer, entities, 2, 'frame', sheetRoles)
  addRect(context, outerMinX, outerMinY, outerMaxX, outerMaxY, color, layer, entities, 6, 'frame', sheetRoles)

  const ticks = gridTicksForFrame(minX, minY, maxX, maxY, options.gridSpacing)
  const tickLen = gap * 0.96
  const cross = Math.min(mapW, mapH) * 0.0085
  const labelH = Math.max(u * 1.15, gap * 0.22)
  const prefixH = labelH * 0.82

  ticks.xs.forEach((x, index) => {
    addLine(context, x, minY, x, minY - tickLen, color, layer, entities, 1, 'frame', sheetRoles)
    addLine(context, x, maxY, x, maxY + tickLen, color, layer, entities, 1, 'frame', sheetRoles)
    const label = splitCoordLabel(x, ticks.spacing)
    addTaggedLabel(`gx-${index}-top`, label.rest, x, maxY + gap * 0.22, AcGiMTextAttachmentPoint.BottomCenter, labelH)
    addTaggedLabel(`gx-${index}-bot`, label.rest, x, minY - gap * 0.22, AcGiMTextAttachmentPoint.TopCenter, labelH)
    if (label.prefix) {
      addTaggedLabel(`gx-${index}-top-prefix`, label.prefix, x, maxY + gap * 0.72, AcGiMTextAttachmentPoint.BottomCenter, prefixH)
      addTaggedLabel(`gx-${index}-bot-prefix`, label.prefix, x, minY - gap * 0.72, AcGiMTextAttachmentPoint.TopCenter, prefixH)
    }
  })

  ticks.ys.forEach((y, index) => {
    addLine(context, minX, y, minX - tickLen, y, color, layer, entities, 1, 'frame', sheetRoles)
    addLine(context, maxX, y, maxX + tickLen, y, color, layer, entities, 1, 'frame', sheetRoles)
    const label = splitCoordLabel(y, ticks.spacing)
    const yPad = gap * 0.16
    addTaggedLabel(`gy-${index}-left`, label.rest, minX - yPad, y, AcGiMTextAttachmentPoint.MiddleRight, labelH)
    addTaggedLabel(`gy-${index}-right`, label.rest, maxX + yPad, y, AcGiMTextAttachmentPoint.MiddleLeft, labelH)
    if (label.prefix) {
      const prefixY = y + labelH * 0.72 + prefixH * 0.62
      addTaggedLabel(`gy-${index}-left-prefix`, label.prefix, minX - yPad, prefixY, AcGiMTextAttachmentPoint.MiddleRight, prefixH)
      addTaggedLabel(`gy-${index}-right-prefix`, label.prefix, maxX + yPad, prefixY, AcGiMTextAttachmentPoint.MiddleLeft, prefixH)
    }
  })

  for (const x of ticks.xs) {
    if (x <= minX + 1e-6 || x >= maxX - 1e-6) {
      continue
    }
    for (const y of ticks.ys) {
      if (y <= minY + 1e-6 || y >= maxY - 1e-6) {
        continue
      }
      addLine(context, x - cross, y, x + cross, y, color, layer, entities, 1, 'frame', sheetRoles)
      addLine(context, x, y - cross, x, y + cross, color, layer, entities, 1, 'frame', sheetRoles)
    }
  }

  const titleText = [options.title, options.place].filter(Boolean).join(' ').trim()
  addTaggedLabel('city', options.city, minX + u * 2, outerMaxY + u * 3.2, AcGiMTextAttachmentPoint.BottomLeft, u * 1.88)
  addTaggedLabel(
    'titleLine',
    titleText,
    (minX + maxX) / 2,
    outerMaxY + u * 7.2,
    AcGiMTextAttachmentPoint.BottomCenter,
    u * 3.5
  )
  addTaggedLabel(
    'sheetNoBanner',
    `TỜ SỐ ${options.sheetNo}`,
    (minX + maxX) / 2 + u * 12,
    outerMaxY + u * 2.6,
    AcGiMTextAttachmentPoint.BottomCenter,
    u * 1.88
  )
  addTaggedLabel(
    'sheetNoSide',
    `TỜ SỐ ${options.sheetNo}`,
    outerMaxX + u * 3.2,
    maxY - u * 2,
    AcGiMTextAttachmentPoint.BottomLeft,
    u * 1.88,
    90
  )

  const neighbor = u * 15
  const nMinX = maxX - neighbor
  const nMaxY = outerMaxY + u * 16
  const nMinY = nMaxY - neighbor
  const nMaxX = nMinX + neighbor
  const nOff = options.neighborOffset ?? { dx: 0, dy: 0 }
  addRect(
    context,
    nMinX + nOff.dx,
    nMinY + nOff.dy,
    nMaxX + nOff.dx,
    nMaxY + nOff.dy,
    color,
    layer,
    entities,
    1,
    'neighbor',
    sheetRoles
  )
  addLine(
    context,
    nMinX + neighbor / 3 + nOff.dx,
    nMinY + nOff.dy,
    nMinX + neighbor / 3 + nOff.dx,
    nMaxY + nOff.dy,
    color,
    layer,
    entities,
    1,
    'neighbor',
    sheetRoles
  )
  addLine(
    context,
    nMinX + (neighbor * 2) / 3 + nOff.dx,
    nMinY + nOff.dy,
    nMinX + (neighbor * 2) / 3 + nOff.dx,
    nMaxY + nOff.dy,
    color,
    layer,
    entities,
    1,
    'neighbor',
    sheetRoles
  )
  addLine(
    context,
    nMinX + nOff.dx,
    nMinY + neighbor / 3 + nOff.dy,
    nMaxX + nOff.dx,
    nMinY + neighbor / 3 + nOff.dy,
    color,
    layer,
    entities,
    1,
    'neighbor',
    sheetRoles
  )
  addLine(
    context,
    nMinX + nOff.dx,
    nMinY + (neighbor * 2) / 3 + nOff.dy,
    nMaxX + nOff.dx,
    nMinY + (neighbor * 2) / 3 + nOff.dy,
    color,
    layer,
    entities,
    1,
    'neighbor',
    sheetRoles
  )
  addTaggedLabel(
    'sheetNoCell',
    options.sheetNo,
    (nMinX + nMaxX) / 2,
    (nMinY + nMaxY) / 2,
    AcGiMTextAttachmentPoint.MiddleCenter,
    u * 1.25
  )

  const metersUnit = metersPerDrawingUnit({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 })
  const mapMeters = maxSide * metersUnit
  const ratio =
    options.scaleRatio > 0
      ? options.scaleRatio
      : mapMeters <= 300
        ? 500
        : mapMeters <= 600
          ? 1000
          : mapMeters <= 1200
            ? 2000
            : 5000
  const barMeters = ratio <= 500 ? 40 : ratio <= 1000 ? 80 : ratio <= 2000 ? 160 : 400
  const worldLength = barMeters / Math.max(metersUnit, 1e-9)
  const barY = outerMinY - u * 12.2
  const barX = (minX + maxX) / 2 - worldLength / 2
  const barH = u * 1.15
  const sOff = options.scaleOffset ?? { dx: 0, dy: 0 }
  addLine(
    context,
    barX + sOff.dx,
    barY + sOff.dy,
    barX + worldLength + sOff.dx,
    barY + sOff.dy,
    color,
    layer,
    entities,
    3,
    'scale',
    sheetRoles
  )
  addLine(
    context,
    barX + sOff.dx,
    barY + barH + sOff.dy,
    barX + worldLength + sOff.dx,
    barY + barH + sOff.dy,
    color,
    layer,
    entities,
    2,
    'scale',
    sheetRoles
  )
  const segments = 4
  const step = worldLength / segments
  for (let index = 0; index <= segments; index += 1) {
    const px = barX + step * index
    addLine(
      context,
      px + sOff.dx,
      barY + sOff.dy,
      px + sOff.dx,
      barY + barH + sOff.dy,
      color,
      layer,
      entities,
      2,
      'scale',
      sheetRoles
    )
    addTaggedLabel(
      `scaleTick-${index}`,
      index === 0 ? '0' : formatScaleDistance((barMeters / segments) * index),
      px,
      barY - u * 0.4,
      AcGiMTextAttachmentPoint.TopCenter,
      u * 1.0
    )
  }
  addTaggedLabel(
    'scaleRatio',
    `TỶ LỆ ${formatScaleRatio(ratio)}`,
    (minX + maxX) / 2,
    outerMinY - u * 4.6,
    AcGiMTextAttachmentPoint.TopCenter,
    u * 1.88
  )
  addTaggedLabel(
    'scaleCm',
    `1 cm trên bản đồ bằng ${(ratio / 100).toLocaleString('vi-VN')} m trên thực địa`,
    (minX + maxX) / 2,
    outerMinY - u * 7.4,
    AcGiMTextAttachmentPoint.TopCenter,
    u * 1.0
  )

  const year = new Date().getFullYear()
  const signY = outerMinY - u * 3.6
  addTaggedLabel('dateSurvey', `Ngày     tháng     năm ${year}`, minX, signY, AcGiMTextAttachmentPoint.TopLeft, u * 1.25)
  addTaggedLabel('surveyUnit', options.surveyUnit, minX, signY - u * 2.2, AcGiMTextAttachmentPoint.TopLeft, u * 1.25)
  addTaggedLabel(
    'dateInvestor',
    `Ngày      tháng      năm ${year}`,
    minX + mapW * 0.28,
    signY,
    AcGiMTextAttachmentPoint.TopLeft,
    u * 1.25
  )
  addTaggedLabel(
    'investorLabel',
    'Đại diện nhà đầu tư',
    minX + mapW * 0.28,
    signY - u * 2.2,
    AcGiMTextAttachmentPoint.TopLeft,
    u * 1.25
  )
  addTaggedLabel(
    'certifyNote',
    'Xác nhận đo vẽ đúng hiện trạng',
    maxX - mapW * 0.32,
    signY,
    AcGiMTextAttachmentPoint.TopLeft,
    u * 1.25
  )
  addTaggedLabel(
    'certifyUnit',
    options.certifyUnit,
    maxX - mapW * 0.32,
    signY - u * 2.2,
    AcGiMTextAttachmentPoint.TopLeft,
    u * 1.25
  )

  const defaultFrames = sheetTableFrames(minX, minY, maxX, maxY)
  const noteTable = resolveSheetTableOptions(options, 'note')
  const legendTable = resolveSheetTableOptions(options, 'legend')
  const noteBounds =
    options.tableBounds?.note ??
    expandTableBoundsForInsert(
      defaultFrames[0],
      DEFAULT_SHEET_TABLE_SIZE.note,
      noteTable
    )
  const legendBounds =
    options.tableBounds?.legend ??
    expandTableBoundsForInsert(
      defaultFrames[1],
      DEFAULT_SHEET_TABLE_SIZE.legend,
      legendTable
    )
  appendTableEntities(
    context,
    noteBounds.minX,
    noteBounds.minY,
    noteBounds.maxX,
    noteBounds.maxY,
    noteTable,
    layer,
    entities
  )
  appendTableEntities(
    context,
    legendBounds.minX,
    legendBounds.minY,
    legendBounds.maxX,
    legendBounds.maxY,
    legendTable,
    layer,
    entities
  )

  const sheet: SheetDrawOptions = {
    ...options,
    tables: { note: noteTable, legend: legendTable },
    tableBounds: { note: noteBounds, legend: legendBounds }
  }
  const sheetTables: SheetTableFrame[] = [
    {
      prefix: 'note',
      ...noteBounds,
      rows: noteTable.rows,
      cols: noteTable.cols,
      titleRows: 1
    },
    {
      prefix: 'legend',
      ...legendBounds,
      rows: legendTable.rows,
      cols: legendTable.cols,
      titleRows: 1
    }
  ]

  registerAnnotation({
    id: annotationId ?? createAnnotationId(),
    kind: 'sheet',
    entityIds: collectEntityIds(entities),
    bounds: {
      minX: Math.min(outerMinX, legendBounds.minX),
      minY: Math.min(outerMinY, noteBounds.minY, legendBounds.minY) - u * 4,
      maxX: Math.max(outerMaxX, legendBounds.maxX),
      maxY: Math.max(outerMaxY, nMaxY) + u * 10
    },
    sheet,
    sheetRoles,
    sheetTables,
    gridFrame: { minX, minY, maxX, maxY },
    layer
  })
}

export const rebuildSheetAnnotation = (
  context: AcApContext,
  annotation: DrawAnnotation,
  options: SheetDrawOptions
) => {
  if (!annotation.gridFrame) {
    return false
  }

  const { minX, minY, maxX, maxY } = annotation.gridFrame
  const layer = annotation.layer
  const id = annotation.id
  eraseAnnotationEntities(annotation)
  createSheetAnnotation(context, minX, minY, maxX, maxY, options, layer, id)
  return true
}
