export type DxfPair = {
  code: number
  value: string
}

export type DxfDocument = {
  pairs: DxfPair[]
  newline: string
}

const CONTINUATION_TYPES = new Set(['VERTEX', 'ATTRIB', 'SEQEND'])

export const normalizeHandle = (value?: string | null) => {
  const handle = String(value || '').trim().toUpperCase()
  return /^[0-9A-F]+$/.test(handle) ? handle : ''
}

export const isAsciiDxfText = (text: string) => {
  const head = text.slice(0, 80).replace(/^\uFEFF/, '')
  if (/^AutoCAD Binary DXF/i.test(head)) {
    return false
  }
  return /^\s*0\s+SECTION\b/i.test(head)
}

export const parseAsciiDxf = (text: string): DxfDocument => {
  const newline = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const pairs: DxfPair[] = []

  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number.parseInt(lines[index].trim(), 10)
    if (!Number.isFinite(code)) {
      index -= 1
      continue
    }
    pairs.push({ code, value: lines[index + 1] ?? '' })
  }

  return { pairs, newline }
}

export const stringifyDxf = (document: DxfDocument) => {
  const lines: string[] = []
  for (const pair of document.pairs) {
    lines.push(String(pair.code))
    lines.push(pair.value)
  }
  return `${lines.join(document.newline)}${document.newline}`
}

export const findSection = (pairs: DxfPair[], name: string) => {
  const wanted = name.toUpperCase()
  for (let index = 0; index < pairs.length - 1; index += 1) {
    const pair = pairs[index]
    const next = pairs[index + 1]
    if (pair.code !== 0 || pair.value.trim().toUpperCase() !== 'SECTION') {
      continue
    }
    if (next.code !== 2 || next.value.trim().toUpperCase() !== wanted) {
      continue
    }
    for (let end = index + 2; end < pairs.length; end += 1) {
      if (pairs[end].code === 0 && pairs[end].value.trim().toUpperCase() === 'ENDSEC') {
        return { start: index, end }
      }
    }
  }
  return null
}

export const findTable = (pairs: DxfPair[], tableName: string) => {
  const tables = findSection(pairs, 'TABLES')
  if (!tables) {
    return null
  }

  const wanted = tableName.toUpperCase()
  for (let index = tables.start; index < tables.end; index += 1) {
    const pair = pairs[index]
    const next = pairs[index + 1]
    if (pair.code !== 0 || pair.value.trim().toUpperCase() !== 'TABLE') {
      continue
    }
    if (!next || next.code !== 2 || next.value.trim().toUpperCase() !== wanted) {
      continue
    }
    for (let end = index + 2; end <= tables.end; end += 1) {
      if (pairs[end].code === 0 && pairs[end].value.trim().toUpperCase() === 'ENDTAB') {
        return { start: index, end }
      }
    }
  }
  return null
}

export const collectTableNames = (pairs: DxfPair[], tableName: string) => {
  const table = findTable(pairs, tableName)
  const names = new Set<string>()
  if (!table) {
    return names
  }

  const recordType = tableName.toUpperCase()
  for (let index = table.start + 2; index < table.end; index += 1) {
    const pair = pairs[index]
    if (pair.code !== 0 || pair.value.trim().toUpperCase() !== recordType) {
      continue
    }
    for (let cursor = index + 1; cursor < table.end; cursor += 1) {
      if (pairs[cursor].code === 0) {
        break
      }
      if (pairs[cursor].code === 2) {
        const name = pairs[cursor].value.trim()
        if (name) {
          names.add(name.toUpperCase())
        }
        break
      }
    }
  }

  return names
}

const entityHandle = (pairs: DxfPair[], start: number, end: number) => {
  for (let index = start + 1; index < end; index += 1) {
    if (pairs[index].code === 0) {
      break
    }
    if (pairs[index].code === 5) {
      return normalizeHandle(pairs[index].value)
    }
  }
  return ''
}

export const listEntities = (pairs: DxfPair[], sectionName: 'ENTITIES' | 'BLOCKS') => {
  const section = findSection(pairs, sectionName)
  const records: Array<{ start: number; end: number; type: string; handle: string }> = []
  if (!section) {
    return records
  }

  let index = section.start + 2
  while (index < section.end) {
    const pair = pairs[index]
    if (pair.code !== 0) {
      index += 1
      continue
    }

    const type = pair.value.trim().toUpperCase()
    if (
      !type ||
      type === 'ENDSEC' ||
      type === 'SECTION' ||
      type === 'BLOCK' ||
      type === 'ENDBLK'
    ) {
      index += 1
      continue
    }

    let end = index + 1
    while (end < section.end) {
      const next = pairs[end]
      if (next.code === 0) {
        const nextType = next.value.trim().toUpperCase()
        if (!CONTINUATION_TYPES.has(nextType)) {
          break
        }
      }
      end += 1
    }

    records.push({
      start: index,
      end,
      type,
      handle: entityHandle(pairs, index, end)
    })
    index = end
  }

  return records
}

export const maxHandleValue = (pairs: DxfPair[]) => {
  let max = 0
  for (const pair of pairs) {
    if (pair.code !== 5 && pair.code !== 105) {
      continue
    }
    const handle = normalizeHandle(pair.value)
    if (!handle) {
      continue
    }
    const value = Number.parseInt(handle, 16)
    if (Number.isFinite(value) && value > max) {
      max = value
    }
  }
  return max
}

export const setHeaderVariable = (
  pairs: DxfPair[],
  name: string,
  nextCode: number,
  nextValue: string
) => {
  const header = findSection(pairs, 'HEADER')
  if (!header) {
    return false
  }

  const wanted = name.toUpperCase()
  for (let index = header.start; index < header.end - 1; index += 1) {
    if (pairs[index].code !== 9 || pairs[index].value.trim().toUpperCase() !== wanted) {
      continue
    }
    pairs[index + 1] = { code: nextCode, value: nextValue }
    return true
  }

  pairs.splice(header.end, 0, { code: 9, value: name }, { code: nextCode, value: nextValue })
  return true
}

export const incrementTableCount = (pairs: DxfPair[], tableName: string, delta: number) => {
  if (delta === 0) {
    return
  }

  const table = findTable(pairs, tableName)
  if (!table) {
    return
  }

  for (let index = table.start; index < table.end; index += 1) {
    if (pairs[index].code !== 70) {
      continue
    }
    const current = Number.parseInt(pairs[index].value.trim(), 10)
    if (!Number.isFinite(current)) {
      return
    }
    pairs[index] = { code: 70, value: String(current + delta) }
    return
  }
}

export const parseRecordPairs = (text: string) => parseAsciiDxf(text).pairs
