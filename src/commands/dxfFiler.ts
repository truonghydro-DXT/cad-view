import type { AcCmColor, AcCmTransparency, AcDbDatabase } from '@mlightcad/data-model'

type PointLike = { x?: number; y?: number; z?: number }

export class SimpleDxfFiler {
  database?: AcDbDatabase
  precision: number
  nextHandle: number
  version = { name: 'AC1032', value: 33 }
  private readonly lines: string[] = []
  private readonly handleMap = new Map<string, string>()

  constructor(options: { database?: AcDbDatabase; precision?: number; nextHandle?: number }) {
    this.database = options.database
    this.precision = Math.max(0, Math.min(16, options.precision ?? 16))
    this.nextHandle = Math.max(1, options.nextHandle ?? 1)
  }

  toString() {
    return this.lines.length ? `${this.lines.join('\n')}\n` : ''
  }

  registerHandle(key?: string) {
    if (!key) {
      return undefined
    }
    const existing = this.handleMap.get(key)
    if (existing) {
      return existing
    }
    const handle = /^[0-9A-F]+$/i.test(key)
      ? key.toUpperCase()
      : (this.nextHandle++).toString(16).toUpperCase()
    this.handleMap.set(key, handle)
    return handle
  }

  writeGroup(code: number, value: unknown) {
    if (value == null) {
      return this
    }
    this.lines.push(String(Math.trunc(code)))
    this.lines.push(this.formatValue(value) || '0')
    return this
  }

  writeStart(value: string) {
    return this.writeString(0, value)
  }

  writeSubclassMarker(value: string) {
    return this.writeString(100, value)
  }

  writeString(code: number, value?: string) {
    if (value == null) {
      return this
    }
    return this.writeGroup(code, value)
  }

  writeInt8(code: number, value?: number) {
    return value == null ? this : this.writeGroup(code, Math.trunc(value))
  }

  writeInt16(code: number, value?: number) {
    return value == null ? this : this.writeGroup(code, Math.trunc(value))
  }

  writeInt32(code: number, value?: number) {
    return value == null ? this : this.writeGroup(code, Math.trunc(value))
  }

  writeInt64(code: number, value?: number) {
    return value == null ? this : this.writeGroup(code, Math.trunc(value))
  }

  writeUInt16(code: number, value?: number) {
    return value == null ? this : this.writeGroup(code, Math.max(0, value))
  }

  writeUInt32(code: number, value?: number) {
    return value == null ? this : this.writeGroup(code, Math.max(0, value))
  }

  writeBoolean(code: number, value?: boolean) {
    return value == null ? this : this.writeGroup(code, value ? 1 : 0)
  }

  writeBool(code: number, value?: boolean) {
    return this.writeBoolean(code, value)
  }

  writeDouble(code: number, value?: number) {
    return value == null || !Number.isFinite(value) ? this : this.writeGroup(code, value)
  }

  writeAngle(code: number, radians?: number) {
    if (radians == null || !Number.isFinite(radians)) {
      return this
    }
    return this.writeDouble(code, (radians * 180) / Math.PI)
  }

  writeHandle(code: number, key?: string) {
    const handle = this.registerHandle(key)
    return handle ? this.writeString(code, handle) : this
  }

  writeObjectId(code: number, objectId?: string) {
    return this.writeHandle(code, objectId)
  }

  writePoint2d(code: number, point?: PointLike) {
    if (!point) {
      return this
    }
    this.writeDouble(code, point.x)
    this.writeDouble(code + 10, point.y)
    return this
  }

  writePoint3d(code: number, point?: PointLike) {
    if (!point) {
      return this
    }
    this.writeDouble(code, point.x)
    this.writeDouble(code + 10, point.y)
    this.writeDouble(code + 20, point.z ?? 0)
    return this
  }

  writeVector3d(code: number, vector?: PointLike) {
    return this.writePoint3d(code, vector)
  }

  writeCmColor(color?: AcCmColor, aciCode = 62, trueColorCode = 420) {
    if (!color) {
      return this
    }
    if (color.colorIndex != null) {
      this.writeInt16(aciCode, color.colorIndex)
    }
    if (color.RGB != null && color.colorIndex == null) {
      this.writeInt32(trueColorCode, color.RGB)
    }
    return this
  }

  writeTransparency(transparency?: AcCmTransparency, code = 440) {
    if (!transparency) {
      return this
    }
    return this.writeInt32(code, transparency.serialize())
  }

  writeResultBuffer(data?: Array<{ code: number; value: unknown }> | null) {
    if (!data) {
      return this
    }
    for (const item of data) {
      this.writeGroup(item.code, item.value)
    }
    return this
  }

  private formatValue(value: unknown) {
    if (typeof value === 'string') {
      return value.replace(/[\r\n]+/g, '\\P')
    }
    if (typeof value === 'boolean') {
      return value ? '1' : '0'
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) {
        return '0'
      }
      if (Number.isInteger(value)) {
        return String(value)
      }
      return value.toFixed(this.precision).replace(/\.?0+$/, '')
    }
    return String(value)
  }
}
