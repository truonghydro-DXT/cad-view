import {
  AcApDocManager,
  AcEdCommand,
  AcEdOpenMode,
  AcEdPromptPointOptions,
  AcEdPromptStatus,
  type AcApContext
} from '@mlightcad/cad-simple-viewer'
import { AcDbMText, AcGiMTextAttachmentPoint } from '@mlightcad/data-model'
import { ElMessageBox } from 'element-plus'

import {
  collectEntityIds,
  createAnnotationId,
  registerAnnotation
} from './annotationRegistry'
import { recordDrawUndo } from './drawUndoStack'
import { appendEntity, colorFromHex } from './drawHelpers'
import { getActiveDrawLayer } from './drawLayers'
import {
  applyTableTextStyle,
  DEFAULT_TABLE_FONT,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_FONT_SIZE,
  formatMTextContents
} from './textStyles'

export { DEFAULT_TEXT_COLOR, DEFAULT_TEXT_FONT_SIZE }

export type TextDrawOptions = {
  contents: string
  font: string
  fontSize: number
  rotation: number
  color: string
}

const normalizeHexColor = (value?: string) => {
  const raw = (value ?? '').trim()
  const hex = raw.startsWith('#') ? raw : `#${raw}`
  return /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : DEFAULT_TEXT_COLOR
}

export const normalizeTextOptions = (
  options: Partial<TextDrawOptions> & { contents?: string }
): TextDrawOptions => ({
  contents: (options.contents ?? '').trim(),
  font: options.font || DEFAULT_TABLE_FONT,
  fontSize: Math.max(8, Math.min(72, Math.round(options.fontSize || DEFAULT_TEXT_FONT_SIZE))),
  rotation: Number.isFinite(options.rotation) ? Number(options.rotation) : 0,
  color: normalizeHexColor(options.color)
})

export const stripMTextFormat = (contents: string) => {
  let text = (contents ?? '').trim()
  for (let index = 0; index < 6; index += 1) {
    const wrapped = text.match(/^\{\\[^;]*;([\s\S]*)\}$/)
    if (!wrapped) {
      break
    }
    text = wrapped[1].trim()
  }
  return text.replace(/\\P/gi, '\n').replace(/\\[^;]*;/g, '').trim()
}

export const glyphSizeForText = (contents: string, height: number) => {
  const lines = (contents || ' ').split(/\r?\n/)
  const cols = Math.max(1, ...lines.map((line) => Math.max([...line].length, 1)))
  const safeHeight = Math.max(height, 1e-6)
  return {
    width: safeHeight * cols * 0.82,
    height: safeHeight * Math.max(lines.length, 1) * 1.2
  }
}

export const hitRotatedGlyph = (
  origin: { x: number; y: number },
  width: number,
  height: number,
  rotationDeg: number,
  attachmentPoint: number,
  world: { x: number; y: number },
  pad: number
) => {
  const attachment = Number.isFinite(attachmentPoint) && attachmentPoint >= 1 ? attachmentPoint : 7
  const col = (Math.round(attachment) - 1) % 3
  const row = Math.floor((Math.round(attachment) - 1) / 3)
  const ax = col <= 0 ? 0 : col === 1 ? 0.5 : 1
  const ay = row <= 0 ? 1 : row === 1 ? 0.5 : 0
  const minX = -ax * width
  const minY = -ay * height
  const maxX = minX + width
  const maxY = minY + height
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = world.x - origin.x
  const dy = world.y - origin.y
  const localX = dx * cos + dy * sin
  const localY = -dx * sin + dy * cos
  const outsideX = localX < minX ? minX - localX : localX > maxX ? localX - maxX : 0
  const outsideY = localY < minY ? minY - localY : localY > maxY ? localY - maxY : 0
  const outside = Math.hypot(outsideX, outsideY)
  if (outside > pad) {
    return null
  }
  return {
    dist: Math.hypot(localX - (minX + maxX) / 2, localY - (minY + maxY) / 2),
    area: Math.max(width, 1e-6) * Math.max(height, 1e-6),
    outside
  }
}

export const hitCadTextAtWorld = (
  entity: {
    location?: { x: number; y: number }
    position?: { x: number; y: number }
    height?: number
    rotation?: number
    attachmentPoint?: number
    contents?: string
    textString?: string
  },
  world: { x: number; y: number },
  pad: number
) => {
  const loc = entity.location ?? entity.position
  if (!loc) {
    return null
  }
  const contents = stripMTextFormat(entity.contents || entity.textString || ' ')
  const height = Math.max(Number(entity.height) || 0, 1e-6)
  const size = glyphSizeForText(contents, height)
  const rotation =
    typeof entity.rotation === 'number' && Number.isFinite(entity.rotation)
      ? (entity.rotation * 180) / Math.PI
      : 0
  return hitRotatedGlyph(loc, size.width, size.height, rotation, Number(entity.attachmentPoint) || 7, world, pad)
}

export const textWorldBounds = (
  x: number,
  y: number,
  width: number,
  height: number,
  rotationDeg: number
) => {
  const rotation = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)
  const corners = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height]
  ].map(([dx, dy]) => ({
    x: x + dx * cos - dy * sin,
    y: y + dx * sin + dy * cos
  }))
  return {
    minX: Math.min(...corners.map((point) => point.x)),
    minY: Math.min(...corners.map((point) => point.y)),
    maxX: Math.max(...corners.map((point) => point.x)),
    maxY: Math.max(...corners.map((point) => point.y))
  }
}

let pendingTextOptions: TextDrawOptions = normalizeTextOptions({})

export const setPendingTextOptions = (options: Partial<TextDrawOptions>) => {
  pendingTextOptions = normalizeTextOptions(options)
}

export class AcApDrawTextCmd extends AcEdCommand {
  constructor() {
    super()
    this.mode = AcEdOpenMode.Write
    this.globalName = 'DRAWTEXT'
    this.localName = 'Ve text'
  }

  async execute(context: AcApContext) {
    const editor = AcApDocManager.instance.editor
    const pointPrompt = new AcEdPromptPointOptions('Click vị trí đặt chữ')
    const pointResult = await editor.getPoint(pointPrompt)
    if (pointResult.status !== AcEdPromptStatus.OK || !pointResult.value) {
      return
    }
    const x = pointResult.value.x
    const y = pointResult.value.y
    const z = pointResult.value.z ?? 0

    let contents = pendingTextOptions.contents
    if (!contents) {
      try {
        const prompt = await ElMessageBox.prompt('Nhập nội dung chữ', 'Vẽ chữ', {
          confirmButtonText: 'Chèn',
          cancelButtonText: 'Hủy',
          inputPlaceholder: 'Nội dung...',
          inputPattern: /\S+/,
          inputErrorMessage: 'Nội dung không được để trống'
        })
        contents = String(prompt.value ?? '').trim()
      } catch {
        return
      }
    }

    if (!contents) {
      return
    }

    recordDrawUndo(() => {
      createTextAnnotation(context, {
        ...pendingTextOptions,
        contents,
        x,
        y,
        z
      })
    })
  }
}

export const applyDrawnTextEntity = (
  context: AcApContext,
  mtext: AcDbMText,
  options: TextDrawOptions
) => {
  const style = normalizeTextOptions(options)
  const rotation = (style.rotation * Math.PI) / 180
  applyTableTextStyle(context, mtext, style.font, style.fontSize)
  mtext.contents = formatMTextContents(style.contents, style.font)
  mtext.width = Math.max(mtext.height * style.contents.length * 0.7, mtext.height * 4)
  mtext.rotation = rotation
  mtext.direction = { x: Math.cos(rotation), y: Math.sin(rotation), z: 0 }
  mtext.attachmentPoint = AcGiMTextAttachmentPoint.BottomLeft
  mtext.color = colorFromHex(style.color)
  return style
}

export const createTextAnnotation = (
  context: AcApContext,
  options: Partial<TextDrawOptions> & { x: number; y: number; z?: number },
  layer = getActiveDrawLayer()
) => {
  const mtext = new AcDbMText()
  const style = applyDrawnTextEntity(context, mtext, normalizeTextOptions(options))
  mtext.location = {
    x: options.x,
    y: options.y,
    z: options.z ?? 0
  }
  appendEntity(context, mtext, layer)
  const size = glyphSizeForText(style.contents, mtext.height)
  registerAnnotation({
    id: createAnnotationId(),
    kind: 'text',
    entityIds: collectEntityIds([mtext]),
    bounds: textWorldBounds(
      mtext.location.x,
      mtext.location.y,
      size.width,
      size.height,
      style.rotation
    ),
    text: style,
    layer
  })
}
