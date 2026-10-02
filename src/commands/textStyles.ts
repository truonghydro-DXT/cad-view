import type { AcApContext } from '@mlightcad/cad-simple-viewer'
import {
  AcDbDatabase,
  AcDbMText,
  AcDbTextStyleTableRecord
} from '@mlightcad/data-model'

import { worldSizeFromPixels } from './drawHelpers'

export const TABLE_FONTS = [
  { id: 'BeVietnamPro', label: 'Be Vietnam Pro' },
  { id: 'Noto Sans', label: 'Noto Sans' },
  { id: 'Noto Serif', label: 'Noto Serif' },
  { id: 'Roboto', label: 'Roboto' },
  { id: 'Open Sans', label: 'Open Sans' },
  { id: 'Inter', label: 'Inter' },
  { id: 'Montserrat', label: 'Montserrat' },
  { id: 'Lato', label: 'Lato' },
  { id: 'Arial', label: 'Arial' },
  { id: 'Times New Roman', label: 'Times New Roman' },
  { id: 'Courier New', label: 'Courier New' },
  { id: 'Josefin Sans', label: 'Josefin Sans' },
  { id: 'Playfair Display', label: 'Playfair Display' },
  { id: 'Oswald', label: 'Oswald' },
  { id: 'Nunito', label: 'Nunito' },
  { id: 'Merriweather', label: 'Merriweather' },
  { id: 'IBM Plex Sans', label: 'IBM Plex Sans' },
  { id: 'Source Sans 3', label: 'Source Sans 3' },
  { id: 'Lora', label: 'Lora' },
  { id: 'Fira Sans', label: 'Fira Sans' }
] as const

export const DEFAULT_TABLE_FONT = TABLE_FONTS[0].id
export const DEFAULT_TABLE_FONT_SIZE = 14
export const DEFAULT_TEXT_FONT_SIZE = 20
export const DEFAULT_TEXT_COLOR = '#382418'

const styleNameForFont = (fontName: string) =>
  `Draw_${fontName.replace(/[^A-Za-z0-9]+/g, '') || 'Text'}`

const findTextStyle = (database: AcDbDatabase, name: string) => {
  const table = database.tables.textStyleTable
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

export const ensureTextStyle = (database: AcDbDatabase, fontName: string) => {
  const styleName = styleNameForFont(fontName)
  const existing = findTextStyle(database, styleName)
  if (existing) {
    return existing.name
  }

  database.tables.textStyleTable.add(
    new AcDbTextStyleTableRecord({
      name: styleName,
      standardFlag: 0,
      fixedTextHeight: 0,
      widthFactor: 1,
      obliqueAngle: 0,
      textGenerationFlag: 0,
      lastHeight: 0.2,
      font: fontName,
      bigFont: '',
      extendedFont: fontName
    })
  )

  return findTextStyle(database, styleName)?.name ?? styleName
}

export const formatMTextContents = (text: string, fontName: string) =>
  `{\\f${fontName}|b0|i0;${text}}`

export const applyTableTextStyle = (
  context: AcApContext,
  mtext: AcDbMText,
  fontName: string,
  fontSizePx: number,
  maxWorldHeight?: number
) => {
  mtext.styleName = ensureTextStyle(context.doc.database, fontName)
  const requested = worldSizeFromPixels(context.view, Math.max(8, Math.min(72, fontSizePx)))
  mtext.height = maxWorldHeight ? Math.min(requested, maxWorldHeight) : requested
}
