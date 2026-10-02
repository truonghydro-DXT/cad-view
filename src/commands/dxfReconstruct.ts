import type { AcDbDatabase, AcDbEntity } from '@mlightcad/data-model'

const CLASSES_SECTION = `0
SECTION
2
CLASSES
0
CLASS
1
ACDBDICTIONARYWDFLT
2
AcDbDictionaryWithDefault
3
ObjectDBX Classes
90
0
91
1
280
0
281
0
0
CLASS
1
HATCH
2
AcDbHatch
3
ObjectDBX Classes
90
0
91
1
280
0
281
1
0
CLASS
1
LWPOLYLINE
2
AcDbPolyline
3
ObjectDBX Classes
90
0
91
1
280
0
281
1
0
CLASS
1
MTEXT
2
AcDbMText
3
ObjectDBX Classes
90
0
91
1
280
0
281
1
0
CLASS
1
IMAGE
2
AcDbRasterImage
3
ObjectDBX Classes
90
0
91
1
280
0
281
1
0
CLASS
1
IMAGEDEF
2
AcDbRasterImageDef
3
ObjectDBX Classes
90
0
91
1
280
0
281
0
0
CLASS
1
IMAGEDEF_REACTOR
2
AcDbRasterImageDefReactor
3
ObjectDBX Classes
90
0
91
1
280
0
281
0
0
CLASS
1
WIPEOUT
2
AcDbWipeout
3
ObjectDBX Classes
90
0
91
1
280
0
281
1
0
CLASS
1
ACAD_TABLE
2
AcDbTable
3
ObjectDBX Classes
90
0
91
1
280
0
281
1
0
CLASS
1
SPLINE
2
AcDbSpline
3
ObjectDBX Classes
90
0
91
1
280
0
281
1
0
CLASS
1
LAYOUT
2
AcDbLayout
3
ObjectDBX Classes
90
0
91
1
280
0
281
0
0
ENDSEC
`

const hasClassesSection = (dxf: string) => /\n2\r?\nCLASSES\r?\n/.test(dxf)

const injectClassesSection = (dxf: string) => {
  if (hasClassesSection(dxf)) {
    return dxf
  }

  const match = dxf.match(/\r?\n0\r?\nENDSEC\r?\n/)
  if (!match || match.index == null) {
    return dxf
  }

  const insertAt = match.index + match[0].length
  return `${dxf.slice(0, insertAt)}${CLASSES_SECTION}${dxf.slice(insertAt)}`
}

const setOrInsertHeader = (dxf: string, name: string, code: number, value: string) => {
  const pattern = new RegExp(`(\\n9\\r?\\n\\${name}\\r?\\n)${code}\\r?\\n[^\\n]+`, 'i')
  if (pattern.test(dxf)) {
    return dxf.replace(pattern, `$1${code}\n${value}`)
  }

  const handseed = dxf.match(/\n9\r?\n\$HANDSEED\r?\n5\r?\n[^\n]+/)
  if (handseed && handseed.index != null) {
    const insertAt = handseed.index + handseed[0].length
    return `${dxf.slice(0, insertAt)}\n9\n${name}\n${code}\n${value}${dxf.slice(insertAt)}`
  }

  return dxf
}

const fixHandseed = (dxf: string) => {
  let max = 0
  const matches = dxf.matchAll(/\n(?:5|105)\r?\n([0-9A-Fa-f]+)/g)
  for (const match of matches) {
    const value = Number.parseInt(match[1], 16)
    if (Number.isFinite(value) && value > max) {
      max = value
    }
  }
  if (max < 1) {
    return dxf
  }
  return setOrInsertHeader(dxf, '$HANDSEED', 5, (max + 1).toString(16).toUpperCase())
}

export const reconstructDrawingDxf = (database: AcDbDatabase, precision = 16) => {
  const proto = Object.getPrototypeOf(database) as {
    writeDxfEntity?: (filer: unknown, entity: AcDbEntity) => void
  }
  const originalWrite = proto.writeDxfEntity
  let skipped = 0

  if (typeof originalWrite === 'function') {
    proto.writeDxfEntity = function writeDxfEntitySafe(filer: unknown, entity: AcDbEntity) {
      const type = String((entity as AcDbEntity & { dxfTypeName?: string }).dxfTypeName || '').trim()
      if (!type) {
        skipped += 1
        return
      }
      try {
        originalWrite.call(this, filer, entity)
      } catch (error) {
        skipped += 1
        console.warn('[export-dxf] Bỏ qua đối tượng không ghi được', type, entity.objectId, error)
      }
    }
  }

  let dxf = ''
  try {
    dxf = database.dxfOut(undefined, precision, 'AC1032')
  } finally {
    if (originalWrite) {
      proto.writeDxfEntity = originalWrite
    }
  }

  dxf = injectClassesSection(dxf)
  dxf = setOrInsertHeader(dxf, '$DWGCODEPAGE', 3, 'UTF-8')
  dxf = setOrInsertHeader(dxf, '$ACADVER', 1, 'AC1032')
  dxf = fixHandseed(dxf)

  return { dxf, skipped }
}
