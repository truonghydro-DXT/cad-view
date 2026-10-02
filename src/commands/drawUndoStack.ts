import { AcDbMText, AcDbText } from '@mlightcad/data-model'

import {
  listAnnotations,
  onAnnotationsCleared,
  type DrawAnnotation
} from './annotationRegistry'
import { getCadEntityById, readCadEntityPath } from './existingEntities'

type PathPoint = { x: number; y: number }

export type DrawUndoSnapshot = DrawAnnotation & {
  pathPoints?: PathPoint[]
  textLocation?: { x: number; y: number; z?: number }
}

const MAX_UNDO = 50
const undoStack: DrawUndoSnapshot[][] = []

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const readTextLocation = (annotation: DrawAnnotation) => {
  for (const entityId of annotation.entityIds) {
    const entity = getCadEntityById(entityId)
    if (entity instanceof AcDbMText) {
      return {
        x: entity.location.x,
        y: entity.location.y,
        z: entity.location.z
      }
    }
    if (entity instanceof AcDbText) {
      return {
        x: entity.position.x,
        y: entity.position.y,
        z: entity.position.z
      }
    }
  }
  return undefined
}

const readPathSnapshot = (annotation: DrawAnnotation) => {
  for (const entityId of annotation.entityIds) {
    const entity = getCadEntityById(entityId)
    if (!entity) {
      continue
    }
    const path = readCadEntityPath(entity)
    if (path && path.points.length >= 2) {
      return {
        pathPoints: path.points.map((point) => ({ x: point.x, y: point.y })),
        closed: path.closed
      }
    }
  }
  return null
}

export const captureUndoAnnotation = (annotation: DrawAnnotation): DrawUndoSnapshot => {
  const snap = cloneJson(annotation) as DrawUndoSnapshot
  const path = readPathSnapshot(annotation)
  if (path) {
    snap.pathPoints = path.pathPoints
    snap.closed = annotation.closed ?? path.closed
  }
  const location = readTextLocation(annotation)
  if (location) {
    snap.textLocation = location
  }
  return snap
}

const captureAll = () => listAnnotations().map(captureUndoAnnotation)

const snapshotsEqual = (left: DrawUndoSnapshot[], right: DrawUndoSnapshot[]) =>
  JSON.stringify(left) === JSON.stringify(right)

const pushUndo = (before: DrawUndoSnapshot[]) => {
  undoStack.push(before)
  if (undoStack.length > MAX_UNDO) {
    undoStack.shift()
  }
}

export const clearDrawUndo = () => {
  undoStack.length = 0
}

onAnnotationsCleared(clearDrawUndo)

export const recordDrawUndo = <T>(mutate: () => T): T => {
  const before = captureAll()
  const result = mutate()
  if (!snapshotsEqual(before, captureAll())) {
    pushUndo(before)
  }
  return result
}

export const recordDrawUndoAsync = async <T>(mutate: () => Promise<T>): Promise<T> => {
  const before = captureAll()
  const result = await mutate()
  if (!snapshotsEqual(before, captureAll())) {
    pushUndo(before)
  }
  return result
}

export const canUndoDraw = () => undoStack.length > 0

export const takeDrawUndo = () => undoStack.pop()
