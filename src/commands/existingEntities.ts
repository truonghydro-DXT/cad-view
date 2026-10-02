import { AcApDocManager, type AcEdBaseView } from '@mlightcad/cad-simple-viewer'
import {
  AcDb2dPolyline,
  AcDbArc,
  AcDbBlockReference,
  AcDbCircle,
  AcDbEllipse,
  AcDbHatch,
  AcDbLine,
  AcDbMText,
  AcDbPoint,
  AcDbPolyline,
  AcDbText,
  AcDbViewport,
  AcGeBox2d,
  AcGeMatrix3d,
  AcGePoint2d,
  AcGePoint3d,
  AcGePolyline2d,
  type AcDbEntity
} from '@mlightcad/data-model'

import {
  findAnnotationByEntityId,
  registerAnnotation,
  retargetAnnotationEntity,
  type DrawAnnotation,
  type FileEntityEdit
} from './annotationRegistry'
import { appendEntity, buildPolyline, colorFromHex, worldSizeFromPixels } from './drawHelpers'
import { markOriginalEntityChanged, markOriginalEntityRemoved } from './originalDxfEdits'
import { stripMTextFormat, type TextDrawOptions } from './textCmd'

type Box = { minX: number; minY: number; maxX: number; maxY: number }

type MutableVertex = { x: number; y: number }

type PolylineGeo = {
  vertices?: MutableVertex[]
  closed?: boolean
  reset?: (reuse: boolean, numVerts?: number) => void
  addVertexAt?: (index: number, vertex: MutableVertex) => void
}

type HatchGeo = {
  loops?: Array<{ vertices?: MutableVertex[]; curves?: Array<Record<string, unknown>> }>
  _loops?: Array<{ vertices?: MutableVertex[] }>
}

const getDatabase = () => {
  try {
    return AcApDocManager.instance.curDocument.database
  } catch {
    return undefined
  }
}

export const getCadEntityById = (entityId: string) => {
  const database = getDatabase()
  if (!database) {
    return undefined
  }

  const exact = database.tables.blockTable.getEntityById(entityId)
  if (exact) {
    return exact
  }

  const model = database.tables.blockTable.modelSpace.getIdAt(entityId)
  if (model) {
    return model
  }

  const wanted = String(entityId)
  for (const entity of database.tables.blockTable.modelSpace.newIterator()) {
    if (String(entity.objectId) === wanted) {
      return entity
    }
  }

  return undefined
}

const iterateModelEntities = () => {
  const database = getDatabase()
  if (!database) {
    return [] as AcDbEntity[]
  }
  return Array.from(database.tables.blockTable.modelSpace.newIterator())
}

const entityTypeKey = (entity: AcDbEntity) =>
  `${entity.type || ''} ${entity.dxfTypeName || ''} ${entity.constructor?.name || ''}`.toUpperCase()

const classifyByTypeName = (
  entity: AcDbEntity
): { kind: DrawAnnotation['kind']; fileEdit: FileEntityEdit; closed?: boolean } | null => {
  const type = entityTypeKey(entity)
  if (type.includes('VIEWPORT')) {
    return null
  }
  if (type.includes('MTEXT') || type.includes('ACDBTEXT') || /(^|\s)TEXT(\s|$)/.test(type)) {
    return { kind: 'text', fileEdit: 'text' }
  }
  if (type.includes('CIRCLE')) {
    return { kind: 'circle', fileEdit: 'none' }
  }
  if (type.includes('POINT') && !type.includes('DEFPOINT')) {
    return { kind: 'point', fileEdit: 'none' }
  }
  if (type.includes('HATCH')) {
    return { kind: 'region', fileEdit: 'path', closed: true }
  }
  if (type.includes('POLYLINE')) {
    const closed = Boolean((entity as { closed?: boolean }).closed)
    return {
      kind: closed ? 'region' : 'line',
      fileEdit: 'path',
      closed
    }
  }
  if (type.includes('LINE') && !type.includes('XLINE') && !type.includes('MLINE')) {
    return { kind: 'line', fileEdit: 'path', closed: false }
  }
  return { kind: 'line', fileEdit: 'none' }
}

export const isValidBox = (minX: number, minY: number, maxX: number, maxY: number) =>
  Number.isFinite(minX) &&
  Number.isFinite(minY) &&
  Number.isFinite(maxX) &&
  Number.isFinite(maxY) &&
  maxX >= minX &&
  maxY >= minY

const boundsFromMText = (entity: AcDbMText): Box => {
  const location = entity.location
  const contents = stripMTextFormat(entity.contents || '')
  const height = Math.max(entity.height || 0, 1e-4)
  const width = Math.max(entity.width || 0, height * Math.max(contents.length, 2) * 0.7)
  const attachment = Number(entity.attachmentPoint) || 7
  const col = (attachment - 1) % 3
  const row = Math.floor((attachment - 1) / 3)
  const ax = col <= 0 ? 0 : col === 1 ? 0.5 : 1
  const ay = row <= 0 ? 1 : row === 1 ? 0.5 : 0
  const minX = location.x - ax * width
  const minY = location.y - ay * height
  return {
    minX,
    minY,
    maxX: minX + width,
    maxY: minY + height
  }
}

export const boundsFromCadEntity = (entity: AcDbEntity): Box | null => {
  if (entity instanceof AcDbMText) {
    return boundsFromMText(entity)
  }

  if (entity instanceof AcDbText) {
    const position = entity.position
    const width = Math.max(entity.height * Math.max(entity.textString.length, 1) * 0.7, entity.height)
    return {
      minX: position.x,
      minY: position.y,
      maxX: position.x + width,
      maxY: position.y + entity.height
    }
  }

  const box = entity.geometricExtents
  const minX = box.min.x
  const minY = box.min.y
  const maxX = box.max.x
  const maxY = box.max.y
  return isValidBox(minX, minY, maxX, maxY) ? { minX, minY, maxX, maxY } : null
}

export const shiftBox = (box: Box, dx: number, dy: number): Box => ({
  minX: box.minX + dx,
  minY: box.minY + dy,
  maxX: box.maxX + dx,
  maxY: box.maxY + dy
})

const polylineGeo = (entity: AcDbEntity): PolylineGeo | undefined =>
  (entity as unknown as { _geo?: PolylineGeo })._geo

const hatchGeo = (entity: AcDbHatch): HatchGeo | undefined =>
  (entity as unknown as { _geo?: HatchGeo })._geo

const classifyCadEntity = (
  entity: AcDbEntity
): { kind: DrawAnnotation['kind']; fileEdit: FileEntityEdit; closed?: boolean } | null => {
  if (entity instanceof AcDbViewport) {
    return null
  }
  if (entity instanceof AcDbMText || entity instanceof AcDbText) {
    return { kind: 'text', fileEdit: 'text' }
  }
  if (entity instanceof AcDbCircle) {
    return { kind: 'circle', fileEdit: 'none' }
  }
  if (entity instanceof AcDbPoint) {
    return { kind: 'point', fileEdit: 'none' }
  }
  if (entity instanceof AcDbHatch) {
    return { kind: 'region', fileEdit: 'path', closed: true }
  }
  if (entity instanceof AcDbPolyline) {
    return {
      kind: entity.closed ? 'region' : 'line',
      fileEdit: 'path',
      closed: entity.closed
    }
  }
  if (entity instanceof AcDb2dPolyline) {
    return {
      kind: entity.closed ? 'region' : 'line',
      fileEdit: 'path',
      closed: entity.closed
    }
  }
  if (entity instanceof AcDbLine) {
    return { kind: 'line', fileEdit: 'path', closed: false }
  }
  return classifyByTypeName(entity)
}

const scoreEntityAtWorld = (
  entity: AcDbEntity,
  world: { x: number; y: number },
  pad: number
) => {
  const box = boundsFromCadEntity(entity)
  if (!box) {
    return Number.POSITIVE_INFINITY
  }
  if (
    world.x < box.minX - pad ||
    world.x > box.maxX + pad ||
    world.y < box.minY - pad ||
    world.y > box.maxY + pad
  ) {
    return Number.POSITIVE_INFINITY
  }

  const outsideX = Math.max(box.minX - world.x, 0, world.x - box.maxX)
  const outsideY = Math.max(box.minY - world.y, 0, world.y - box.maxY)
  const area = Math.max(box.maxX - box.minX, pad) * Math.max(box.maxY - box.minY, pad)
  return Math.hypot(outsideX, outsideY) * 1e9 + area
}

const findModelEntityAtWorld = (world: { x: number; y: number }, pad: number) => {
  let best: AcDbEntity | undefined
  let bestScore = Number.POSITIVE_INFINITY
  for (const entity of iterateModelEntities()) {
    const score = scoreEntityAtWorld(entity, world, pad)
    if (score < bestScore) {
      best = entity
      bestScore = score
    }
  }
  return best
}

const collectHitIds = (view: AcEdBaseView, world: { x: number; y: number }, clientX?: number, clientY?: number) => {
  const ids = new Set<string>()
  const pad = worldSizeFromPixels(view, 28)

  try {
    const hits = view.search(
      new AcGeBox2d(
        { x: world.x - pad, y: world.y - pad },
        { x: world.x + pad, y: world.y + pad }
      )
    )
    for (const hit of hits) {
      if (hit.id) {
        ids.add(hit.id)
      }
    }
  } catch {
    // Spatial index may not be ready.
  }

  try {
    const point =
      clientX != null && clientY != null
        ? view.viewportToCanvas({ x: clientX, y: clientY })
        : view.worldToScreen(world)
    for (const hit of view.pick(point, 24, false)) {
      if (hit.id) {
        ids.add(hit.id)
      }
    }
  } catch {
    // Picking can fail before the view is ready.
  }

  return { ids, pad }
}

export const adoptCadEntityAtWorld = (
  view: AcEdBaseView,
  world: { x: number; y: number },
  clientX?: number,
  clientY?: number,
  preferNonText = false
) => {
  const { ids, pad } = collectHitIds(view, world, clientX, clientY)
  const candidates: DrawAnnotation[] = []

  for (const id of ids) {
    const annotation = adoptCadEntityById(id)
    if (annotation) {
      candidates.push(annotation)
    }
  }

  if (candidates.length === 0) {
    const entity = findModelEntityAtWorld(world, pad)
    const annotation = entity ? adoptCadEntity(entity) : undefined
    if (annotation) {
      candidates.push(annotation)
    }
  }

  if (candidates.length === 0) {
    return undefined
  }

  const ranked = candidates
    .map((annotation) => {
      const entity = getCadEntityById(annotation.entityIds[0] ?? '')
      const score = entity ? scoreEntityAtWorld(entity, world, pad) : Number.POSITIVE_INFINITY
      return { annotation, score }
    })
    .sort((left, right) => left.score - right.score)

  if (preferNonText) {
    return ranked.find((item) => item.annotation.kind !== 'text')?.annotation ?? ranked[0]?.annotation
  }

  return ranked[0]?.annotation
}

export const adoptCadEntity = (entity: AcDbEntity) => {
  const existing = findAnnotationByEntityId(entity.objectId)
  if (existing) {
    return existing
  }

  const classified = classifyCadEntity(entity)
  if (!classified || !entity.objectId) {
    return undefined
  }

  const annotation: DrawAnnotation = {
    id: `file-${entity.objectId}`,
    kind: classified.kind,
    source: 'file',
    fileEdit: classified.fileEdit,
    entityIds: [entity.objectId],
    closed: classified.closed,
    bounds: boundsFromCadEntity(entity) ?? undefined,
    layer: entity.layer
  }

  if (entity instanceof AcDbMText) {
    annotation.text = {
      contents: stripMTextFormat(entity.contents),
      font: '',
      fontSize: entity.height || 0,
      rotation: (entity.rotation * 180) / Math.PI,
      color: ''
    }
  } else if (entity instanceof AcDbText) {
    annotation.text = {
      contents: entity.textString,
      font: '',
      fontSize: entity.height || 0,
      rotation: (entity.rotation * 180) / Math.PI,
      color: ''
    }
  }

  registerAnnotation(annotation)
  return annotation
}

export const adoptCadEntityById = (entityId: string) => {
  const existing = findAnnotationByEntityId(entityId)
  if (existing) {
    return existing
  }
  const entity = getCadEntityById(entityId)
  return entity ? adoptCadEntity(entity) : undefined
}

export const pickCadHits = (view: AcEdBaseView, clientX: number, clientY: number) => {
  const canvasPoint = view.viewportToCanvas({ x: clientX, y: clientY })
  return view.pick(canvasPoint, 16, false)
}

export const adoptCadEntityAtClient = (
  view: AcEdBaseView,
  clientX: number,
  clientY: number,
  preferNonText = false
) => {
  const world = view.screenToWorld(view.viewportToCanvas({ x: clientX, y: clientY }))
  return adoptCadEntityAtWorld(view, world, clientX, clientY, preferNonText)
}

const isTextEntity = (entity: AcDbEntity) => {
  if (entity instanceof AcDbMText || entity instanceof AcDbText) {
    return true
  }
  const type = entityTypeKey(entity)
  return type.includes('MTEXT') || type.includes('ACDBTEXT') || /(^|\s)TEXT(\s|$)/.test(type)
}

type BufferAttr = {
  count?: number
  itemSize?: number
  needsUpdate?: boolean
  getX?: (index: number) => number
  getY?: (index: number) => number
  getZ?: (index: number) => number
  setXYZ?: (index: number, x: number, y: number, z: number) => void
  addUpdateRange?: (start: number, count: number) => void
}

type SceneObject = {
  position?: { x: number; y: number }
  matrix?: { elements?: number[] }
  userData?: { objectId?: string; id?: string }
  children?: SceneObject[]
  geometry?: {
    attributes?: Record<string, BufferAttr>
    computeBoundingBox?: () => void
    computeBoundingSphere?: () => void
  }
  updateMatrix?: () => void
  updateMatrixWorld?: (force?: boolean) => void
}

type BatchedEntry = {
  batchedObjectId?: number
  batchId?: number
}

type GeometryInfo = {
  vertexStart?: number
  vertexCount?: number
  position?: { x: number; y: number; z?: number }
}

type BatchedMesh = SceneObject & {
  _geometryInfo?: GeometryInfo[]
}

type BatchedGroup = {
  _unbatchedEntities?: Map<string, SceneObject[]>
  _entitiesMap?: Map<string, BatchedEntry[]>
  _selectedObjects?: { children?: SceneObject[] }
  _hoverObjects?: { children?: SceneObject[] }
  getObjectById?: (id: number) => BatchedMesh | undefined
}

type SceneLayer = {
  name?: string
  hasEntity?: (id: string) => boolean
  updateEntity?: (entity: unknown) => boolean
  internalObject?: BatchedGroup
}

const getActiveLayoutLayers = () => {
  const view = AcApDocManager.instance.curView as unknown as {
    renderer?: unknown
    _renderer?: unknown
    _scene?: {
      activeLayout?: {
        getLayer?: (name: string) => SceneLayer | undefined
        _layers?: Map<string, SceneLayer>
      }
    }
    _isDirty?: boolean
  }
  return { view, layout: view._scene?.activeLayout }
}

const markViewDirty = () => {
  const { view } = getActiveLayoutLayers()
  view._isDirty = true
  setTimeout(() => {
    view._isDirty = true
  }, 100)
}

const idMatches = (value: unknown, objectId: string) =>
  value != null && String(value) === String(objectId)

const mapGet = <T,>(map: Map<string, T> | undefined, objectId: string) => {
  if (!map) {
    return undefined
  }
  const direct = map.get(objectId) ?? map.get(String(objectId))
  if (direct) {
    return direct
  }
  const wanted = String(objectId)
  for (const [key, value] of map) {
    if (String(key) === wanted) {
      return value
    }
  }
  return undefined
}

const shiftSceneObject = (object: SceneObject, dx: number, dy: number) => {
  if (object.position) {
    object.position.x += dx
    object.position.y += dy
    object.updateMatrix?.()
    object.updateMatrixWorld?.(true)
    return true
  }
  const elements = object.matrix?.elements
  if (elements && elements.length >= 14) {
    elements[12] += dx
    elements[13] += dy
    object.updateMatrixWorld?.(true)
    return true
  }
  return false
}

const shiftAttributeRange = (
  attribute: BufferAttr | undefined,
  start: number,
  count: number,
  dx: number,
  dy: number
) => {
  if (!attribute?.setXYZ || !attribute.getX || !attribute.getY || !attribute.getZ) {
    return false
  }
  const end = Math.min(start + count, attribute.count ?? start + count)
  for (let index = start; index < end; index += 1) {
    attribute.setXYZ(index, attribute.getX(index) + dx, attribute.getY(index) + dy, attribute.getZ(index))
  }
  attribute.needsUpdate = true
  attribute.addUpdateRange?.(start * (attribute.itemSize ?? 3), (end - start) * (attribute.itemSize ?? 3))
  return end > start
}

const translateBatchedEntry = (group: BatchedGroup, entry: BatchedEntry, dx: number, dy: number) => {
  if (entry.batchedObjectId == null || entry.batchId == null) {
    return false
  }
  const batch = group.getObjectById?.(entry.batchedObjectId)
  const info = batch?._geometryInfo?.[entry.batchId]
  const attributes = batch?.geometry?.attributes
  if (!batch || !info || !attributes) {
    return false
  }

  const start = info.vertexStart ?? 0
  const count = info.vertexCount && info.vertexCount > 0 ? info.vertexCount : 0
  let moved = false
  if (count > 0) {
    if (attributes.position) {
      moved = shiftAttributeRange(attributes.position, start, count, dx, dy) || moved
    }
    if (attributes.instanceStart) {
      moved = shiftAttributeRange(attributes.instanceStart, start, count, dx, dy) || moved
    }
    if (attributes.instanceEnd) {
      moved = shiftAttributeRange(attributes.instanceEnd, start, count, dx, dy) || moved
    }
  }
  if (info.position) {
    info.position.x += dx
    info.position.y += dy
    moved = true
  }
  if (moved) {
    batch.geometry?.computeBoundingBox?.()
    batch.geometry?.computeBoundingSphere?.()
  }
  return moved
}

const translateInBatchedGroup = (group: BatchedGroup | undefined, objectId: string, dx: number, dy: number) => {
  if (!group) {
    return false
  }

  let moved = false
  const unbatched = mapGet(group._unbatchedEntities, objectId)
  if (unbatched?.length) {
    for (const object of unbatched) {
      moved = shiftSceneObject(object, dx, dy) || moved
    }
  }

  const batched = mapGet(group._entitiesMap, objectId)
  if (batched?.length) {
    for (const entry of batched) {
      moved = translateBatchedEntry(group, entry, dx, dy) || moved
    }
  }

  if (moved) {
    for (const bucket of [group._selectedObjects, group._hoverObjects]) {
      for (const child of bucket?.children ?? []) {
        if (idMatches(child.userData?.objectId, objectId) || idMatches(child.userData?.id, objectId)) {
          shiftSceneObject(child, dx, dy)
        }
      }
    }
  }

  return moved
}

const collectSceneLayers = (entity: AcDbEntity) => {
  const { layout } = getActiveLayoutLayers()
  const layers: SceneLayer[] = []
  const named = entity.layer ? layout?.getLayer?.(entity.layer) : undefined
  if (named) {
    layers.push(named)
  }
  if (layout?._layers) {
    for (const layer of layout._layers.values()) {
      if (layer !== named) {
        layers.push(layer)
      }
    }
  }
  return layers
}

const updateEntityOnOwnLayer = (entity: AcDbEntity) => {
  if (!entity.objectId) {
    return false
  }
  const { view, layout } = getActiveLayoutLayers()
  const renderer = view._renderer ?? view.renderer
  if (!renderer) {
    return false
  }

  let three: { objectId?: string; ownerId?: string; layerName?: string; visible?: boolean } | null = null
  try {
    three = (entity as AcDbEntity & { worldDraw?: (renderer: unknown) => typeof three }).worldDraw?.(renderer) ?? null
  } catch {
    return false
  }
  if (!three) {
    return false
  }

  three.objectId = entity.objectId
  three.ownerId = entity.ownerId
  three.layerName = entity.layer
  three.visible = entity.visibility

  const layer =
    (entity.layer ? layout?.getLayer?.(entity.layer) : undefined) ??
    collectSceneLayers(entity).find((item) => item.hasEntity?.(entity.objectId))
  if (!layer?.updateEntity) {
    return false
  }

  const updated = layer.updateEntity(three)
  if (updated) {
    markViewDirty()
  }
  return updated
}

export const translateSceneObject = (entity: AcDbEntity, dx: number, dy: number) => {
  if (!entity.objectId || (!dx && !dy)) {
    return false
  }

  for (const layer of collectSceneLayers(entity)) {
    if (translateInBatchedGroup(layer.internalObject, entity.objectId, dx, dy)) {
      markViewDirty()
      return true
    }
  }

  return false
}

export const refreshCadEntity = (entity: AcDbEntity, shift?: { dx: number; dy: number }) => {
  if (isTextEntity(entity)) {
    if (shift) {
      translateSceneObject(entity, shift.dx, shift.dy)
    }
    return
  }

  const view = AcApDocManager.instance.curView
  view.removeEntity(entity)
  view.updateEntity(entity)
}

export const refreshFileTextContent = (entity: AcDbEntity) => {
  if (!isTextEntity(entity)) {
    return
  }
  updateEntityOnOwnLayer(entity)
}

const shiftVertices = (vertices: MutableVertex[] | undefined, dx: number, dy: number) => {
  if (!vertices) {
    return false
  }
  for (const vertex of vertices) {
    vertex.x += dx
    vertex.y += dy
  }
  return vertices.length > 0
}

const shiftPointLike = (point: MutableVertex, dx: number, dy: number) => ({
  x: point.x + dx,
  y: point.y + dy
})

const translateHatchLoop = (loop: { vertices?: MutableVertex[]; curves?: Array<Record<string, unknown>> }, dx: number, dy: number) => {
  if (shiftVertices(loop.vertices, dx, dy)) {
    return true
  }

  const curves = loop.curves
  if (!curves?.length) {
    return false
  }

  for (const curve of curves) {
    const start = curve.startPoint as MutableVertex | undefined
    const end = curve.endPoint as MutableVertex | undefined
    const center = curve.center as MutableVertex | undefined
    if (start && 'startPoint' in curve) {
      curve.startPoint = shiftPointLike(start, dx, dy)
    }
    if (end && 'endPoint' in curve) {
      curve.endPoint = shiftPointLike(end, dx, dy)
    }
    if (center && 'center' in curve) {
      curve.center = shiftPointLike(center, dx, dy)
    }
  }
  return true
}

const copyEntityStyle = (from: AcDbEntity, to: AcDbEntity) => {
  to.layer = from.layer
  to.color = from.color
  to.lineType = from.lineType
  to.lineWeight = from.lineWeight
}

const translateByMatrix = (entity: AcDbEntity, dx: number, dy: number) => {
  entity.transformBy(new AcGeMatrix3d().makeTranslation(dx, dy, 0))
  return true
}

const invalidateGeoBox = (entity: AcDbEntity) => {
  const geo = (entity as unknown as { _geo?: { _boundingBoxNeedsUpdate?: boolean } })._geo
  if (geo) {
    geo._boundingBoxNeedsUpdate = true
  }
}

const translateCadEntityGeometry = (entity: AcDbEntity, dx: number, dy: number) => {
  if (!dx && !dy) {
    return true
  }

  if (
    entity instanceof AcDbLine ||
    entity instanceof AcDbCircle ||
    entity instanceof AcDbArc ||
    entity instanceof AcDbPoint
  ) {
    const ok = translateByMatrix(entity, dx, dy)
    invalidateGeoBox(entity)
    return ok
  }

  if (entity instanceof AcDbEllipse) {
    const center = entity.center
    entity.center = { x: center.x + dx, y: center.y + dy, z: center.z }
    return true
  }

  if (entity instanceof AcDbMText) {
    const location = entity.location
    entity.location = {
      x: location.x + dx,
      y: location.y + dy,
      z: location.z ?? 0
    }
    return true
  }

  if (entity instanceof AcDbText) {
    const position = entity.position
    entity.position = new AcGePoint3d(position.x + dx, position.y + dy, position.z)
    return true
  }

  if (entity instanceof AcDbBlockReference) {
    const position = entity.position
    entity.position = { x: position.x + dx, y: position.y + dy, z: position.z }
    return true
  }

  if (entity instanceof AcDbHatch) {
    const loops = hatchGeo(entity)?.loops
    if (!loops?.length) {
      return false
    }
    let moved = false
    for (const loop of loops) {
      moved = translateHatchLoop(loop, dx, dy) || moved
    }
    return moved
  }

  if (entity instanceof AcDbPolyline || entity instanceof AcDb2dPolyline) {
    const moved = shiftVertices(polylineGeo(entity)?.vertices, dx, dy)
    invalidateGeoBox(entity)
    return moved
  }

  const geo = polylineGeo(entity)
  if (shiftVertices(geo?.vertices, dx, dy)) {
    invalidateGeoBox(entity)
    return true
  }

  return translateByMatrix(entity, dx, dy)
}

export const translateCadEntity = (entity: AcDbEntity, dx: number, dy: number) => {
  const moved = translateCadEntityGeometry(entity, dx, dy)
  if (moved && (dx || dy)) {
    markOriginalEntityChanged(entity.objectId)
  }
  return moved
}

const replaceFileEntity = (annotation: DrawAnnotation, oldEntity: AcDbEntity, next: AcDbEntity) => {
  const oldId = oldEntity.objectId
  markOriginalEntityRemoved(oldId)
  const docManager = AcApDocManager.instance
  docManager.curView.removeEntity(oldEntity)
  oldEntity.erase()
  appendEntity(docManager.context, next, oldEntity.layer)
  if (oldId && next.objectId) {
    retargetAnnotationEntity(annotation, oldId, next.objectId)
  }
  return next
}

const cloneShiftedFileEntity = (entity: AcDbEntity, dx: number, dy: number) => {
  if (isTextEntity(entity)) {
    return null
  }

  const path = readCadEntityPath(entity)
  if (path && path.points.length >= 2) {
    const points = path.points.map((point) => new AcGePoint2d(point.x + dx, point.y + dy))
    if (entity instanceof AcDbHatch || entityTypeKey(entity).includes('HATCH')) {
      const source = entity as AcDbHatch
      const next = new AcDbHatch()
      copyEntityStyle(source, next)
      next.patternName = source.patternName
      next.patternType = source.patternType
      next.isSolidFill = source.isSolidFill
      next.patternScale = source.patternScale
      next.patternAngle = source.patternAngle
      next.add(new AcGePolyline2d(points.map((point) => ({ x: point.x, y: point.y })), true))
      return next
    }

    const next = buildPolyline(points, path.closed)
    copyEntityStyle(entity, next)
    return next
  }

  return null
}

export const translateFileAnnotation = (annotation: DrawAnnotation, dx: number, dy: number) => {
  if (!dx && !dy) {
    return false
  }

  let moved = false
  const entityIds = [...annotation.entityIds]
  for (const entityId of entityIds) {
    const entity = getCadEntityById(entityId)
    if (!entity) {
      continue
    }

    if (isTextEntity(entity)) {
      if (translateCadEntity(entity, dx, dy)) {
        if (!translateSceneObject(entity, dx, dy)) {
          updateEntityOnOwnLayer(entity)
        }
        moved = true
      }
      continue
    }

    const replacement = cloneShiftedFileEntity(entity, dx, dy)
    if (replacement) {
      replaceFileEntity(annotation, entity, replacement)
      moved = true
      continue
    }

    if (translateCadEntity(entity, dx, dy)) {
      AcApDocManager.instance.curView.updateEntity(entity)
      moved = true
    }
  }

  if (moved) {
    const current = getCadEntityById(annotation.entityIds[0] ?? '')
    annotation.bounds = current
      ? boundsFromCadEntity(current) ?? (annotation.bounds ? shiftBox(annotation.bounds, dx, dy) : undefined)
      : annotation.bounds
        ? shiftBox(annotation.bounds, dx, dy)
        : undefined
  }

  return moved
}

export const readCadEntityPath = (entity: AcDbEntity) => {
  if (entity instanceof AcDbPolyline && entity.numberOfVertices >= 2) {
    return {
      points: Array.from({ length: entity.numberOfVertices }, (_, index) => {
        const point = entity.getPoint2dAt(index)
        return new AcGePoint2d(point.x, point.y)
      }),
      closed: entity.closed
    }
  }

  if (entity instanceof AcDb2dPolyline && entity.numberOfVertices >= 2) {
    return {
      points: Array.from({ length: entity.numberOfVertices }, (_, index) => {
        const point = entity.getPointAt(index)
        return new AcGePoint2d(point.x, point.y)
      }),
      closed: entity.closed
    }
  }

  if (entity instanceof AcDbLine) {
    return {
      points: [
        new AcGePoint2d(entity.startPoint.x, entity.startPoint.y),
        new AcGePoint2d(entity.endPoint.x, entity.endPoint.y)
      ],
      closed: false
    }
  }

  if (entity instanceof AcDbHatch) {
    const loop = hatchGeo(entity)?.loops?.[0]
    const vertices = loop?.vertices
    if (vertices && vertices.length >= 3) {
      return {
        points: vertices.map((vertex) => new AcGePoint2d(vertex.x, vertex.y)),
        closed: true
      }
    }
  }

  return null
}

const replacePolylineGeo = (entity: AcDbEntity, points: AcGePoint2d[], closed: boolean) => {
  const geo = polylineGeo(entity)
  if (!geo?.reset || !geo.addVertexAt) {
    return false
  }
  geo.reset(false)
  points.forEach((point, index) => geo.addVertexAt?.(index, { x: point.x, y: point.y }))
  geo.closed = closed
  if ('closed' in entity) {
    ;(entity as AcDbPolyline).closed = closed
  }
  return true
}

export const writeCadEntityPath = (entity: AcDbEntity, points: AcGePoint2d[], closed: boolean) => {
  if (points.length < 2) {
    return false
  }

  if (entity instanceof AcDbPolyline) {
    entity.reset(false)
    points.forEach((point, index) => entity.addVertexAt(index, point))
    entity.closed = closed
    return true
  }

  if (entity instanceof AcDb2dPolyline) {
    return replacePolylineGeo(entity, points, closed)
  }

  if (entity instanceof AcDbLine) {
    if (points.length > 2) {
      return false
    }
    entity.startPoint = { x: points[0].x, y: points[0].y, z: entity.startPoint.z }
    const last = points[points.length - 1]
    entity.endPoint = { x: last.x, y: last.y, z: entity.endPoint.z }
    return true
  }

  if (entity instanceof AcDbHatch && points.length >= 3) {
    const geo = hatchGeo(entity)
    if (geo?._loops) {
      geo._loops.length = 0
    } else if (geo?.loops) {
      ;(geo.loops as MutableVertex[]).length = 0
    }
    entity.add(new AcGePolyline2d(points.map((point) => ({ x: point.x, y: point.y })), true))
    return true
  }

  const duck = entity as AcDbEntity & {
    reset?: (reuse: boolean) => void
    addVertexAt?: (index: number, point: AcGePoint2d) => void
    closed?: boolean
    startPoint?: { x: number; y: number; z?: number }
    endPoint?: { x: number; y: number; z?: number }
    add?: (loop: AcGePolyline2d) => void
  }
  if (duck.reset && duck.addVertexAt) {
    duck.reset(false)
    points.forEach((point, index) => duck.addVertexAt?.(index, point))
    if (duck.closed != null) {
      duck.closed = closed
    }
    return true
  }
  if (duck.startPoint && duck.endPoint && points.length >= 2) {
    duck.startPoint = { x: points[0].x, y: points[0].y, z: duck.startPoint.z ?? 0 }
    const last = points[points.length - 1]
    duck.endPoint = { x: last.x, y: last.y, z: duck.endPoint.z ?? 0 }
    return true
  }
  if (duck.add && points.length >= 3) {
    const geo = hatchGeo(entity as AcDbHatch)
    if (geo?._loops) {
      geo._loops.length = 0
    }
    duck.add(new AcGePolyline2d(points.map((point) => ({ x: point.x, y: point.y })), true))
    return true
  }

  return false
}

export const updateFileTextEntity = (entity: AcDbEntity, options: TextDrawOptions) => {
  const contents = options.contents.trim()
  if (!contents) {
    return false
  }

  const rotation = (options.rotation * Math.PI) / 180
  let view
  try {
    view = AcApDocManager.instance.curView
  } catch {
    view = undefined
  }
  const height =
    view && options.fontSize
      ? worldSizeFromPixels(view, Math.max(8, Math.min(200, options.fontSize)))
      : undefined
  const color = options.color ? colorFromHex(options.color) : undefined

  if (entity instanceof AcDbMText) {
    entity.contents = contents
    entity.rotation = rotation
    entity.direction = { x: Math.cos(rotation), y: Math.sin(rotation), z: 0 }
    if (height) {
      entity.height = height
      entity.width = Math.max(height * contents.length * 0.7, height * 4)
    }
    if (color) {
      entity.color = color
    }
    markOriginalEntityChanged(entity.objectId)
    return true
  }

  if (entity instanceof AcDbText) {
    entity.textString = contents
    entity.rotation = rotation
    if (height) {
      entity.height = height
    }
    if (color) {
      entity.color = color
    }
    markOriginalEntityChanged(entity.objectId)
    return true
  }

  return false
}

export const writeFileAnnotationPath = (
  annotation: DrawAnnotation,
  points: AcGePoint2d[],
  closed: boolean
) => {
  const entity = getFilePathEntity(annotation)
  if (!entity) {
    return false
  }

  if (entity instanceof AcDbLine && points.length > 2) {
    replaceFileLineWithPolyline(annotation, entity, points, closed)
    return true
  }

  if (!writeCadEntityPath(entity, points, closed)) {
    return false
  }

  markOriginalEntityChanged(entity.objectId)
  refreshCadEntity(entity)
  return true
}

export const replaceFileLineWithPolyline = (
  annotation: DrawAnnotation,
  line: AcDbLine,
  points: AcGePoint2d[],
  closed: boolean
) => {
  const oldId = line.objectId
  markOriginalEntityRemoved(oldId)
  const polyline = buildPolyline(points, closed)
  copyEntityStyle(line, polyline)
  const docManager = AcApDocManager.instance
  docManager.curView.removeEntity(line)
  line.erase()
  appendEntity(docManager.context, polyline, line.layer)
  if (polyline.objectId && oldId) {
    retargetAnnotationEntity(annotation, oldId, polyline.objectId)
  }
  return polyline
}

export const getFilePathEntity = (annotation: DrawAnnotation) => {
  for (const entityId of annotation.entityIds) {
    const entity = getCadEntityById(entityId)
    if (!entity) {
      continue
    }
    if (
      entity instanceof AcDbPolyline ||
      entity instanceof AcDb2dPolyline ||
      entity instanceof AcDbLine ||
      entity instanceof AcDbHatch
    ) {
      return entity
    }
    const classified = classifyByTypeName(entity)
    if (classified?.fileEdit === 'path') {
      return entity
    }
  }
  return undefined
}
