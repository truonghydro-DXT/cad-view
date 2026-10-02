import type { AcApContext } from '@mlightcad/cad-simple-viewer'
import { AcApDocManager } from '@mlightcad/cad-simple-viewer'
import {
  AcDbDatabase,
  AcDbEntity,
  AcDbLinetypeTableRecord
} from '@mlightcad/data-model'
import { AcGiLineWeight, type AcGiBaseLineStyle } from '@mlightcad/graphic-interface'

import { colorFromSpec, worldSizeFromPixels } from './drawHelpers'

export type RegionLineTypeId =
  | 'Continuous'
  | 'DASHED'
  | 'DOT'
  | 'DASHDOT'
  | 'CENTER'
  | 'HIDDEN'

export const DEFAULT_STROKE_WIDTH = 2
export const STROKE_WIDTHS = [1, 2, 3, 4, 5, 6, 8] as const

export const clampStrokeWidth = (value: number) => {
  const rounded = Math.round(Number(value) || DEFAULT_STROKE_WIDTH)
  if (STROKE_WIDTHS.includes(rounded as (typeof STROKE_WIDTHS)[number])) {
    return rounded
  }
  return STROKE_WIDTHS.reduce((closest, item) =>
    Math.abs(item - rounded) < Math.abs(closest - rounded) ? item : closest
  )
}

const strokeWidthToLineWeight = (pixels: number) =>
  Math.round(clampStrokeWidth(pixels) * 40) as AcGiLineWeight

export const enableLineWeightDisplay = (context?: AcApContext) => {
  try {
    const view = context?.view ?? AcApDocManager.instance.curView
    if (view.renderer.showLineWeight !== true) {
      view.renderer.showLineWeight = true
    }
  } catch {
    // Viewer may not be ready yet.
  }
}

export const REGION_LINE_TYPES: {
  id: RegionLineTypeId
  label: string
  dasharray: string
  linecap?: 'butt' | 'round'
}[] = [
  { id: 'Continuous', label: 'Liên tục', dasharray: '' },
  { id: 'DASHED', label: 'Nét đứt', dasharray: '14 7' },
  { id: 'DOT', label: 'Chấm', dasharray: '0.1 8', linecap: 'round' },
  { id: 'DASHDOT', label: 'Chấm gạch', dasharray: '14 6 0.1 6', linecap: 'round' },
  { id: 'CENTER', label: 'Tâm', dasharray: '20 6 6 6' },
  { id: 'HIDDEN', label: 'Nét ẩn', dasharray: '7 5' }
]

const dash = (length: number) => ({
  elementLength: length,
  elementTypeFlag: 0
})

const LINETYPE_DEFINITIONS: Record<RegionLineTypeId, AcGiBaseLineStyle> = {
  Continuous: {
    name: 'Continuous',
    standardFlag: 0,
    description: 'Solid line',
    totalPatternLength: 0
  },
  DASHED: {
    name: 'DASHED',
    standardFlag: 0,
    description: 'Dashed __ __ __',
    totalPatternLength: 0.75,
    pattern: [dash(0.5), dash(-0.25)]
  },
  DOT: {
    name: 'DOT',
    standardFlag: 0,
    description: 'Dot . . . .',
    totalPatternLength: 0.25,
    pattern: [dash(0), dash(-0.25)]
  },
  DASHDOT: {
    name: 'DASHDOT',
    standardFlag: 0,
    description: 'Dash dot __ . __ .',
    totalPatternLength: 0.75,
    pattern: [dash(0.5), dash(-0.25), dash(0), dash(-0.25)]
  },
  CENTER: {
    name: 'CENTER',
    standardFlag: 0,
    description: 'Center ____ _ ____',
    totalPatternLength: 2,
    pattern: [dash(1.25), dash(-0.25), dash(0.25), dash(-0.25)]
  },
  HIDDEN: {
    name: 'HIDDEN',
    standardFlag: 0,
    description: 'Hidden __ __ __',
    totalPatternLength: 0.375,
    pattern: [dash(0.25), dash(-0.125)]
  }
}

const findLinetypeRecord = (database: AcDbDatabase, name: string) => {
  const table = database.tables.linetypeTable
  const exact = table.getAt(name)
  if (exact) {
    return exact
  }

  const upper = name.toUpperCase()
  for (const record of table.newIterator()) {
    if (record.name.toUpperCase() === upper) {
      return record
    }
  }

  return undefined
}

export const ensureLinetype = (database: AcDbDatabase, name: string) => {
  const existing = findLinetypeRecord(database, name)
  if (existing) {
    return existing
  }

  const definition =
    LINETYPE_DEFINITIONS[name as RegionLineTypeId] ?? LINETYPE_DEFINITIONS.Continuous
  const already = findLinetypeRecord(database, definition.name)
  if (already) {
    return already
  }

  database.tables.linetypeTable.add(new AcDbLinetypeTableRecord(definition))
  return findLinetypeRecord(database, definition.name) ?? database.tables.linetypeTable.getAt(definition.name)!
}

export const applyStrokeStyle = (
  context: AcApContext,
  entity: AcDbEntity,
  strokeColor: string,
  lineType: string,
  patternWorldLength?: number,
  strokeWidth = DEFAULT_STROKE_WIDTH
) => {
  enableLineWeightDisplay(context)
  const record = ensureLinetype(context.doc.database, lineType)
  entity.color = colorFromSpec(strokeColor)
  entity.lineType = record.name
  entity.lineWeight = strokeWidthToLineWeight(strokeWidth)

  if (record.name.toUpperCase() === 'CONTINUOUS' || record.patternLength <= 0) {
    entity.linetypeScale = 1
    return
  }

  const fromZoom = worldSizeFromPixels(context.view, 40)
  const cycle = Math.max(patternWorldLength ?? 0, fromZoom)
  entity.linetypeScale = Math.max(cycle / record.patternLength, 1e-3)
}
