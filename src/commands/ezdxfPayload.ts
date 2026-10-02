import { AcApDocManager } from '@mlightcad/cad-simple-viewer'
import {
  AcDb2dPolyline,
  AcDbArc,
  AcDbCircle,
  AcDbHatch,
  AcDbLine,
  AcDbMText,
  AcDbPoint,
  AcDbPolyline,
  AcDbText,
  type AcDbEntity
} from '@mlightcad/data-model'

import { listAnnotations, type DrawAnnotationKind } from './annotationRegistry'
import { DRAW_LAYER_BY_TOOL } from './drawLayers'
import { getCadEntityById } from './existingEntities'
import { getChangedOriginalHandles, getRemovedOriginalHandles } from './originalDxfEdits'

export type EzdxfPoint = number[]

export type EzdxfEntity = {
  type: string
  handle?: string
  layer?: string
  color?: string
  linetype?: string
  lineweight?: number
  closed?: boolean
  points?: EzdxfPoint[]
  paths?: EzdxfPoint[][]
  text?: string
  insert_point?: EzdxfPoint
  start_point?: EzdxfPoint
  end_point?: EzdxfPoint
  center_point?: EzdxfPoint
  radius?: number
  start_angle?: number
  end_angle?: number
  height?: number
  width?: number
  rotation?: number
  attachment_point?: number
  solid_fill?: boolean
  pattern_name?: string
  location?: EzdxfPoint
}

export type EzdxfLayer = {
  name: string
  color?: string
  linetype?: string
  off?: boolean
  frozen?: boolean
  plot?: boolean
}

export type EzdxfPayload = {
  layers: EzdxfLayer[]
  entities: EzdxfEntity[]
  updates: EzdxfEntity[]
  removed_handles: string[]
}

const toHexColor = (entity: AcDbEntity) => {
  const color = entity.color as { RGB?: number; red?: number; green?: number; blue?: number } | undefined
  if (!color) {
    return undefined
  }
  if (typeof color.RGB === 'number' && color.RGB > 0) {
    const rgb = color.RGB
    const red = (rgb >> 16) & 255
    const green = (rgb >> 8) & 255
    const blue = rgb & 255
    return `#${[red, green, blue].map((item) => item.toString(16).padStart(2, '0')).join('')}`
  }
  if (
    Number.isFinite(color.red) &&
    Number.isFinite(color.green) &&
    Number.isFinite(color.blue)
  ) {
    return `#${[color.red, color.green, color.blue]
      .map((item) => Math.max(0, Math.min(255, Number(item))).toString(16).padStart(2, '0'))
      .join('')}`
  }
  return undefined
}

const styleOf = (entity: AcDbEntity): Pick<EzdxfEntity, 'layer' | 'color' | 'linetype' | 'lineweight'> => ({
  layer: entity.layer || undefined,
  color: toHexColor(entity),
  linetype: entity.lineType || undefined,
  lineweight: Number.isFinite(entity.lineWeight) ? Number(entity.lineWeight) : undefined
})

const hatchPaths = (entity: AcDbHatch) => {
  const geo = (entity as unknown as { _geo?: { loops?: Array<{ vertices?: Array<{ x: number; y: number }> }> } })._geo
  const loops = geo?.loops ?? []
  const paths = loops
    .map((loop) => (loop.vertices ?? []).map((vertex) => [vertex.x, vertex.y]))
    .filter((path) => path.length >= 3)
  return paths
}

const entityTypeKey = (entity: AcDbEntity) =>
  `${entity.type || ''} ${entity.dxfTypeName || ''} ${entity.constructor?.name || ''}`.toUpperCase()

const xyz = (point: { x: number; y: number; z?: number } | undefined) =>
  point ? [point.x, point.y, point.z ?? 0] : [0, 0, 0]

const serializeEntity = (entity: AcDbEntity): EzdxfEntity | null => {
  try {
    const style = styleOf(entity)
    const handle = entity.objectId || undefined
    const typeKey = entityTypeKey(entity)

    if (entity instanceof AcDbPolyline || typeKey.includes('LWPOLYLINE')) {
      const polyline = entity as AcDbPolyline
      if (polyline.numberOfVertices >= 2 && typeof polyline.getPoint2dAt === 'function') {
        return {
          type: 'LWPOLYLINE',
          handle,
          ...style,
          closed: polyline.closed,
          points: Array.from({ length: polyline.numberOfVertices }, (_, index) => {
            const point = polyline.getPoint2dAt(index)
            return [point.x, point.y]
          })
        }
      }
    }

    if (entity instanceof AcDb2dPolyline || (typeKey.includes('POLYLINE') && !typeKey.includes('LWPOLYLINE'))) {
      const polyline = entity as AcDb2dPolyline
      if (polyline.numberOfVertices >= 2 && typeof polyline.getPointAt === 'function') {
        return {
          type: 'POLYLINE',
          handle,
          ...style,
          closed: polyline.closed,
          points: Array.from({ length: polyline.numberOfVertices }, (_, index) => {
            const point = polyline.getPointAt(index)
            return [point.x, point.y]
          })
        }
      }
    }

    if (
      entity instanceof AcDbLine ||
      (typeKey.includes('LINE') &&
        !typeKey.includes('POLYLINE') &&
        !typeKey.includes('XLINE') &&
        !typeKey.includes('MLINE') &&
        !typeKey.includes('SPLINE'))
    ) {
      const line = entity as AcDbLine
      if (line.startPoint && line.endPoint) {
        return {
          type: 'LINE',
          handle,
          ...style,
          start_point: xyz(line.startPoint),
          end_point: xyz(line.endPoint)
        }
      }
    }

    if (entity instanceof AcDbHatch || typeKey.includes('HATCH')) {
      const paths = hatchPaths(entity as AcDbHatch)
      if (paths.length === 0) {
        return null
      }
      const hatch = entity as AcDbHatch
      return {
        type: 'HATCH',
        handle,
        ...style,
        solid_fill: hatch.isSolidFill,
        pattern_name: hatch.patternName || 'SOLID',
        paths
      }
    }

    if (entity instanceof AcDbMText || typeKey.includes('MTEXT')) {
      const mtext = entity as AcDbMText
      return {
        type: 'MTEXT',
        handle,
        ...style,
        text: mtext.contents,
        insert_point: xyz(mtext.location),
        height: mtext.height,
        width: mtext.width,
        rotation: (mtext.rotation * 180) / Math.PI,
        attachment_point: mtext.attachmentPoint
      }
    }

    if (entity instanceof AcDbText || /(^|\s)TEXT(\s|$)/.test(typeKey)) {
      const text = entity as AcDbText
      return {
        type: 'TEXT',
        handle,
        ...style,
        text: text.textString,
        insert_point: xyz(text.position),
        height: text.height,
        rotation: (text.rotation * 180) / Math.PI
      }
    }

    if (entity instanceof AcDbCircle || typeKey.includes('CIRCLE')) {
      const circle = entity as AcDbCircle
      return {
        type: 'CIRCLE',
        handle,
        ...style,
        center_point: xyz(circle.center),
        radius: circle.radius
      }
    }

    if (entity instanceof AcDbArc || typeKey.includes('ARC')) {
      const arc = entity as AcDbArc
      return {
        type: 'ARC',
        handle,
        ...style,
        center_point: xyz(arc.center),
        radius: arc.radius,
        start_angle: (arc.startAngle * 180) / Math.PI,
        end_angle: (arc.endAngle * 180) / Math.PI
      }
    }

    if (entity instanceof AcDbPoint || (typeKey.includes('POINT') && !typeKey.includes('DEFPOINT'))) {
      const point = entity as AcDbPoint
      return {
        type: 'POINT',
        handle,
        ...style,
        location: xyz(point.position)
      }
    }

    return null
  } catch {
    return null
  }
}

const listModelSpaceEntities = (): AcDbEntity[] => {
  try {
    return Array.from(AcApDocManager.instance.curDocument.database.tables.blockTable.modelSpace.newIterator())
  } catch {
    return []
  }
}

const collectLayers = (entities: EzdxfEntity[]): EzdxfLayer[] => {
  const byKey = new Map<string, EzdxfLayer>()

  try {
    const database = AcApDocManager.instance.curDocument.database
    for (const record of database.tables.layerTable.newIterator()) {
      const name = record.name?.trim()
      if (!name) {
        continue
      }
      byKey.set(name.toUpperCase(), {
        name,
        linetype: record.linetype || undefined,
        off: record.isOff,
        frozen: record.isFrozen,
        plot: record.isPlottable
      })
    }
  } catch {
    // Chưa mở bản vẽ.
  }

  for (const name of Object.values(DRAW_LAYER_BY_TOOL)) {
    const key = name.toUpperCase()
    if (!byKey.has(key)) {
      byKey.set(key, { name, color: '#382418', linetype: 'Continuous', off: false, frozen: false, plot: true })
    }
  }

  for (const entity of entities) {
    const name = entity.layer?.trim()
    if (!name) {
      continue
    }
    const key = name.toUpperCase()
    const existing = byKey.get(key)
    if (existing) {
      if (!existing.color && entity.color) {
        existing.color = entity.color
      }
      continue
    }
    byKey.set(key, {
      name,
      color: entity.color,
      linetype: entity.linetype,
      off: false,
      frozen: false,
      plot: true
    })
  }

  return Array.from(byKey.values())
}

const collectLayersFromEntities = (entities: EzdxfEntity[], extraNames: string[] = []): EzdxfLayer[] => {
  const byKey = new Map<string, EzdxfLayer>()
  for (const name of extraNames) {
    const trimmed = name.trim()
    if (!trimmed) {
      continue
    }
    byKey.set(trimmed.toUpperCase(), {
      name: trimmed,
      color: '#382418',
      linetype: 'Continuous',
      off: false,
      frozen: false,
      plot: true
    })
  }
  for (const entity of entities) {
    const name = entity.layer?.trim()
    if (!name) {
      continue
    }
    const key = name.toUpperCase()
    const existing = byKey.get(key)
    if (existing) {
      if (!existing.color && entity.color) {
        existing.color = entity.color
      }
      continue
    }
    byKey.set(key, {
      name,
      color: entity.color,
      linetype: entity.linetype,
      off: false,
      frozen: false,
      plot: true
    })
  }
  return Array.from(byKey.values())
}

export const collectEzdxfPayload = (kinds?: DrawAnnotationKind[]): EzdxfPayload => {
  const entities: EzdxfEntity[] = []
  const updates: EzdxfEntity[] = []
  const seen = new Set<string>()
  const changed = getChangedOriginalHandles()

  for (const annotation of listAnnotations()) {
    if (kinds && !kinds.includes(annotation.kind)) {
      continue
    }
    const isFile = annotation.source === 'file'
    for (const entityId of annotation.entityIds) {
      if (seen.has(entityId)) {
        continue
      }
      seen.add(entityId)
      const entity = getCadEntityById(entityId)
      if (!entity) {
        continue
      }
      const serialized = serializeEntity(entity)
      if (!serialized) {
        continue
      }
      if (isFile) {
        const handle = (serialized.handle || '').toUpperCase()
        if (handle && changed.has(handle)) {
          updates.push(serialized)
        }
        continue
      }
      entities.push(serialized)
    }
  }

  return {
    layers: collectLayers([...entities, ...updates]),
    entities,
    updates,
    removed_handles: Array.from(getRemovedOriginalHandles())
  }
}

export const collectSheetEzdxfPayload = (): EzdxfPayload => {
  const entities: EzdxfEntity[] = []
  const seen = new Set<string>()
  const drawLayers = new Set(Object.values(DRAW_LAYER_BY_TOOL).map((name) => name.trim().toUpperCase()))
  const layerNames = new Set([DRAW_LAYER_BY_TOOL.sheet.trim().toUpperCase()])
  let anonymous = 0

  const rememberSheetLayer = (name?: string) => {
    const layer = name?.trim().toUpperCase()
    if (layer && drawLayers.has(layer)) {
      layerNames.add(layer)
    }
  }

  const pushEntity = (entity: AcDbEntity | undefined) => {
    if (!entity) {
      return
    }
    const key = entity.objectId ? String(entity.objectId) : `__anon:${anonymous += 1}`
    if (seen.has(key)) {
      return
    }
    const serialized = serializeEntity(entity)
    if (!serialized) {
      return
    }
    seen.add(key)
    entities.push(serialized)
    rememberSheetLayer(entity.layer)
  }

  for (const annotation of listAnnotations()) {
    if (annotation.kind !== 'sheet' || annotation.source === 'file') {
      continue
    }
    if (annotation.layer?.trim()) {
      rememberSheetLayer(annotation.layer)
    }
    for (const entityId of annotation.entityIds) {
      pushEntity(getCadEntityById(entityId))
    }
  }

  for (const entity of listModelSpaceEntities()) {
    const layer = entity.layer?.trim().toUpperCase()
    if (layer && layerNames.has(layer)) {
      pushEntity(entity)
    }
  }

  return {
    layers: collectLayersFromEntities(entities, [DRAW_LAYER_BY_TOOL.sheet]),
    entities,
    updates: [],
    removed_handles: []
  }
}
