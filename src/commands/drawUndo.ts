import { AcApDocManager } from '@mlightcad/cad-simple-viewer'
import { AcGePoint2d } from '@mlightcad/data-model'

import {
  eraseAnnotationEntities,
  getAnnotation,
  isFileAnnotation,
  listAnnotations
} from './annotationRegistry'
import { createCircleAnnotation } from './circleCmd'
import {
  boundsFromCadEntity,
  getCadEntityById,
  getFilePathEntity,
  refreshFileTextContent,
  translateFileAnnotation,
  updateFileTextEntity,
  writeFileAnnotationPath
} from './existingEntities'
import { createGridAnnotation } from './gridCmd'
import { createLineAnnotation } from './lineCmd'
import { createPointAnnotation } from './pointCmd'
import { createRegionAnnotation } from './regionCmd'
import { createScaleAnnotation } from './scaleCmd'
import { createSheetAnnotation } from './sheetCmd'
import { createTableAnnotation } from './tableCmd'
import { createTextAnnotation } from './textCmd'
import { DEFAULT_TABLE_FONT } from './textStyles'
import {
  captureUndoAnnotation,
  takeDrawUndo,
  type DrawUndoSnapshot
} from './drawUndoStack'

export {
  canUndoDraw,
  clearDrawUndo,
  recordDrawUndo,
  recordDrawUndoAsync
} from './drawUndoStack'

const cloneJson = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

const restoreFileAnnotation = (snap: DrawUndoSnapshot) => {
  const current = getAnnotation(snap.id)
  if (!current || !isFileAnnotation(current)) {
    return
  }
  if (JSON.stringify(captureUndoAnnotation(current)) === JSON.stringify(snap)) {
    return
  }

  if (snap.pathPoints && snap.pathPoints.length >= 2) {
    const points = snap.pathPoints.map((point) => new AcGePoint2d(point.x, point.y))
    if (writeFileAnnotationPath(current, points, snap.closed ?? current.closed === true)) {
      const updated = getFilePathEntity(current)
      current.closed = snap.closed
      current.bounds = updated ? boundsFromCadEntity(updated) ?? snap.bounds : snap.bounds
      return
    }
  }

  if (snap.text) {
    const entity = current.entityIds[0] ? getCadEntityById(current.entityIds[0]) : undefined
    if (entity) {
      updateFileTextEntity(entity, snap.text)
      current.text = cloneJson(snap.text)
      if (snap.textLocation) {
        const now = captureUndoAnnotation(current).textLocation
        if (now) {
          const dx = snap.textLocation.x - now.x
          const dy = snap.textLocation.y - now.y
          if (dx || dy) {
            translateFileAnnotation(current, dx, dy)
          }
        }
      }
      const latest = current.entityIds[0] ? getCadEntityById(current.entityIds[0]) : entity
      if (latest) {
        refreshFileTextContent(latest)
        current.bounds = boundsFromCadEntity(latest) ?? current.bounds
      }
    }
    return
  }

  if (snap.bounds && current.bounds) {
    const dx = snap.bounds.minX - current.bounds.minX
    const dy = snap.bounds.minY - current.bounds.minY
    if (dx || dy) {
      translateFileAnnotation(current, dx, dy)
    }
  }
}

const recreateDrawAnnotation = (snap: DrawUndoSnapshot) => {
  const context = AcApDocManager.instance.context
  const layer = snap.layer

  if (snap.kind === 'point' && snap.point) {
    createPointAnnotation(
      context,
      { x: snap.point.x, y: snap.point.y, z: snap.point.z },
      {
        fillMode: snap.point.fillMode,
        fillColor: snap.point.fillColor,
        strokeColor: snap.point.strokeColor,
        size: snap.point.size
      },
      layer,
      snap.point.radius
    )
    return
  }

  if (snap.kind === 'circle' && snap.circle) {
    createCircleAnnotation(
      context,
      { x: snap.circle.x, y: snap.circle.y, z: snap.circle.z },
      snap.circle.radius,
      {
        fillMode: snap.circle.fillMode,
        fillColor: snap.circle.fillColor,
        strokeColor: snap.circle.strokeColor,
        strokeWidth: snap.circle.strokeWidth
      },
      layer
    )
    return
  }

  if (snap.kind === 'text') {
    const text = snap.text
    if (!text?.contents) {
      return
    }
    createTextAnnotation(
      context,
      {
        contents: text.contents,
        font: text.font || DEFAULT_TABLE_FONT,
        fontSize: text.fontSize || 20,
        rotation: text.rotation ?? 0,
        color: text.color || '#382418',
        x: snap.textLocation?.x ?? snap.bounds?.minX ?? 0,
        y: snap.textLocation?.y ?? snap.bounds?.minY ?? 0,
        z: snap.textLocation?.z ?? 0
      },
      layer
    )
    return
  }

  if (snap.kind === 'line') {
    if (!snap.pathPoints || snap.pathPoints.length < 2) {
      return
    }
    createLineAnnotation(
      context,
      snap.pathPoints.map((point) => new AcGePoint2d(point.x, point.y)),
      snap.closed ?? false,
      {
        strokeColor: snap.lineStrokeColor || '#382418',
        lineType: snap.lineLineType || 'Continuous',
        strokeWidth: snap.lineStrokeWidth ?? 0
      },
      layer
    )
    return
  }

  if (snap.kind === 'region') {
    if (!snap.pathPoints || snap.pathPoints.length < 3) {
      return
    }
    createRegionAnnotation(
      context,
      snap.pathPoints.map((point) => new AcGePoint2d(point.x, point.y)),
      {
        mode: snap.regionMode ?? 'polygon',
        fillMode: snap.regionFillMode ?? 'fill',
        fillColor: snap.regionFillColor || '#382418',
        strokeColor: snap.regionStrokeColor || '#382418',
        lineType: snap.regionLineType || 'Continuous',
        strokeWidth: snap.regionStrokeWidth ?? 0
      },
      layer
    )
    return
  }

  if (snap.kind === 'table' && snap.table && snap.bounds) {
    createTableAnnotation(
      context,
      snap.bounds.minX,
      snap.bounds.minY,
      snap.bounds.maxX,
      snap.bounds.maxY,
      snap.table,
      layer,
      snap.id
    )
    return
  }

  if (snap.kind === 'grid' && snap.grid && snap.gridFrame) {
    createGridAnnotation(
      context,
      snap.gridFrame.minX,
      snap.gridFrame.minY,
      snap.gridFrame.maxX,
      snap.gridFrame.maxY,
      snap.grid,
      layer
    )
    return
  }

  if (snap.kind === 'scale' && snap.scale) {
    createScaleAnnotation(context, snap.scale, layer)
    return
  }

  if (snap.kind === 'sheet' && snap.sheet && snap.gridFrame) {
    createSheetAnnotation(
      context,
      snap.gridFrame.minX,
      snap.gridFrame.minY,
      snap.gridFrame.maxX,
      snap.gridFrame.maxY,
      snap.sheet,
      layer,
      snap.id
    )
  }
}

const restoreSnapshots = (before: DrawUndoSnapshot[]) => {
  for (const snap of before) {
    if (snap.source === 'file') {
      restoreFileAnnotation(snap)
    }
  }

  for (const annotation of listAnnotations()) {
    if (!isFileAnnotation(annotation)) {
      eraseAnnotationEntities(annotation)
    }
  }

  for (const snap of before) {
    if (snap.source !== 'file') {
      recreateDrawAnnotation(snap)
    }
  }
}

export const undoDraw = () => {
  const before = takeDrawUndo()
  if (!before) {
    return false
  }
  restoreSnapshots(before)
  return true
}
