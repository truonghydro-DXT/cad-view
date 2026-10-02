const removedHandles = new Set<string>()
const changedHandles = new Set<string>()

const normalizeHandle = (handle?: string | null) => {
  const value = String(handle || '').trim().toUpperCase()
  return /^[0-9A-F]+$/.test(value) ? value : ''
}

export const clearOriginalDxfEdits = () => {
  removedHandles.clear()
  changedHandles.clear()
}

export const markOriginalEntityRemoved = (handle?: string | null) => {
  const value = normalizeHandle(handle)
  if (!value) {
    return
  }
  removedHandles.add(value)
  changedHandles.delete(value)
}

export const markOriginalEntityChanged = (handle?: string | null) => {
  const value = normalizeHandle(handle)
  if (!value || removedHandles.has(value)) {
    return
  }
  changedHandles.add(value)
}

export const getRemovedOriginalHandles = () => new Set(removedHandles)

export const getChangedOriginalHandles = () => new Set(changedHandles)
