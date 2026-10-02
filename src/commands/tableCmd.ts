import {
  AcApDocManager,
  AcEdCommand,
  AcEdOpenMode,
  AcEdPreviewJig,
  AcEdPromptPointOptions,
  AcEdPromptStatus,
  type AcApContext,
  type AcEdBaseView
} from '@mlightcad/cad-simple-viewer'
import {
  AcDbEntity,
  AcDbLine,
  AcDbMText,
  AcDbPolyline,
  AcGePoint2d,
  AcGePoint3d,
  AcGiMTextAttachmentPoint,
  type AcGePoint3dLike
} from '@mlightcad/data-model'

import {
  collectEntityIds,
  createAnnotationId,
  registerAnnotation
} from './annotationRegistry'
import { recordDrawUndo } from './drawUndoStack'
import { appendEntity, colorFromSpec, FOREGROUND_COLOR, toPoint2d, worldSizeFromPixels } from './drawHelpers'
import { getActiveDrawLayer } from './drawLayers'
import {
  applyTableTextStyle,
  DEFAULT_TABLE_FONT,
  DEFAULT_TABLE_FONT_SIZE,
  formatMTextContents
} from './textStyles'

export const DEFAULT_TABLE_TEXT_COLOR = FOREGROUND_COLOR
const LEGACY_TABLE_COLOR = '#382418'

export const isAutoTableColor = (value?: string) => {
  const raw = (value ?? '').trim().toLowerCase()
  return !raw || raw === FOREGROUND_COLOR || raw === LEGACY_TABLE_COLOR
}

const normalizeTableColor = (value?: string) => {
  if (isAutoTableColor(value)) {
    return FOREGROUND_COLOR
  }
  const raw = (value ?? '').trim()
  const hex = raw.startsWith('#') ? raw : `#${raw}`
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : FOREGROUND_COLOR
}

export type TableDrawOptions = {
  rows: number
  cols: number
  title: string
  headers: string[]
  cells: string[][]
  cellColors: string[][]
  cellFontSizes: number[][]
  cellColSpans: number[][]
  cellRowSpans: number[][]
  colSpans: number[]
  rowSpans: number[]
  font: string
  fontSize: number
  /** When set, text height is capped to this fraction of the cell height. */
  fitToCell?: number
}

export type TableDrawInput = Omit<
  TableDrawOptions,
  'cells' | 'cellColors' | 'cellFontSizes' | 'cellColSpans' | 'cellRowSpans' | 'colSpans' | 'rowSpans'
> & {
  cells?: string[][]
  cellColors?: string[][]
  cellFontSizes?: number[][]
  cellColSpans?: number[][]
  cellRowSpans?: number[][]
  colSpans?: number[]
  rowSpans?: number[]
}

const DEFAULT_TABLE_SPAN = 1
const MIN_TABLE_SPAN = 1e-6

export const normalizeTableSpans = (count: number, source?: number[]) => {
  const known = (source ?? []).filter((value) => Number.isFinite(value) && value > 0)
  const fallback =
    known.length > 0 ? known.reduce((sum, value) => sum + value, 0) / known.length : DEFAULT_TABLE_SPAN
  return Array.from({ length: Math.max(1, count) }, (_, index) => {
    const value = Number(source?.[index])
    if (!Number.isFinite(value) || value <= 0) {
      return fallback
    }
    return Math.max(MIN_TABLE_SPAN, value)
  })
}

const accumulateTableEdges = (start: number, end: number, weights: number[]) => {
  const total = weights.reduce((sum, weight) => sum + weight, 0) || weights.length
  const span = end - start
  const edges = [start]
  let cursor = start
  for (let index = 0; index < weights.length; index += 1) {
    cursor = index === weights.length - 1 ? end : cursor + (weights[index] / total) * span
    edges.push(cursor)
  }
  return edges
}

export type TableLayout = {
  colEdges: number[]
  rowEdges: number[]
}

export const getTableLayout = (
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  options: Pick<TableDrawOptions, 'cols' | 'rows' | 'colSpans' | 'rowSpans'>
): TableLayout => {
  const colSpans = normalizeTableSpans(options.cols, options.colSpans)
  const rowSpans = normalizeTableSpans(options.rows, options.rowSpans)
  return {
    colEdges: accumulateTableEdges(bounds.minX, bounds.maxX, colSpans),
    rowEdges: accumulateTableEdges(bounds.maxY, bounds.minY, rowSpans)
  }
}

export const tableCellRect = (layout: TableLayout, row: number, col: number, spanCols = 1, spanRows = 1) => {
  const left = layout.colEdges[col] ?? layout.colEdges[0]
  const right =
    layout.colEdges[Math.min(layout.colEdges.length - 1, col + Math.max(1, spanCols))] ??
    layout.colEdges[layout.colEdges.length - 1]
  const top = layout.rowEdges[row] ?? layout.rowEdges[0]
  const bottom =
    layout.rowEdges[Math.min(layout.rowEdges.length - 1, row + Math.max(1, spanRows))] ??
    layout.rowEdges[layout.rowEdges.length - 1]
  return {
    left,
    right,
    top,
    bottom,
    width: right - left,
    height: top - bottom
  }
}

export type TableEdgeHit = {
  axis: 'col' | 'row'
  index: number
  dist: number
}

const considerEdge = (
  best: TableEdgeHit | null,
  axis: TableEdgeHit['axis'],
  index: number,
  dist: number,
  pad: number
) => {
  if (dist > pad) {
    return best
  }
  if (!best || dist < best.dist) {
    return { axis, index, dist }
  }
  return best
}

export const hitTableEdge = (
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  options: TableDrawOptions,
  world: { x: number; y: number },
  pad: number
): TableEdgeHit | null => {
  if (pad <= 0) {
    return null
  }

  const table = normalizeTableOptions(options)
  const layout = getTableLayout(bounds, table)
  const hasTitle = tableHasTitle(table)
  const titleBottom = hasTitle ? (layout.rowEdges[1] ?? bounds.minY) : bounds.maxY
  let best: TableEdgeHit | null = null

  for (let index = 0; index < layout.colEdges.length; index += 1) {
    const x = layout.colEdges[index]
    const isOuter = index === 0 || index === table.cols
    const lineTop = isOuter ? bounds.maxY : titleBottom
    if (world.y < bounds.minY - pad || world.y > lineTop + pad) {
      continue
    }
    best = considerEdge(best, 'col', index, Math.abs(world.x - x), pad)
  }

  for (let index = 0; index < layout.rowEdges.length; index += 1) {
    const y = layout.rowEdges[index]
    if (world.x < bounds.minX - pad || world.x > bounds.maxX + pad) {
      continue
    }
    best = considerEdge(best, 'row', index, Math.abs(world.y - y), pad)
  }

  return best
}

const columnWidthsFromLayout = (layout: TableLayout) =>
  Array.from({ length: layout.colEdges.length - 1 }, (_, index) =>
    Math.max(MIN_TABLE_SPAN, layout.colEdges[index + 1] - layout.colEdges[index])
  )

const rowHeightsFromLayout = (layout: TableLayout) =>
  Array.from({ length: layout.rowEdges.length - 1 }, (_, index) =>
    Math.max(MIN_TABLE_SPAN, layout.rowEdges[index] - layout.rowEdges[index + 1])
  )

export const applyTableEdgeResize = (
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  options: TableDrawOptions,
  hit: TableEdgeHit,
  world: { x: number; y: number },
  minSize: number
) => {
  const table = normalizeTableOptions(options)
  const layout = getTableLayout(bounds, table)
  const minCell = Math.max(MIN_TABLE_SPAN, minSize)
  const nextBounds = { ...bounds }

  if (hit.axis === 'col') {
    const widths = columnWidthsFromLayout(layout)
    if (hit.index === 0) {
      const limit = layout.colEdges[1] - minCell
      nextBounds.minX = Math.min(world.x, limit)
      widths[0] = layout.colEdges[1] - nextBounds.minX
    } else if (hit.index === table.cols) {
      const limit = layout.colEdges[table.cols - 1] + minCell
      nextBounds.maxX = Math.max(world.x, limit)
      widths[table.cols - 1] = nextBounds.maxX - layout.colEdges[table.cols - 1]
    } else {
      const left = layout.colEdges[hit.index - 1]
      const right = layout.colEdges[hit.index + 1]
      const x = Math.min(Math.max(world.x, left + minCell), right - minCell)
      widths[hit.index - 1] = x - left
      widths[hit.index] = right - x
    }
    return {
      bounds: nextBounds,
      options: { ...table, colSpans: widths }
    }
  }

  const heights = rowHeightsFromLayout(layout)
  if (hit.index === 0) {
    const limit = layout.rowEdges[1] + minCell
    nextBounds.maxY = Math.max(world.y, limit)
    heights[0] = nextBounds.maxY - layout.rowEdges[1]
  } else if (hit.index === table.rows) {
    const limit = layout.rowEdges[table.rows - 1] - minCell
    nextBounds.minY = Math.min(world.y, limit)
    heights[table.rows - 1] = layout.rowEdges[table.rows - 1] - nextBounds.minY
  } else {
    const top = layout.rowEdges[hit.index - 1]
    const bottom = layout.rowEdges[hit.index + 1]
    const y = Math.min(Math.max(world.y, bottom + minCell), top - minCell)
    heights[hit.index - 1] = top - y
    heights[hit.index] = y - bottom
  }

  return {
    bounds: nextBounds,
    options: { ...table, rowSpans: heights }
  }
}

const clampCellFontSize = (value: unknown, fallback: number) => {
  const size = Math.round(Number(value))
  return Number.isFinite(size) && size >= 8 ? Math.min(200, size) : fallback
}

export const emptyTableCells = (rows: number, cols: number, source?: string[][]) =>
  Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => source?.[row]?.[col] ?? '')
  )

export const emptyTableCellColors = (rows: number, cols: number, source?: string[][]) =>
  Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => normalizeTableColor(source?.[row]?.[col]))
  )

export const emptyTableCellFontSizes = (
  rows: number,
  cols: number,
  fallback: number,
  source?: number[][]
) =>
  Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => clampCellFontSize(source?.[row]?.[col], fallback))
  )

const emptyMergeGrid = (rows: number, cols: number, source?: number[][]) =>
  Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => {
      const value = Math.round(Number(source?.[row]?.[col]))
      return Number.isFinite(value) && value >= 0 ? value : 1
    })
  )

const normalizeCellMerges = (table: TableDrawOptions): TableDrawOptions => {
  const { rows, cols } = table
  const cellColSpans = emptyMergeGrid(rows, cols, table.cellColSpans)
  const cellRowSpans = emptyMergeGrid(rows, cols, table.cellRowSpans)
  const taken = Array.from({ length: rows }, () => Array.from({ length: cols }, () => false))

  if (table.title.trim()) {
    cellColSpans[0][0] = cols
    cellRowSpans[0][0] = 1
    for (let col = 1; col < cols; col += 1) {
      cellColSpans[0][col] = 0
      cellRowSpans[0][col] = 0
      taken[0][col] = true
    }
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (taken[row][col]) {
        cellColSpans[row][col] = 0
        cellRowSpans[row][col] = 0
        continue
      }
      const colSpan = Math.min(Math.max(cellColSpans[row][col] || 1, 1), cols - col)
      const rowSpan = Math.min(Math.max(cellRowSpans[row][col] || 1, 1), rows - row)
      cellColSpans[row][col] = colSpan
      cellRowSpans[row][col] = rowSpan
      for (let rowOffset = 0; rowOffset < rowSpan; rowOffset += 1) {
        for (let colOffset = 0; colOffset < colSpan; colOffset += 1) {
          if (rowOffset === 0 && colOffset === 0) {
            continue
          }
          taken[row + rowOffset][col + colOffset] = true
        }
      }
    }
  }

  return { ...table, cellColSpans, cellRowSpans }
}

export const getCellMerge = (options: TableDrawOptions, row: number, col: number) => {
  const table = normalizeTableOptions(options)
  const safeRow = Math.min(Math.max(0, row), table.rows - 1)
  const safeCol = Math.min(Math.max(0, col), table.cols - 1)
  const originColSpan = table.cellColSpans[safeRow][safeCol]
  const originRowSpan = table.cellRowSpans[safeRow][safeCol]
  if (originColSpan > 0 && originRowSpan > 0) {
    return {
      originRow: safeRow,
      originCol: safeCol,
      colSpan: originColSpan,
      rowSpan: originRowSpan
    }
  }

  for (let originRow = 0; originRow <= safeRow; originRow += 1) {
    for (let originCol = 0; originCol <= safeCol; originCol += 1) {
      const colSpan = table.cellColSpans[originRow][originCol]
      const rowSpan = table.cellRowSpans[originRow][originCol]
      if (
        colSpan > 0 &&
        rowSpan > 0 &&
        safeRow >= originRow &&
        safeRow < originRow + rowSpan &&
        safeCol >= originCol &&
        safeCol < originCol + colSpan
      ) {
        return { originRow, originCol, colSpan, rowSpan }
      }
    }
  }

  return { originRow: safeRow, originCol: safeCol, colSpan: 1, rowSpan: 1 }
}

export const seedTableCells = (
  options: Pick<TableDrawOptions, 'rows' | 'cols' | 'title' | 'headers'> & { cells?: string[][] }
) => {
  const cells = emptyTableCells(options.rows, options.cols, options.cells)
  const title = options.title.trim()
  if (title) {
    cells[0][0] = title
    for (let col = 1; col < options.cols; col += 1) {
      cells[0][col] = ''
    }
  }

  const headerRow = title ? 1 : 0
  if (headerRow < options.rows) {
    options.headers.forEach((header, index) => {
      if (index < options.cols) {
        cells[headerRow][index] = header
      }
    })
  }

  return cells
}

export const normalizeTableOptions = (
  options: TableDrawInput,
  seedFromForm = false
): TableDrawOptions => {
  const rows = Math.max(1, Math.round(options.rows))
  const cols = Math.max(1, Math.round(options.cols))
  const title = options.title.trim()
  const headers = options.headers.map((item) => item.trim())
  const base = {
    rows,
    cols,
    title,
    headers,
    font: options.font || DEFAULT_TABLE_FONT,
    fontSize: Math.max(8, Math.min(72, Math.round(options.fontSize || DEFAULT_TABLE_FONT_SIZE)))
  }
  const fitToCell = Number(options.fitToCell)
  const table: TableDrawOptions = {
    ...base,
    cells: seedFromForm || !options.cells
      ? seedTableCells({ ...base, cells: options.cells })
      : emptyTableCells(rows, cols, options.cells),
    cellColors: emptyTableCellColors(rows, cols, options.cellColors),
    cellFontSizes: emptyTableCellFontSizes(rows, cols, base.fontSize, options.cellFontSizes),
    cellColSpans: emptyMergeGrid(rows, cols, options.cellColSpans),
    cellRowSpans: emptyMergeGrid(rows, cols, options.cellRowSpans),
    colSpans: normalizeTableSpans(cols, options.colSpans),
    rowSpans: normalizeTableSpans(rows, options.rowSpans),
    ...(Number.isFinite(fitToCell) && fitToCell > 0 ? { fitToCell } : {})
  }
  return normalizeCellMerges(table)
}

export const tableHasTitle = (options: TableDrawOptions) => options.title.trim().length > 0

export const getTableCellText = (options: TableDrawOptions, row: number, col: number) => {
  if (tableHasTitle(options) && row === 0) {
    return options.cells[0]?.[0] || options.title
  }
  return options.cells[row]?.[col] ?? ''
}

export const getTableCellColor = (options: TableDrawOptions, row: number, col: number) => {
  if (tableHasTitle(options) && row === 0) {
    return normalizeTableColor(options.cellColors?.[0]?.[0])
  }
  return normalizeTableColor(options.cellColors?.[row]?.[col])
}

export const getTableCellFontSize = (options: TableDrawOptions, row: number, col: number) => {
  if (tableHasTitle(options) && row === 0) {
    return clampCellFontSize(options.cellFontSizes?.[0]?.[0], options.fontSize)
  }
  return clampCellFontSize(options.cellFontSizes?.[row]?.[col], options.fontSize)
}

export const setTableCellText = (
  options: TableDrawOptions,
  row: number,
  col: number,
  text: string,
  color?: string,
  fontSize?: number
): TableDrawOptions => {
  const next = normalizeTableOptions(options)
  const merge = getCellMerge(next, row, col)
  row = merge.originRow
  col = merge.originCol
  const value = text.trim()
  const cellColor = color ? normalizeTableColor(color) : undefined
  const cellFontSize = fontSize != null ? clampCellFontSize(fontSize, next.fontSize) : undefined
  if (tableHasTitle(next) && row === 0) {
    next.cells[0][0] = value
    next.title = value
    if (cellColor) {
      next.cellColors[0][0] = cellColor
    }
    if (cellFontSize) {
      next.cellFontSizes[0][0] = cellFontSize
    }
    return next
  }

  next.cells[row][col] = value
  if (cellColor) {
    next.cellColors[row][col] = cellColor
  }
  if (cellFontSize) {
    next.cellFontSizes[row][col] = cellFontSize
  }
  const headerRow = tableHasTitle(next) ? 1 : 0
  if (row === headerRow) {
    next.headers = [...next.cells[headerRow]]
  }
  return next
}

export const MAX_TABLE_ROWS = 40
export const MAX_TABLE_COLS = 20

const spliceRow = <T>(rows: T[][], index: number, value: T[]) => {
  const next = rows.map((row) => [...row])
  next.splice(index, 0, [...value])
  return next
}

const spliceCol = <T>(rows: T[][], index: number, value: T) =>
  rows.map((row) => {
    const next = [...row]
    next.splice(index, 0, value)
    return next
  })

const averageSpan = (spans: number[]) => {
  if (spans.length === 0) {
    return DEFAULT_TABLE_SPAN
  }
  return spans.reduce((sum, value) => sum + value, 0) / spans.length
}

export const insertTableRowAfter = (options: TableDrawOptions, row: number): TableDrawOptions => {
  const table = normalizeTableOptions(options)
  if (table.rows >= MAX_TABLE_ROWS) {
    return table
  }

  let insertAt = Math.min(table.rows, Math.max(0, Math.round(row) + 1))
  if (tableHasTitle(table)) {
    insertAt = Math.max(insertAt, 1)
    if (row <= 0 && table.rows > 1) {
      insertAt = Math.max(insertAt, 2)
    }
  }

  const rowSpans = [...table.rowSpans]
  rowSpans.splice(insertAt, 0, averageSpan(table.rowSpans))
  const cells = spliceRow(table.cells, insertAt, Array.from({ length: table.cols }, () => ''))
  const headerRow = tableHasTitle(table) ? 1 : 0
  return normalizeTableOptions({
    ...table,
    rows: table.rows + 1,
    cells,
    cellColors: spliceRow(
      table.cellColors,
      insertAt,
      Array.from({ length: table.cols }, () => normalizeTableColor())
    ),
    cellFontSizes: spliceRow(
      table.cellFontSizes,
      insertAt,
      Array.from({ length: table.cols }, () => table.fontSize)
    ),
    cellColSpans: spliceRow(table.cellColSpans, insertAt, Array.from({ length: table.cols }, () => 1)),
    cellRowSpans: spliceRow(table.cellRowSpans, insertAt, Array.from({ length: table.cols }, () => 1)),
    rowSpans,
    headers: headerRow < cells.length ? [...cells[headerRow]] : table.headers
  })
}

export const insertTableColumnAfter = (options: TableDrawOptions, col: number): TableDrawOptions => {
  const table = normalizeTableOptions(options)
  if (table.cols >= MAX_TABLE_COLS) {
    return table
  }

  const insertAt = Math.min(table.cols, Math.max(0, Math.round(col) + 1))
  const colSpans = [...table.colSpans]
  colSpans.splice(insertAt, 0, averageSpan(table.colSpans))
  const cells = spliceCol(table.cells, insertAt, '')
  const headerRow = tableHasTitle(table) ? 1 : 0
  return normalizeTableOptions({
    ...table,
    cols: table.cols + 1,
    cells,
    cellColors: spliceCol(table.cellColors, insertAt, normalizeTableColor()),
    cellFontSizes: spliceCol(table.cellFontSizes, insertAt, table.fontSize),
    cellColSpans: spliceCol(table.cellColSpans, insertAt, 1),
    cellRowSpans: spliceCol(table.cellRowSpans, insertAt, 1),
    colSpans,
    headers: headerRow < cells.length ? [...cells[headerRow]] : [...table.headers.slice(0, insertAt), '', ...table.headers.slice(insertAt)]
  })
}

export const expandTableBoundsForInsert = (
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  before: Pick<TableDrawOptions, 'rows' | 'cols'>,
  after: Pick<TableDrawOptions, 'rows' | 'cols'>
) => {
  const next = { ...bounds }
  if (before.cols > 0 && after.cols !== before.cols) {
    next.maxX += ((bounds.maxX - bounds.minX) / before.cols) * (after.cols - before.cols)
  }
  if (before.rows > 0 && after.rows !== before.rows) {
    next.minY -= ((bounds.maxY - bounds.minY) / before.rows) * (after.rows - before.rows)
  }
  return next
}

const removeRowAt = <T>(rows: T[][], index: number) =>
  rows.filter((_, row) => row !== index).map((row) => [...row])

const removeColAt = <T>(rows: T[][], index: number) =>
  rows.map((row) => row.filter((_, col) => col !== index))

export const removeTableRowAt = (options: TableDrawOptions, row: number): TableDrawOptions => {
  const table = normalizeTableOptions(options)
  if (table.rows <= 1) {
    return table
  }

  const removeAt = Math.min(table.rows - 1, Math.max(0, Math.round(row)))
  const hadTitle = tableHasTitle(table)
  const cells = removeRowAt(table.cells, removeAt)
  const title = hadTitle && removeAt === 0 ? '' : table.title
  if (title && cells[0]) {
    cells[0][0] = title
    for (let col = 1; col < table.cols; col += 1) {
      cells[0][col] = ''
    }
  }
  const headerRow = title ? 1 : 0
  const rowSpans = table.rowSpans.filter((_, index) => index !== removeAt)
  return normalizeTableOptions({
    ...table,
    rows: table.rows - 1,
    title,
    cells,
    cellColors: removeRowAt(table.cellColors, removeAt),
    cellFontSizes: removeRowAt(table.cellFontSizes, removeAt),
    cellColSpans: removeRowAt(table.cellColSpans, removeAt),
    cellRowSpans: removeRowAt(table.cellRowSpans, removeAt),
    rowSpans: rowSpans.length > 0 ? rowSpans : [DEFAULT_TABLE_SPAN],
    headers: headerRow < cells.length ? [...cells[headerRow]] : []
  })
}

export const removeTableColumnAt = (options: TableDrawOptions, col: number): TableDrawOptions => {
  const table = normalizeTableOptions(options)
  if (table.cols <= 1) {
    return table
  }

  const removeAt = Math.min(table.cols - 1, Math.max(0, Math.round(col)))
  const cells = removeColAt(table.cells, removeAt)
  if (tableHasTitle(table) && cells[0]) {
    cells[0][0] = table.title || cells[0][0]
    for (let index = 1; index < cells[0].length; index += 1) {
      cells[0][index] = ''
    }
  }
  const headerRow = tableHasTitle(table) ? 1 : 0
  const colSpans = table.colSpans.filter((_, index) => index !== removeAt)
  return normalizeTableOptions({
    ...table,
    cols: table.cols - 1,
    cells,
    cellColors: removeColAt(table.cellColors, removeAt),
    cellFontSizes: removeColAt(table.cellFontSizes, removeAt),
    cellColSpans: removeColAt(table.cellColSpans, removeAt),
    cellRowSpans: removeColAt(table.cellRowSpans, removeAt),
    colSpans: colSpans.length > 0 ? colSpans : [DEFAULT_TABLE_SPAN],
    headers: headerRow < cells.length ? [...cells[headerRow]] : table.headers.filter((_, index) => index !== removeAt)
  })
}

const mergeCellText = (left: string, right: string) => {
  const a = left.trim()
  const b = right.trim()
  if (!a) {
    return b
  }
  if (!b || a === b) {
    return a
  }
  return `${a} ${b}`
}

const mergeRectConflicts = (
  table: TableDrawOptions,
  originRow: number,
  originCol: number,
  colSpan: number,
  rowSpan: number
) => {
  for (let row = originRow; row < originRow + rowSpan; row += 1) {
    for (let col = originCol; col < originCol + colSpan; col += 1) {
      const other = getCellMerge(table, row, col)
      if (other.originRow === originRow && other.originCol === originCol) {
        continue
      }
      if (other.colSpan > 1 || other.rowSpan > 1) {
        return true
      }
      if (
        other.originRow < originRow ||
        other.originCol < originCol ||
        other.originRow + other.rowSpan > originRow + rowSpan ||
        other.originCol + other.colSpan > originCol + colSpan
      ) {
        return true
      }
    }
  }
  return false
}

export const mergeTableCells = (
  options: TableDrawOptions,
  row: number,
  col: number,
  axis: 'row' | 'col',
  count: number
): TableDrawOptions => {
  const table = normalizeTableOptions(options)
  if (tableHasTitle(table) && row === 0) {
    return table
  }

  const origin = getCellMerge(table, row, col)
  const cellsToMerge = Math.max(2, Math.round(count) || 2)
  const colSpan =
    axis === 'row'
      ? Math.min(table.cols - origin.originCol, Math.max(origin.colSpan, cellsToMerge))
      : origin.colSpan
  const rowSpan =
    axis === 'col'
      ? Math.min(table.rows - origin.originRow, Math.max(origin.rowSpan, cellsToMerge))
      : origin.rowSpan

  if (colSpan === origin.colSpan && rowSpan === origin.rowSpan) {
    return table
  }
  if (mergeRectConflicts(table, origin.originRow, origin.originCol, colSpan, rowSpan)) {
    return table
  }

  let text = ''
  for (let r = origin.originRow; r < origin.originRow + rowSpan; r += 1) {
    for (let c = origin.originCol; c < origin.originCol + colSpan; c += 1) {
      text = mergeCellText(text, table.cells[r]?.[c] ?? '')
    }
  }
  table.cells[origin.originRow][origin.originCol] = text
  table.cellColSpans[origin.originRow][origin.originCol] = colSpan
  table.cellRowSpans[origin.originRow][origin.originCol] = rowSpan
  if (tableHasTitle(table) ? origin.originRow === 1 : origin.originRow === 0) {
    table.headers = [...table.cells[origin.originRow]]
  }
  return normalizeTableOptions(table)
}

export const unmergeTableCells = (options: TableDrawOptions, row: number, col: number): TableDrawOptions => {
  const table = normalizeTableOptions(options)
  const origin = getCellMerge(table, row, col)
  if (tableHasTitle(table) && origin.originRow === 0) {
    return table
  }
  if (origin.colSpan <= 1 && origin.rowSpan <= 1) {
    return table
  }
  table.cellColSpans[origin.originRow][origin.originCol] = 1
  table.cellRowSpans[origin.originRow][origin.originCol] = 1
  return normalizeTableOptions(table)
}

export const hitTableCell = (
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  options: TableDrawOptions,
  world: { x: number; y: number }
) => {
  const width = bounds.maxX - bounds.minX
  const height = bounds.maxY - bounds.minY
  if (width <= 0 || height <= 0) {
    return null
  }
  if (
    world.x < bounds.minX ||
    world.x > bounds.maxX ||
    world.y < bounds.minY ||
    world.y > bounds.maxY
  ) {
    return null
  }

  const layout = getTableLayout(bounds, options)
  let col = options.cols - 1
  for (let index = 0; index < layout.colEdges.length - 2; index += 1) {
    if (world.x < layout.colEdges[index + 1]) {
      col = index
      break
    }
  }
  let row = options.rows - 1
  for (let index = 0; index < layout.rowEdges.length - 2; index += 1) {
    if (world.y > layout.rowEdges[index + 1]) {
      row = index
      break
    }
  }
  const merge = getCellMerge(options, row, col)
  return { row: merge.originRow, col: merge.originCol }
}

let pendingTableOptions: TableDrawOptions = normalizeTableOptions({
  rows: 4,
  cols: 3,
  title: '',
  headers: [],
  font: DEFAULT_TABLE_FONT,
  fontSize: DEFAULT_TABLE_FONT_SIZE
}, true)

export const setPendingTableOptions = (options: TableDrawInput) => {
  pendingTableOptions = normalizeTableOptions(options, true)
}

class DrawTableJig extends AcEdPreviewJig<AcGePoint3dLike> {
  private readonly polyline = new AcDbPolyline()
  private readonly firstPoint: AcGePoint2d

  constructor(view: AcEdBaseView, firstPoint: AcGePoint2d) {
    super(view)
    this.firstPoint = firstPoint
    this.polyline.color = colorFromSpec(FOREGROUND_COLOR)
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

export class AcApDrawTableCmd extends AcEdCommand {
  constructor() {
    super()
    this.mode = AcEdOpenMode.Write
    this.globalName = 'DRAWTABLE'
    this.localName = 'Ve bang'
  }

  async execute(context: AcApContext) {
    const editor = AcApDocManager.instance.editor
    const firstPrompt = new AcEdPromptPointOptions('Click góc thứ nhất của bảng')
    const firstResult = await editor.getPoint(firstPrompt)
    if (firstResult.status !== AcEdPromptStatus.OK || !firstResult.value) {
      return
    }

    const firstPoint = toPoint2d(firstResult.value)
    const secondPrompt = new AcEdPromptPointOptions('Click góc đối diện để đặt bảng')
    secondPrompt.useBasePoint = true
    secondPrompt.basePoint = new AcGePoint3d(firstPoint)
    secondPrompt.jig = new DrawTableJig(context.view, firstPoint)

    const secondResult = await editor.getPoint(secondPrompt)
    if (secondResult.status !== AcEdPromptStatus.OK || !secondResult.value) {
      return
    }

    const secondPoint = toPoint2d(secondResult.value)
    const minX = Math.min(firstPoint.x, secondPoint.x)
    const maxX = Math.max(firstPoint.x, secondPoint.x)
    const minY = Math.min(firstPoint.y, secondPoint.y)
    const maxY = Math.max(firstPoint.y, secondPoint.y)
    if (maxX - minX < 1e-6 || maxY - minY < 1e-6) {
      return
    }

    recordDrawUndo(() => {
      createTableAnnotation(context, minX, minY, maxX, maxY, pendingTableOptions)
    })
  }
}

export const appendTableEntities = (
  context: AcApContext,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  options: TableDrawInput,
  layer: string,
  entities: AcDbEntity[]
) => {
  const table = normalizeTableOptions(options)
  const rows = table.rows
  const cols = table.cols
  const layout = getTableLayout({ minX, minY, maxX, maxY }, table)
  const borderColor = colorFromSpec(FOREGROUND_COLOR)
  const fontName = table.font || DEFAULT_TABLE_FONT
  const addEntity = (entity: AcDbEntity) => {
    appendEntity(context, entity, layer)
    entities.push(entity)
  }

  const outer = new AcDbPolyline()
  outer.addVertexAt(0, new AcGePoint2d(minX, minY))
  outer.addVertexAt(1, new AcGePoint2d(maxX, minY))
  outer.addVertexAt(2, new AcGePoint2d(maxX, maxY))
  outer.addVertexAt(3, new AcGePoint2d(minX, maxY))
  outer.closed = true
  outer.color = borderColor
  addEntity(outer)

  const addGridSegment = (x1: number, y1: number, x2: number, y2: number) => {
    if (Math.hypot(x2 - x1, y2 - y1) < 1e-8) {
      return
    }
    const line = new AcDbLine({ x: x1, y: y1, z: 0 }, { x: x2, y: y2, z: 0 })
    line.color = borderColor
    addEntity(line)
  }

  const mergeCoversHorizontalLine = (lineRow: number, col: number) => {
    const merge = getCellMerge(table, Math.max(0, lineRow - 1), col)
    return merge.originRow < lineRow && merge.originRow + merge.rowSpan > lineRow
  }

  const mergeCoversVerticalLine = (row: number, lineCol: number) => {
    const merge = getCellMerge(table, row, Math.max(0, lineCol - 1))
    return merge.originCol < lineCol && merge.originCol + merge.colSpan > lineCol
  }

  for (let row = 1; row < rows; row += 1) {
    const y = layout.rowEdges[row]
    let start: number | null = null
    for (let col = 0; col < cols; col += 1) {
      const covered = mergeCoversHorizontalLine(row, col)
      if (covered) {
        if (start != null) {
          addGridSegment(start, y, layout.colEdges[col], y)
          start = null
        }
      } else if (start == null) {
        start = layout.colEdges[col]
      }
    }
    if (start != null) {
      addGridSegment(start, y, maxX, y)
    }
  }

  for (let col = 1; col < cols; col += 1) {
    const x = layout.colEdges[col]
    let start: number | null = null
    for (let row = 0; row < rows; row += 1) {
      const covered = mergeCoversVerticalLine(row, col)
      if (covered) {
        if (start != null) {
          addGridSegment(x, start, x, layout.rowEdges[row])
          start = null
        }
      } else if (start == null) {
        start = layout.rowEdges[row]
      }
    }
    if (start != null) {
      addGridSegment(x, start, x, minY)
    }
  }

  const addCellText = (row: number, col: number, text: string, spanCols = 1, spanRows = 1) => {
    if (!text) {
      return
    }

    const cell = tableCellRect(layout, row, col, spanCols, spanRows)
    const mtext = new AcDbMText()
    const cellFontSize = getTableCellFontSize(table, row, col)
    const maxWorldHeight =
      table.fitToCell && table.fitToCell > 0 ? Math.abs(cell.height) * table.fitToCell : undefined
    applyTableTextStyle(context, mtext, fontName, cellFontSize, maxWorldHeight)
    if (maxWorldHeight == null) {
      mtext.height = worldSizeFromPixels(context.view, cellFontSize)
    }
    mtext.contents = formatMTextContents(text, fontName)
    mtext.width = Math.max(cell.width * 0.88, 1e-4)
    mtext.attachmentPoint = AcGiMTextAttachmentPoint.MiddleCenter
    mtext.location = {
      x: cell.left + cell.width / 2,
      y: cell.bottom + cell.height / 2,
      z: 0
    }
    mtext.color = colorFromSpec(getTableCellColor(table, row, col))
    addEntity(mtext)
  }

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const colSpan = table.cellColSpans[row][col]
      const rowSpan = table.cellRowSpans[row][col]
      if (colSpan <= 0 || rowSpan <= 0) {
        continue
      }
      addCellText(row, col, table.cells[row][col], colSpan, rowSpan)
    }
  }

  return table
}

export const createTableAnnotation = (
  context: AcApContext,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  options: TableDrawInput,
  layer = getActiveDrawLayer(),
  annotationId?: string
) => {
  const entities: AcDbEntity[] = []
  const table = appendTableEntities(context, minX, minY, maxX, maxY, options, layer, entities)
  registerAnnotation({
    id: annotationId ?? createAnnotationId(),
    kind: 'table',
    entityIds: collectEntityIds(entities),
    bounds: { minX, minY, maxX, maxY },
    table,
    layer
  })
}
