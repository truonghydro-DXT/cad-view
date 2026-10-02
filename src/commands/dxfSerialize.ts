import type {
  AcDbDatabase,
  AcDbEntity,
  AcDbLayerTableRecord,
  AcDbLinetypeTableRecord,
  AcDbTextStyleTableRecord
} from '@mlightcad/data-model'

import { SimpleDxfFiler } from './dxfFiler'
import { normalizeHandle } from './dxfAscii'

const entityType = (entity: AcDbEntity) => {
  const typed = entity as AcDbEntity & { dxfTypeName?: string }
  return String(typed.dxfTypeName || '').trim().toUpperCase()
}

export const createExportFiler = (database: AcDbDatabase, precision = 16) => {
  let maxHandle = 1
  const consider = (handle?: string) => {
    const value = normalizeHandle(handle)
    if (!value) {
      return
    }
    const numeric = Number.parseInt(value, 16)
    if (Number.isFinite(numeric) && numeric > maxHandle) {
      maxHandle = numeric
    }
  }

  try {
    consider(database.tables.blockTable.modelSpace.objectId)
    for (const record of database.tables.layerTable.newIterator()) {
      consider(record.objectId)
    }
  } catch {
    // Tables may not be ready while serializing a single record.
  }

  return new SimpleDxfFiler({
    database,
    precision,
    nextHandle: maxHandle + 1
  })
}

export const serializeDxfEntity = (database: AcDbDatabase, entity: AcDbEntity, precision = 16) => {
  const type = entityType(entity)
  if (!type) {
    return ''
  }

  const filer = createExportFiler(database, precision)
  filer.writeStart(type)
  entity.dxfOut(filer as never)
  return filer.toString()
}

export const serializeLayerRecord = (
  database: AcDbDatabase,
  record: AcDbLayerTableRecord,
  precision = 16
) => {
  const filer = createExportFiler(database, precision)
  filer.writeStart('LAYER')
  record.dxfOut(filer as never)
  return filer.toString()
}

export const serializeLinetypeRecord = (
  database: AcDbDatabase,
  record: AcDbLinetypeTableRecord,
  precision = 16
) => {
  const filer = createExportFiler(database, precision)
  filer.writeStart('LTYPE')
  record.dxfOut(filer as never)
  return filer.toString()
}

export const serializeTextStyleRecord = (
  database: AcDbDatabase,
  record: AcDbTextStyleTableRecord,
  precision = 16
) => {
  const filer = createExportFiler(database, precision)
  filer.writeStart('STYLE')
  record.dxfOut(filer as never)
  return filer.toString()
}

export const getEntityDxfType = entityType
