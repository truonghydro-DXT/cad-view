import { AcApDocManager } from '@mlightcad/cad-simple-viewer'
import { AcDbLayerTableRecord, type AcDbDatabase } from '@mlightcad/data-model'

import { DRAW_COLOR } from './drawHelpers'
import { store } from '../store'

export const DRAW_LAYER_BY_TOOL = {
  line: 'Đường',
  region: 'Vùng',
  point: 'Điểm',
  circle: 'Hình tròn',
  table: 'Bảng',
  text: 'Chữ',
  grid: 'Lưới',
  scale: 'Thước tỷ lệ',
  sheet: 'Khung mẫu'
} as const

export type DrawLayerInfo = {
  name: string
  isOff: boolean
  isLocked: boolean
}

const getDatabase = () => {
  try {
    return AcApDocManager.instance.curDocument.database
  } catch {
    return undefined
  }
}

export const listDrawLayers = (): DrawLayerInfo[] => {
  const database = getDatabase()
  if (!database) {
    return []
  }

  const layers: DrawLayerInfo[] = []
  const seen = new Set<string>()
  for (const record of database.tables.layerTable.newIterator()) {
    const key = record.name.toLowerCase()
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    layers.push({
      name: record.name,
      isOff: record.isOff,
      isLocked: record.isLocked
    })
  }
  return layers.sort((left, right) => left.name.localeCompare(right.name, 'vi'))
}

export const ensureLayer = (name: string, database: AcDbDatabase = getDatabase()!) => {
  const layerName = name.trim() || '0'
  const existing = database.tables.layerTable.getAt(layerName)
  if (existing) {
    return existing
  }

  const record = new AcDbLayerTableRecord({
    name: layerName,
    standardFlags: 0,
    linetype: 'Continuous',
    lineWeight: 0,
    isOff: false,
    isPlottable: true,
    color: DRAW_COLOR()
  })
  database.tables.layerTable.add(record)
  return database.tables.layerTable.getAt(layerName) ?? record
}

const INVALID_LAYER_NAME = /[<>/\\":;?*|=`,]/

export const createDrawLayer = (name: string) => {
  const layerName = name.trim()
  if (!layerName) {
    return { ok: false as const, message: 'Hãy nhập tên lớp mới.' }
  }
  if (layerName.length > 255) {
    return { ok: false as const, message: 'Tên lớp tối đa 255 ký tự.' }
  }
  if (INVALID_LAYER_NAME.test(layerName)) {
    return { ok: false as const, message: 'Tên lớp không được chứa các ký tự <>/\\":;?*|=`,' }
  }

  const database = getDatabase()
  if (!database) {
    return { ok: false as const, message: 'Chưa mở bản vẽ.' }
  }

  const existingRecord = database.tables.layerTable.getAt(layerName)
  const existingName =
    existingRecord?.name ??
    listDrawLayers().find((layer) => layer.name.toLowerCase() === layerName.toLowerCase())?.name

  if (existingName) {
    const activated = activateDrawLayer(existingName)
    if (!activated.ok) {
      return activated
    }
    return { ok: true as const, layer: activated.layer, created: false as const }
  }

  ensureLayer(layerName, database)
  const activated = activateDrawLayer(layerName)
  if (!activated.ok) {
    return activated
  }
  return { ok: true as const, layer: activated.layer, created: true as const }
}

export const ensureDrawLayers = () => {
  const database = getDatabase()
  if (!database) {
    return
  }

  for (const name of Object.values(DRAW_LAYER_BY_TOOL)) {
    if (!database.tables.layerTable.has(name)) {
      ensureLayer(name, database)
    }
  }

  if (!store.drawLayer) {
    store.drawLayer = database.clayer || DRAW_LAYER_BY_TOOL.line
  }
}

export const getActiveDrawLayer = (fallback?: string) => {
  const database = getDatabase()
  return (
    store.drawLayer ||
    fallback ||
    database?.clayer ||
    DRAW_LAYER_BY_TOOL.line
  )
}

export const activateDrawLayer = (name: string) => {
  const database = getDatabase()
  if (!database) {
    return { ok: false as const, message: 'Chưa mở bản vẽ.' }
  }

  const record = ensureLayer(name, database)
  if (record.isLocked) {
    return { ok: false as const, message: `Lớp "${record.name}" đang khóa. Hãy chọn lớp khác.` }
  }

  store.drawLayer = record.name
  return { ok: true as const, layer: record.name }
}

export const activateLayerForTool = (tool: keyof typeof DRAW_LAYER_BY_TOOL) => {
  const preferred = store.drawLayer || DRAW_LAYER_BY_TOOL[tool]
  return activateDrawLayer(preferred)
}

export const setLayerVisible = (name: string, visible: boolean) => {
  const database = getDatabase()
  if (!database) {
    return { ok: false as const, message: 'Chưa mở bản vẽ.' }
  }

  const record = database.tables.layerTable.getAt(name)
  if (!record) {
    return { ok: false as const, message: `Không tìm thấy lớp "${name}".` }
  }

  if (record.isOff === !visible && !(visible && record.isFrozen)) {
    return { ok: true as const, layer: record.name, visible }
  }

  record.isOff = !visible
  if (visible && record.isFrozen) {
    record.isFrozen = false
  }
  return { ok: true as const, layer: record.name, visible }
}
