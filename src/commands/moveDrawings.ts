import { AcApDocManager, type AcEdBaseView } from '@mlightcad/cad-simple-viewer'
import {
  AcDbMText,
  AcDbPolyline,
  AcGePoint2d,
  type AcDbEntity
} from '@mlightcad/data-model'
import { ElMessage } from 'element-plus'

import {
  collectAnnotationsFromEntityIds,
  eraseAnnotationEntities,
  isFileAnnotation,
  listAnnotations,
  type DrawAnnotation
} from './annotationRegistry'
import { worldSizeFromPixels } from './drawHelpers'
import {
  adoptCadEntityAtClient,
  boundsFromCadEntity,
  getCadEntityById,
  isValidBox,
  translateCadEntity,
  translateFileAnnotation,
  translateSceneObject
} from './existingEntities'
import { createCircleAnnotation } from './circleCmd'
import { recordDrawUndo } from './drawUndoStack'
import { createGridAnnotation } from './gridCmd'
import { createLineAnnotation } from './lineCmd'
import { createPointAnnotation } from './pointCmd'
import { createRegionAnnotation } from './regionCmd'
import { createTableAnnotation } from './tableCmd'
import { createScaleAnnotation } from './scaleCmd'
import {
  applySheetPartMove,
  createSheetAnnotation,
  resolveSheetTable,
  sheetOuterFrame,
  sheetPartKindForRole,
  shiftSheetTableBounds,
  type SheetMoveTarget,
  type SheetTableRole
} from './sheetCmd'
import { createTextAnnotation, hitCadTextAtWorld, stripMTextFormat } from './textCmd'
import { store } from '../store'

export type MoveGhostStyle = {
  left: string
  top: string
  width: string
  height: string
}

type DragState = {
  pointerId: number
  startClient: { x: number; y: number }
  startWorld: { x: number; y: number }
  startBounds: { left: number; top: number; width: number; height: number }
  targets: DrawAnnotation[]
  sheetTarget?: SheetMoveTarget
}

let drag: DragState | null = null

export const isDrawMoving = () => store.activeDrawTool === 'move' || Boolean(drag)

export const isPointerMoving = () => Boolean(drag)

const getView = () => AcApDocManager.instance.curView

const clientToWorld = (view: AcEdBaseView, clientX: number, clientY: number) =>
  view.screenToWorld(view.viewportToCanvas({ x: clientX, y: clientY }))

const worldToClient = (view: AcEdBaseView, x: number, y: number) =>
  view.canvasToViewport(view.worldToScreen({ x, y }))

const collectEntities = (annotations: DrawAnnotation[]) => {
  const entities: AcDbEntity[] = []
  for (const annotation of annotations) {
    for (const entityId of annotation.entityIds) {
      const entity = getCadEntityById(entityId)
      if (entity) {
        entities.push(entity)
      }
    }
  }
  return entities
}

const boundsFromEntity = (entity: AcDbEntity) => boundsFromCadEntity(entity)

const getWorldBounds = (annotations: DrawAnnotation[]) => {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY

  const includeBox = (box: { minX: number; minY: number; maxX: number; maxY: number }) => {
    if (!isValidBox(box.minX, box.minY, box.maxX, box.maxY)) {
      return
    }
    minX = Math.min(minX, box.minX)
    minY = Math.min(minY, box.minY)
    maxX = Math.max(maxX, box.maxX)
    maxY = Math.max(maxY, box.maxY)
  }

  for (const annotation of annotations) {
    if (annotation.bounds && isValidBox(
      annotation.bounds.minX,
      annotation.bounds.minY,
      annotation.bounds.maxX,
      annotation.bounds.maxY
    )) {
      includeBox(annotation.bounds)
      continue
    }
    for (const entity of collectEntities([annotation])) {
      const box = boundsFromEntity(entity)
      if (box) {
        includeBox(box)
      }
    }
  }

  if (!isValidBox(minX, minY, maxX, maxY)) {
    return null
  }

  return { minX, minY, maxX, maxY }
}

const getClientBounds = (view: AcEdBaseView, annotations: DrawAnnotation[]) => {
  const world = getWorldBounds(annotations)
  if (!world) {
    return null
  }

  const a = worldToClient(view, world.minX, world.minY)
  const b = worldToClient(view, world.maxX, world.maxY)
  const left = Math.min(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const width = Math.max(Math.abs(b.x - a.x), 28)
  const height = Math.max(Math.abs(b.y - a.y), 28)
  return { left, top, width, height }
}

const clientBoundsFromWorld = (
  view: AcEdBaseView,
  world: { minX: number; minY: number; maxX: number; maxY: number }
) => {
  const a = worldToClient(view, world.minX, world.minY)
  const b = worldToClient(view, world.maxX, world.maxY)
  const left = Math.min(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const width = Math.max(Math.abs(b.x - a.x), 28)
  const height = Math.max(Math.abs(b.y - a.y), 28)
  return { left, top, width, height }
}

export const findAnnotationAtWorld = (view: AcEdBaseView, world: { x: number; y: number }) => {
  const pad = worldSizeFromPixels(view, 22)
  let best: DrawAnnotation | undefined
  let bestArea = Number.POSITIVE_INFINITY

  const consider = (annotation: DrawAnnotation, minX: number, minY: number, maxX: number, maxY: number) => {
    if (
      world.x < minX - pad ||
      world.x > maxX + pad ||
      world.y < minY - pad ||
      world.y > maxY + pad
    ) {
      return
    }
    const area = Math.max(maxX - minX, 1) * Math.max(maxY - minY, 1)
    if (area < bestArea) {
      best = annotation
      bestArea = area
    }
  }

  for (const annotation of listAnnotations()) {
    if (annotation.bounds && isValidBox(
      annotation.bounds.minX,
      annotation.bounds.minY,
      annotation.bounds.maxX,
      annotation.bounds.maxY
    )) {
      consider(
        annotation,
        annotation.bounds.minX,
        annotation.bounds.minY,
        annotation.bounds.maxX,
        annotation.bounds.maxY
      )
      continue
    }
    for (const entity of collectEntities([annotation])) {
      const box = boundsFromEntity(entity)
      if (box) {
        consider(annotation, box.minX, box.minY, box.maxX, box.maxY)
      }
    }
  }

  return best
}

const pointInBox = (
  box: { minX: number; minY: number; maxX: number; maxY: number },
  world: { x: number; y: number },
  pad = 0
) =>
  world.x >= box.minX - pad &&
  world.x <= box.maxX + pad &&
  world.y >= box.minY - pad &&
  world.y <= box.maxY + pad

const boxArea = (box: { minX: number; minY: number; maxX: number; maxY: number }) =>
  Math.max(box.maxX - box.minX, 1e-6) * Math.max(box.maxY - box.minY, 1e-6)

const unionEntityBounds = (annotation: DrawAnnotation, match: (role: string) => boolean) => {
  let minX = Number.POSITIVE_INFINITY
  let minY = Number.POSITIVE_INFINITY
  let maxX = Number.NEGATIVE_INFINITY
  let maxY = Number.NEGATIVE_INFINITY
  let found = false
  for (const entityId of annotation.entityIds) {
    const role = annotation.sheetRoles?.[entityId]
    if (!role || !match(role)) {
      continue
    }
    const entity = getCadEntityById(entityId)
    const box = entity ? boundsFromEntity(entity) : null
    if (!box) {
      continue
    }
    found = true
    minX = Math.min(minX, box.minX)
    minY = Math.min(minY, box.minY)
    maxX = Math.max(maxX, box.maxX)
    maxY = Math.max(maxY, box.maxY)
  }
  return found && isValidBox(minX, minY, maxX, maxY) ? { minX, minY, maxX, maxY } : null
}

export const findSheetMoveTarget = (
  annotation: DrawAnnotation,
  world: { x: number; y: number },
  pad: number
): SheetMoveTarget | undefined => {
  if (annotation.kind !== 'sheet' || isFileAnnotation(annotation)) {
    return undefined
  }

  type Candidate = { target: SheetMoveTarget; outside: number; area: number; prefer: number }
  let best: Candidate | undefined

  const consider = (candidate: Candidate) => {
    if (!best) {
      best = candidate
      return
    }
    if (candidate.prefer < best.prefer) {
      best = candidate
      return
    }
    if (best.prefer < candidate.prefer) {
      return
    }
    if (candidate.outside < best.outside - 1e-12) {
      best = candidate
      return
    }
    if (best.outside < candidate.outside - 1e-12) {
      return
    }
    if (candidate.area < best.area) {
      best = candidate
    }
  }

  for (const role of ['note', 'legend'] as SheetTableRole[]) {
    const working = resolveSheetTable(annotation, role)
    if (!working || !pointInBox(working.bounds, world, 0)) {
      continue
    }
    consider({
      target: { kind: 'table', role },
      outside: 0,
      area: boxArea(working.bounds),
      prefer: 0
    })
  }

  const groupBoxes: Partial<Record<'scale' | 'neighbor', { minX: number; minY: number; maxX: number; maxY: number }>> = {
    scale: unionEntityBounds(annotation, (role) => sheetPartKindForRole(role) === 'scale') ?? undefined,
    neighbor: unionEntityBounds(annotation, (role) => sheetPartKindForRole(role) === 'neighbor') ?? undefined
  }

  for (const entityId of annotation.entityIds) {
    const role = annotation.sheetRoles?.[entityId]
    if (!role) {
      continue
    }
    const entity = getCadEntityById(entityId)
    if (!entity) {
      continue
    }
    const kind = sheetPartKindForRole(role)
    if (kind === 'label') {
      const glyph = hitCadTextAtWorld(entity, world, pad)
      if (!glyph) {
        continue
      }
      consider({
        target: { kind: 'label', role },
        outside: glyph.outside,
        area: glyph.area,
        prefer: 0
      })
      continue
    }
    if (kind === 'frame') {
      continue
    }
    const groupBox = groupBoxes[kind]
    const box = groupBox ?? boundsFromEntity(entity)
    if (!box) {
      continue
    }
    const hitPad = kind === 'scale' || kind === 'neighbor' ? pad : 0
    if (!pointInBox(box, world, hitPad)) {
      continue
    }
    consider({
      target: { kind },
      outside: 0,
      area: boxArea(box),
      prefer: 0
    })
  }

  if (best) {
    return best.target
  }

  const frame = annotation.gridFrame
  if (frame) {
    const outer = sheetOuterFrame(frame)
    if (pointInBox(frame, world, pad) || pointInBox(outer, world, pad)) {
      return { kind: 'frame' }
    }
  }

  return undefined
}

export const getSheetPartWorldBounds = (annotation: DrawAnnotation, target: SheetMoveTarget) => {
  if (target.kind === 'table') {
    return resolveSheetTable(annotation, target.role)?.bounds ?? null
  }
  if (target.kind === 'label') {
    const entityId = Object.entries(annotation.sheetRoles ?? {}).find(([, role]) => role === target.role)?.[0]
    const entity = entityId ? getCadEntityById(entityId) : undefined
    return entity ? boundsFromEntity(entity) : null
  }
  if (target.kind === 'scale' || target.kind === 'neighbor') {
    return unionEntityBounds(annotation, (role) => sheetPartKindForRole(role) === target.kind)
  }
  return annotation.gridFrame ?? annotation.bounds ?? null
}

const readPolyline = (annotation: DrawAnnotation) => {
  for (const entityId of annotation.entityIds) {
    const entity = getCadEntityById(entityId)
    if (entity instanceof AcDbPolyline && entity.numberOfVertices >= 2) {
      return {
        points: Array.from({ length: entity.numberOfVertices }, (_, index) => {
          const point = entity.getPoint2dAt(index)
          return new AcGePoint2d(point.x, point.y)
        }),
        closed: entity.closed
      }
    }
  }
  return null
}

const shiftPoints = (points: AcGePoint2d[], dx: number, dy: number) =>
  points.map((point) => new AcGePoint2d(point.x + dx, point.y + dy))

const clearTextSelection = (targets: DrawAnnotation[]) => {
  const textIds = targets
    .filter((item) => item.kind === 'text')
    .flatMap((item) => item.entityIds)
  if (textIds.length === 0) {
    return
  }
  try {
    getView().applySelection(textIds, 'remove')
  } catch {
    // Selection is optional while dragging.
  }
}

const commitMove = (targets: DrawAnnotation[], dx: number, dy: number, sheetTarget?: SheetMoveTarget) => {
  if (!dx && !dy) {
    return
  }

  clearTextSelection(targets)
  const context = AcApDocManager.instance.context

  recordDrawUndo(() => {
  for (const annotation of targets) {
    if (isFileAnnotation(annotation)) {
      translateFileAnnotation(annotation, dx, dy)
      continue
    }

    if (annotation.kind === 'grid' && annotation.grid && annotation.gridFrame) {
      const { minX, minY, maxX, maxY } = annotation.gridFrame
      eraseAnnotationEntities(annotation)
      createGridAnnotation(
        context,
        minX + dx,
        minY + dy,
        maxX + dx,
        maxY + dy,
        annotation.grid,
        annotation.layer
      )
      continue
    }

    if (annotation.kind === 'scale' && annotation.scale) {
      eraseAnnotationEntities(annotation)
      createScaleAnnotation(
        context,
        {
          ...annotation.scale,
          x: annotation.scale.x + dx,
          y: annotation.scale.y + dy
        },
        annotation.layer
      )
      continue
    }

    if (annotation.kind === 'sheet' && annotation.sheet && annotation.gridFrame) {
      const { minX, minY, maxX, maxY } = annotation.gridFrame
      const part = targets.length === 1 ? sheetTarget : undefined
      eraseAnnotationEntities(annotation)
      if (part && part.kind !== 'frame') {
        const tableBounds =
          part.kind === 'table' ? resolveSheetTable(annotation, part.role)?.bounds : undefined
        createSheetAnnotation(
          context,
          minX,
          minY,
          maxX,
          maxY,
          applySheetPartMove(annotation.sheet, part, dx, dy, tableBounds),
          annotation.layer,
          annotation.id
        )
        continue
      }
      createSheetAnnotation(
        context,
        minX + dx,
        minY + dy,
        maxX + dx,
        maxY + dy,
        {
          ...annotation.sheet,
          tableBounds: shiftSheetTableBounds(annotation.sheet.tableBounds, dx, dy)
        },
        annotation.layer,
        annotation.id
      )
      continue
    }

    if (annotation.kind === 'table' && annotation.table && annotation.bounds) {
      const { minX, minY, maxX, maxY } = annotation.bounds
      const options = annotation.table
      eraseAnnotationEntities(annotation)
      createTableAnnotation(context, minX + dx, minY + dy, maxX + dx, maxY + dy, options, annotation.layer, annotation.id)
      continue
    }

    if (annotation.kind === 'point' && annotation.point) {
      eraseAnnotationEntities(annotation)
      createPointAnnotation(
        context,
        {
          x: annotation.point.x + dx,
          y: annotation.point.y + dy,
          z: annotation.point.z
        },
        {
          fillMode: annotation.point.fillMode,
          fillColor: annotation.point.fillColor,
          strokeColor: annotation.point.strokeColor,
          size: annotation.point.size
        },
        annotation.layer,
        annotation.point.radius
      )
      continue
    }

    if (annotation.kind === 'circle' && annotation.circle) {
      eraseAnnotationEntities(annotation)
      createCircleAnnotation(
        context,
        {
          x: annotation.circle.x + dx,
          y: annotation.circle.y + dy,
          z: annotation.circle.z
        },
        annotation.circle.radius,
        {
          fillMode: annotation.circle.fillMode,
          fillColor: annotation.circle.fillColor,
          strokeColor: annotation.circle.strokeColor,
          strokeWidth: annotation.circle.strokeWidth
        },
        annotation.layer
      )
      continue
    }

    if (annotation.kind === 'text') {
      const text = collectEntities([annotation]).find(
        (entity): entity is AcDbMText => entity instanceof AcDbMText
      )
      if (!text) {
        continue
      }
      if (translateSceneObject(text, dx, dy) && translateCadEntity(text, dx, dy)) {
        if (annotation.bounds) {
          annotation.bounds = {
            minX: annotation.bounds.minX + dx,
            minY: annotation.bounds.minY + dy,
            maxX: annotation.bounds.maxX + dx,
            maxY: annotation.bounds.maxY + dy
          }
        }
        continue
      }
      const snapshot = {
        contents: annotation.text?.contents || stripMTextFormat(text.contents),
        font: annotation.text?.font,
        fontSize: annotation.text?.fontSize,
        rotation: annotation.text?.rotation ?? (text.rotation * 180) / Math.PI,
        color: annotation.text?.color,
        x: text.location.x + dx,
        y: text.location.y + dy,
        z: text.location.z ?? 0
      }
      eraseAnnotationEntities(annotation)
      createTextAnnotation(context, snapshot, annotation.layer)
      continue
    }

    const path = readPolyline(annotation)
    if (!path) {
      continue
    }
    const points = shiftPoints(path.points, dx, dy)
    eraseAnnotationEntities(annotation)
    if (annotation.kind === 'region') {
      createRegionAnnotation(context, points, {
        mode: annotation.regionMode ?? 'polygon',
        fillMode: annotation.regionFillMode ?? 'fill',
        fillColor: annotation.regionFillColor ?? store.regionFillColor,
        strokeColor: annotation.regionStrokeColor ?? store.regionStrokeColor,
        lineType: annotation.regionLineType ?? store.regionLineType,
        strokeWidth: annotation.regionStrokeWidth ?? store.regionStrokeWidth
      }, annotation.layer)
    } else {
      createLineAnnotation(context, points, annotation.closed ?? path.closed, {
        strokeColor: annotation.lineStrokeColor ?? store.lineStrokeColor,
        lineType: annotation.lineLineType ?? store.lineLineType,
        strokeWidth: annotation.lineStrokeWidth ?? store.lineStrokeWidth
      }, annotation.layer)
    }
  }
  })
}

export const getMoveGhostStyle = (): MoveGhostStyle | null => {
  if (!drag) {
    return null
  }
  return {
    left: `${drag.startBounds.left}px`,
    top: `${drag.startBounds.top}px`,
    width: `${drag.startBounds.width}px`,
    height: `${drag.startBounds.height}px`
  }
}

export const beginPointerMove = (event: PointerEvent) => {
  if (store.activeDrawTool !== 'move' || drag) {
    return false
  }

  const view = getView()
  const world = clientToWorld(view, event.clientX, event.clientY)
  const clicked =
    findAnnotationAtWorld(view, world) ??
    adoptCadEntityAtClient(view, event.clientX, event.clientY, true)
  if (!clicked) {
    ElMessage.warning('Hãy nhấn vào đối tượng trên bản vẽ, rồi kéo.')
    return false
  }

  const selected = collectAnnotationsFromEntityIds(view.selectionSet.ids)
  const inSelection = selected.some((item) => item.id === clicked.id)
  const targets = inSelection && selected.length > 0 ? selected : [clicked]
  const pad = worldSizeFromPixels(view, 8)
  const sheetTarget =
    targets.length === 1 && clicked.kind === 'sheet' ? findSheetMoveTarget(clicked, world, pad) : undefined
  if (clicked.kind === 'sheet' && targets.length === 1 && !sheetTarget) {
    ElMessage.warning('Hãy nhấn vào chữ, bảng, thước tỷ lệ hoặc đường khung để kéo.')
    return false
  }

  const partBox =
    sheetTarget && sheetTarget.kind !== 'frame' ? getSheetPartWorldBounds(clicked, sheetTarget) : null
  const bounds = partBox ? clientBoundsFromWorld(view, partBox) : getClientBounds(view, targets)
  if (!bounds) {
    ElMessage.warning('Không lấy được khung đối tượng để kéo.')
    return false
  }

  view.applySelection(
    targets
      .filter((item) => item.kind !== 'text')
      .flatMap((item) => item.entityIds),
    'replace'
  )

  drag = {
    pointerId: event.pointerId,
    startClient: { x: event.clientX, y: event.clientY },
    startWorld: { x: world.x, y: world.y },
    startBounds: bounds,
    targets,
    sheetTarget
  }
  return true
}

export const updatePointerMove = (event: PointerEvent): MoveGhostStyle | null => {
  if (!drag || event.pointerId !== drag.pointerId) {
    return getMoveGhostStyle()
  }

  const dx = event.clientX - drag.startClient.x
  const dy = event.clientY - drag.startClient.y
  return {
    left: `${drag.startBounds.left + dx}px`,
    top: `${drag.startBounds.top + dy}px`,
    width: `${drag.startBounds.width}px`,
    height: `${drag.startBounds.height}px`
  }
}

export const endPointerMove = (event?: PointerEvent, commit = true) => {
  if (!drag) {
    return
  }
  if (event && event.pointerId !== drag.pointerId) {
    return
  }

  const current = drag
  drag = null
  if (!commit) {
    return
  }

  const view = getView()
  const endWorld = event
    ? clientToWorld(view, event.clientX, event.clientY)
    : current.startWorld
  const dx = endWorld.x - current.startWorld.x
  const dy = endWorld.y - current.startWorld.y
  if (Math.hypot(dx, dy) < 1e-8) {
    return
  }

  commitMove(current.targets, dx, dy, current.sheetTarget)
}

export const cancelPointerMove = () => {
  drag = null
}

export const activateMoveMode = () => {
  store.activeDrawTool = 'move'
}

export const deactivateMoveMode = () => {
  cancelPointerMove()
  store.activeDrawTool = null
}

export const bindDrawMoving = () => {
  // Pointer overlay in DrawTools handles move.
}

export const unbindDrawMoving = () => {
  cancelPointerMove()
}
