import { AcApDocManager, AcApDocument } from '@mlightcad/cad-simple-viewer'
import { AcDbDatabase } from '@mlightcad/data-model'

import { resolveBlobUrlFileName } from './largeFileMode'

type OpenOptions = {
  minimumChunkSize?: number
  timeout?: number
  mode?: unknown
  readOnly?: boolean
}

const DEFAULT_MINIMUM_CHUNK_SIZE = 1000

let activeMinimumChunkSize = DEFAULT_MINIMUM_CHUNK_SIZE
let activeRenderChunkSize = Number.POSITIVE_INFINITY
let activeParserTimeoutMs: number | undefined
let performancePatchesApplied = false
let batchConvertPatched = false
let blobUrlFileNamePatchApplied = false

const mergeOpenOptions = (options: OpenOptions | undefined): OpenOptions => {
  return {
    ...options,
    minimumChunkSize: activeMinimumChunkSize,
    ...(activeParserTimeoutMs != null ? { timeout: activeParserTimeoutMs } : {})
  }
}

const yieldToMainThread = () =>
  new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })

const patchBlobUrlFileNameResolution = () => {
  if (blobUrlFileNamePatchApplied) {
    return
  }

  const patchGetFileNameFromUri = (target: {
    getFileNameFromUri?: (uri: string) => string
  }) => {
    const original = target.getFileNameFromUri
    if (!original || original.name === 'patchedGetFileNameFromUriForBlobUrl') {
      return
    }

    target.getFileNameFromUri = function patchedGetFileNameFromUriForBlobUrl(uri: string) {
      return resolveBlobUrlFileName(uri) ?? original.call(this, uri)
    }
  }

  patchGetFileNameFromUri(
    AcApDocument.prototype as unknown as { getFileNameFromUri?: (uri: string) => string }
  )
  patchGetFileNameFromUri(
    AcDbDatabase.prototype as unknown as { getFileNameFromUri?: (uri: string) => string }
  )
  blobUrlFileNamePatchApplied = true
}

const patchOpenDocumentOptions = () => {
  const docManagerPrototype = AcApDocManager.prototype as unknown as {
    openDocument?: (
      fileName: string,
      content: ArrayBuffer,
      options?: OpenOptions
    ) => Promise<boolean>
    openUrl?: (url: string, options?: OpenOptions) => Promise<boolean>
  }

  const originalOpenDocument = docManagerPrototype.openDocument
  if (originalOpenDocument && originalOpenDocument.name !== 'patchedOpenDocumentForLargeFiles') {
    docManagerPrototype.openDocument = async function patchedOpenDocumentForLargeFiles(
      fileName,
      content,
      options
    ) {
      return originalOpenDocument.call(this, fileName, content, mergeOpenOptions(options))
    }
  }

  const originalOpenUrl = docManagerPrototype.openUrl
  if (originalOpenUrl && originalOpenUrl.name !== 'patchedOpenUrlForLargeFiles') {
    docManagerPrototype.openUrl = async function patchedOpenUrlForLargeFiles(url, options) {
      return originalOpenUrl.call(this, url, mergeOpenOptions(options))
    }
  }

  patchBlobUrlFileNameResolution()
}

const patchBatchConvert = () => {
  if (batchConvertPatched) {
    return
  }

  const view = AcApDocManager.instance?.curView as unknown as
    | {
        batchConvert?: (entities: unknown[]) => Promise<void>
      }
    | undefined

  if (!view?.batchConvert || view.batchConvert.name === 'patchedBatchConvertForLargeFiles') {
    return
  }

  const originalBatchConvert = view.batchConvert.bind(view)

  view.batchConvert = async function patchedBatchConvertForLargeFiles(entities: unknown[]) {
    const chunkSize = activeRenderChunkSize
    if (!Number.isFinite(chunkSize) || entities.length <= chunkSize) {
      return originalBatchConvert(entities)
    }

    for (let index = 0; index < entities.length; index += chunkSize) {
      // Prefer subarray-style windowing without copying when possible via slice end bound.
      await originalBatchConvert(entities.slice(index, index + chunkSize))

      if (index + chunkSize < entities.length) {
        await yieldToMainThread()
      }
    }
  }

  batchConvertPatched = true
}

export const applyCadPerformanceSettings = (settings: {
  minimumChunkSize: number
  renderChunkSize?: number
  parserTimeoutMs?: number
  isLargeFile: boolean
}) => {
  activeMinimumChunkSize = settings.minimumChunkSize
  activeRenderChunkSize =
    settings.renderChunkSize ??
    (settings.isLargeFile ? 800 : Number.POSITIVE_INFINITY)
  activeParserTimeoutMs = settings.parserTimeoutMs

  if (!performancePatchesApplied) {
    patchOpenDocumentOptions()
    performancePatchesApplied = true
  }
}

export const applyCadRenderOptimizations = () => {
  if (!Number.isFinite(activeRenderChunkSize)) {
    return
  }

  patchBatchConvert()
}
