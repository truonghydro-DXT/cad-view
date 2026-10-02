const parseEnvNumber = (value: string | undefined, fallbackValue: number) => {
  if (!value) {
    return fallbackValue
  }

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallbackValue
}

const BYTES_PER_MIB = 1024 * 1024

export const LARGE_FILE_THRESHOLD_MB = parseEnvNumber(
  import.meta.env.VITE_LARGE_FILE_MODE_THRESHOLD_MB,
  150
)

export const LARGE_FILE_THRESHOLD_BYTES = LARGE_FILE_THRESHOLD_MB * BYTES_PER_MIB

/** Default conversion chunk size for normal files (library default is 1000). */
export const NORMAL_MINIMUM_CHUNK_SIZE = 1000

/**
 * Larger chunks = fewer main-thread yields during ENTITY convert = faster wall-clock load.
 * Trade-off: slightly longer freezes between progress updates.
 */
export const LARGE_FILE_MINIMUM_CHUNK_SIZE = parseEnvNumber(
  import.meta.env.VITE_LARGE_FILE_MINIMUM_CHUNK_SIZE,
  12000
)

/** Entities converted to Three.js meshes per yield during batchConvert. */
export const LARGE_FILE_RENDER_CHUNK_SIZE = parseEnvNumber(
  import.meta.env.VITE_LARGE_FILE_RENDER_CHUNK_SIZE,
  800
)

const PARSER_TIMEOUT_BASE_MS = parseEnvNumber(
  import.meta.env.VITE_PARSER_TIMEOUT_BASE_MS,
  60_000
)

const PARSER_TIMEOUT_PER_MIB_MS = parseEnvNumber(
  import.meta.env.VITE_PARSER_TIMEOUT_PER_MIB_MS,
  2_000
)

const PARSER_TIMEOUT_MAX_MS = parseEnvNumber(
  import.meta.env.VITE_PARSER_TIMEOUT_MAX_MS,
  600_000
)

export const isLargeFile = (file: File | undefined | null): boolean => {
  return !!file && file.size >= LARGE_FILE_THRESHOLD_BYTES
}

export const isDxfFile = (file: File | undefined | null): boolean => {
  return !!file && file.name.toLowerCase().endsWith('.dxf')
}

export const isDwgFile = (file: File | undefined | null): boolean => {
  return !!file && file.name.toLowerCase().endsWith('.dwg')
}

export const getFileSizeMiB = (file: File | undefined | null): number => {
  if (!file) {
    return 0
  }

  return Math.ceil(file.size / BYTES_PER_MIB)
}

/**
 * Parser worker timeout scales with file size.
 * Library default caps at 120s which is too low for 150MB+ DWG files.
 */
export const getParserTimeoutMs = (file: File | undefined | null): number | undefined => {
  if (!file) {
    return undefined
  }

  const sizeMiB = getFileSizeMiB(file)
  if (sizeMiB < 20) {
    return undefined
  }

  return Math.min(
    PARSER_TIMEOUT_MAX_MS,
    Math.max(PARSER_TIMEOUT_BASE_MS, PARSER_TIMEOUT_BASE_MS + sizeMiB * PARSER_TIMEOUT_PER_MIB_MS)
  )
}

export type LargeFileSettings = {
  isLargeFile: boolean
  useMainThreadDraw: boolean
  enableOsmOverlay: boolean
  minimumChunkSize: number
  renderChunkSize: number
  parserTimeoutMs?: number
  preloadAllFonts: boolean
  deferPostLoadWork: boolean
}

export const getLargeFileSettings = (
  file: File | undefined | null,
  forceMainThreadDraw = false
): LargeFileSettings => {
  const large = isLargeFile(file)
  const osmEnabledByEnv = import.meta.env.VITE_ENABLE_OSM_OVERLAY !== 'false'

  return {
    isLargeFile: large,
    // Keep MText on the worker for large files — main-thread draw is only for WebGL recovery.
    useMainThreadDraw: forceMainThreadDraw,
    // OSM is allowed whenever the env flag is on; App mounts it after file load finishes.
    enableOsmOverlay: osmEnabledByEnv,
    minimumChunkSize: large ? LARGE_FILE_MINIMUM_CHUNK_SIZE : NORMAL_MINIMUM_CHUNK_SIZE,
    renderChunkSize: large ? LARGE_FILE_RENDER_CHUNK_SIZE : Number.POSITIVE_INFINITY,
    parserTimeoutMs: getParserTimeoutMs(file),
    preloadAllFonts: !large && isDwgFile(file),
    deferPostLoadWork: large
  }
}

export const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** blob: URLs lose the original file name; map them so openUri can detect .dwg/.dxf */
const blobUrlFileNames = new Map<string, string>()

export const registerBlobUrlFileName = (url: string, fileName: string) => {
  blobUrlFileNames.set(url, fileName)
}

export const unregisterBlobUrlFileName = (url: string) => {
  blobUrlFileNames.delete(url)
}

export const resolveBlobUrlFileName = (uri: string): string | undefined => {
  return blobUrlFileNames.get(uri)
}

export const createFileObjectUrl = (file: File): string => {
  const url = URL.createObjectURL(file)
  registerBlobUrlFileName(url, file.name)
  return url
}

export const revokeFileObjectUrl = (url: string | undefined | null) => {
  if (!url) {
    return
  }

  unregisterBlobUrlFileName(url)
  URL.revokeObjectURL(url)
}
