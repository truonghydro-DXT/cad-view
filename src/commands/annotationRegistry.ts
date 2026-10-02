import { AcApDocManager } from '@mlightcad/cad-simple-viewer'
import type { AcDbEntity } from '@mlightcad/data-model'

import { clearOriginalDxfEdits } from './originalDxfEdits'
import type { GridDrawOptions } from './gridCmd'
import type { ScaleDrawOptions } from './scaleCmd'
import type { SheetDrawOptions, SheetTableFrame } from './sheetCmd'
import type { TableDrawOptions } from './tableCmd'
import type { TextDrawOptions } from './textCmd'

export type DrawAnnotationKind =
  | 'line'
  | 'region'
  | 'point'
  | 'circle'
  | 'table'
  | 'text'
  | 'grid'
  | 'scale'
  | 'sheet'

export type FileEntityEdit = 'path' | 'text' | 'none'

export type DrawAnnotation = {
  id: string
  kind: DrawAnnotationKind
  /** Draw tools create 'draw'. Existing DWG/DXF entities are adopted as 'file'. */
  source?: 'draw' | 'file'
  fileEdit?: FileEntityEdit
  entityIds: string[]
  closed?: boolean
  bounds?: { minX: number; minY: number; maxX: number; maxY: number }
  table?: TableDrawOptions
  text?: TextDrawOptions
  grid?: GridDrawOptions
  gridFrame?: { minX: number; minY: number; maxX: number; maxY: number }
  scale?: ScaleDrawOptions
  sheet?: SheetDrawOptions
  sheetRoles?: Record<string, string>
  sheetTables?: SheetTableFrame[]
  regionMode?: 'polygon' | 'rectangle'
  regionFillMode?: 'fill' | 'transparent'
  regionFillColor?: string
  regionStrokeColor?: string
  regionLineType?: string
  regionStrokeWidth?: number
  lineStrokeColor?: string
  lineLineType?: string
  lineStrokeWidth?: number
  point?: {
    x: number
    y: number
    z?: number
    size: number
    radius: number
    fillMode: 'fill' | 'transparent'
    fillColor: string
    strokeColor: string
  }
  circle?: {
    x: number
    y: number
    z?: number
    radius: number
    fillMode: 'fill' | 'transparent'
    fillColor: string
    strokeColor: string
    strokeWidth: number
  }
  layer?: string
}

const annotations = new Map<string, DrawAnnotation>()
const entityToAnnotation = new Map<string, string>()
const clearListeners: Array<() => void> = []
let nextId = 1

export const onAnnotationsCleared = (listener: () => void) => {
  clearListeners.push(listener)
}

export const createAnnotationId = () => {
  const value = nextId
  nextId += 1
  return `draw-${value}`
}

export const registerAnnotation = (annotation: DrawAnnotation) => {
  annotations.set(annotation.id, annotation)
  for (const entityId of annotation.entityIds) {
    entityToAnnotation.set(String(entityId), annotation.id)
  }
}

export const getAnnotation = (id: string) => annotations.get(id)

export const findAnnotationByEntityId = (entityId: string) => {
  const annotationId = entityToAnnotation.get(String(entityId))
  return annotationId ? annotations.get(annotationId) : undefined
}

export const collectAnnotationsFromEntityIds = (entityIds: string[]) => {
  const seen = new Set<string>()
  const result: DrawAnnotation[] = []
  for (const entityId of entityIds) {
    const annotation = findAnnotationByEntityId(entityId)
    if (!annotation || seen.has(annotation.id)) {
      continue
    }
    seen.add(annotation.id)
    result.push(annotation)
  }
  return result
}

export const unregisterAnnotation = (id: string) => {
  const annotation = annotations.get(id)
  if (!annotation) {
    return
  }

  for (const entityId of annotation.entityIds) {
    entityToAnnotation.delete(String(entityId))
  }
  annotations.delete(id)
}

export const clearAnnotations = () => {
  annotations.clear()
  entityToAnnotation.clear()
  clearOriginalDxfEdits()
  for (const listener of clearListeners) {
    listener()
  }
}

export const listAnnotations = () => Array.from(annotations.values())

export const isFileAnnotation = (annotation: DrawAnnotation) => annotation.source === 'file'

export const eraseAnnotationEntities = (annotation: DrawAnnotation) => {
  if (isFileAnnotation(annotation)) {
    return
  }

  const docManager = AcApDocManager.instance
  const database = docManager.curDocument.database
  const view = docManager.curView

  for (const entityId of annotation.entityIds) {
    const entity = database.tables.blockTable.getEntityById(entityId)
    if (!entity) {
      continue
    }
    view.removeEntity(entity)
    entity.erase()
  }

  unregisterAnnotation(annotation.id)
}

export const collectEntityIds = (entities: AcDbEntity[]) =>
  entities
    .map((entity) => entity.objectId)
    .filter((id): id is string => Boolean(id))
    .map((id) => String(id))

export const retargetAnnotationEntity = (
  annotation: DrawAnnotation,
  oldEntityId: string,
  newEntityId: string
) => {
  const from = String(oldEntityId)
  const to = String(newEntityId)
  annotation.entityIds = annotation.entityIds.map((id) => (String(id) === from ? to : id))
  entityToAnnotation.delete(from)
  entityToAnnotation.set(to, annotation.id)
}
