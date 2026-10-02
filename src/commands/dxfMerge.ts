import type { AcDbDatabase, AcDbEntity } from '@mlightcad/data-model'

import {
  collectTableNames,
  findSection,
  findTable,
  incrementTableCount,
  isAsciiDxfText,
  listEntities,
  maxHandleValue,
  parseAsciiDxf,
  parseRecordPairs,
  setHeaderVariable,
  stringifyDxf,
  type DxfPair,
  normalizeHandle
} from './dxfAscii'
import {
  getEntityDxfType,
  serializeDxfEntity,
  serializeLayerRecord,
  serializeLinetypeRecord,
  serializeTextStyleRecord
} from './dxfSerialize'
import { getChangedOriginalHandles, getRemovedOriginalHandles } from './originalDxfEdits'

const DXF_PRECISION = 16

const insertPairs = (pairs: DxfPair[], index: number, incoming: DxfPair[]) => {
  if (incoming.length === 0) {
    return
  }
  pairs.splice(index, 0, ...incoming)
}

const removeRange = (pairs: DxfPair[], start: number, end: number) => {
  pairs.splice(start, end - start)
}

const collectLiveEntities = (database: AcDbDatabase) => {
  const entities: AcDbEntity[] = []
  for (const block of database.tables.blockTable.newIterator()) {
    if (!block.isModelSapce && !block.isPaperSapce) {
      continue
    }
    for (const entity of block.newIterator()) {
      entities.push(entity)
    }
  }
  return entities
}

const injectTableRecords = (
  pairs: DxfPair[],
  tableName: string,
  records: DxfPair[][]
) => {
  if (records.length === 0) {
    return 0
  }

  const table = findTable(pairs, tableName)
  if (!table) {
    return 0
  }

  const incoming = records.flat()
  insertPairs(pairs, table.end, incoming)
  incrementTableCount(pairs, tableName, records.length)
  return records.length
}

export const canMergeOriginalDxf = (text: string) =>
  isAsciiDxfText(text) && /(?:\n|\r\n)2(?:\n|\r\n)ENTITIES(?:\n|\r\n)/.test(text)

export const mergeOriginalDxf = (originalText: string, database: AcDbDatabase) => {
  if (!canMergeOriginalDxf(originalText)) {
    throw new Error('File gốc không phải DXF ASCII hợp lệ.')
  }

  const document = parseAsciiDxf(originalText)
  const { pairs } = document
  const entitiesSection = findSection(pairs, 'ENTITIES')
  if (!entitiesSection) {
    throw new Error('File gốc thiếu phần ENTITIES.')
  }

  const originalEntities = listEntities(pairs, 'ENTITIES')
  const originalHandles = new Set(
    originalEntities.map((entity) => entity.handle).filter(Boolean)
  )
  const removed = getRemovedOriginalHandles()
  const changed = getChangedOriginalHandles()

  let removedCount = 0
  for (const record of [...originalEntities].reverse()) {
    if (!record.handle || !removed.has(record.handle)) {
      continue
    }
    removeRange(pairs, record.start, record.end)
    removedCount += 1
  }

  const liveEntities = collectLiveEntities(database)
  const addedEntities: AcDbEntity[] = []
  const changedEntities: AcDbEntity[] = []

  for (const entity of liveEntities) {
    const handle = normalizeHandle(entity.objectId)
    if (!handle) {
      if (getEntityDxfType(entity)) {
        addedEntities.push(entity)
      }
      continue
    }
    if (removed.has(handle)) {
      continue
    }
    if (!originalHandles.has(handle)) {
      addedEntities.push(entity)
      continue
    }
    if (changed.has(handle)) {
      changedEntities.push(entity)
    }
  }

  for (const entity of changedEntities) {
    const handle = normalizeHandle(entity.objectId)
    const current = listEntities(pairs, 'ENTITIES').find((item) => item.handle === handle)
    const snippet = serializeDxfEntity(database, entity, DXF_PRECISION)
    if (!current || !snippet) {
      if (snippet) {
        addedEntities.push(entity)
      }
      continue
    }
    const replacement = parseRecordPairs(snippet)
    removeRange(pairs, current.start, current.end)
    insertPairs(pairs, current.start, replacement)
  }

  const addedSnippets = addedEntities
    .map((entity) => serializeDxfEntity(database, entity, DXF_PRECISION))
    .filter(Boolean)
    .map((text) => parseRecordPairs(text))

  const entitiesNow = findSection(pairs, 'ENTITIES')
  if (!entitiesNow) {
    throw new Error('Không tìm thấy phần ENTITIES sau khi ghép file.')
  }
  insertPairs(pairs, entitiesNow.end, addedSnippets.flat())

  const existingLayers = collectTableNames(pairs, 'LAYER')
  const existingLinetypes = collectTableNames(pairs, 'LTYPE')
  const existingStyles = collectTableNames(pairs, 'STYLE')

  const layerRecords: DxfPair[][] = []
  for (const record of database.tables.layerTable.newIterator()) {
    if (existingLayers.has(record.name.trim().toUpperCase())) {
      continue
    }
    const snippet = serializeLayerRecord(database, record, DXF_PRECISION)
    if (snippet) {
      layerRecords.push(parseRecordPairs(snippet))
    }
  }

  const linetypeRecords: DxfPair[][] = []
  for (const record of database.tables.linetypeTable.newIterator()) {
    if (existingLinetypes.has(record.name.trim().toUpperCase())) {
      continue
    }
    const snippet = serializeLinetypeRecord(database, record, DXF_PRECISION)
    if (snippet) {
      linetypeRecords.push(parseRecordPairs(snippet))
    }
  }

  const styleRecords: DxfPair[][] = []
  for (const record of database.tables.textStyleTable.newIterator()) {
    if (existingStyles.has(record.name.trim().toUpperCase())) {
      continue
    }
    const snippet = serializeTextStyleRecord(database, record, DXF_PRECISION)
    if (snippet) {
      styleRecords.push(parseRecordPairs(snippet))
    }
  }

  const addedLayers = injectTableRecords(pairs, 'LAYER', layerRecords)
  const addedLinetypes = injectTableRecords(pairs, 'LTYPE', linetypeRecords)
  const addedStyles = injectTableRecords(pairs, 'STYLE', styleRecords)

  const nextHandle = maxHandleValue(pairs) + 1
  setHeaderVariable(pairs, '$HANDSEED', 5, nextHandle.toString(16).toUpperCase())
  if (addedLayers + addedStyles + addedEntities.length > 0) {
    setHeaderVariable(pairs, '$DWGCODEPAGE', 3, 'UTF-8')
  }

  return {
    dxf: stringifyDxf(document),
    addedEntities: addedSnippets.length,
    changedEntities: changedEntities.length,
    removedEntities: removedCount,
    addedLayers,
    addedLinetypes,
    addedStyles
  }
}
