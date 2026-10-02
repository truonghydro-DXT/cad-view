import { AcApDocManager } from '@mlightcad/cad-simple-viewer'

import { collectEzdxfPayload } from './ezdxfPayload'
import { store } from '../store'

export type PdfPaperSize = 'A4' | 'A3' | 'A2' | 'Letter' | 'Legal'
export type PdfOrientation = 'auto' | 'portrait' | 'landscape'

const getDocument = () => {
  try {
    return AcApDocManager.instance.curDocument
  } catch {
    return undefined
  }
}

const fileBaseName = (fileName?: string) => {
  const normalized = (fileName || 'ban-ve').trim() || 'ban-ve'
  return normalized.replace(/\.[^.]+$/, '') || 'ban-ve'
}

const downloadBlob = (blob: Blob, fileName: string) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

const encodeExportBody = async (file: File, payload: unknown) => {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
  const prefix = new ArrayBuffer(4)
  new DataView(prefix).setUint32(0, payloadBytes.length, true)
  return new Blob([prefix, payloadBytes, file])
}

export const exportCurrentDrawingToPdf = async (options: {
  paperSize?: PdfPaperSize
  orientation?: PdfOrientation
  fileName?: string
}) => {
  const document = getDocument()
  const sourceFile = store.selectedFile
  if (!document || !sourceFile) {
    return { ok: false as const, message: 'Hãy mở bản vẽ trước khi xuất PDF.' }
  }

  const payload = collectEzdxfPayload()
  const fileName =
    options.fileName?.trim() ||
    `${fileBaseName(document.fileName || document.docTitle || sourceFile.name)}.pdf`

  let response: Response
  try {
    response = await fetch('/api/export-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Export-File-Name': encodeURIComponent(sourceFile.name),
        'X-Export-Output-Name': encodeURIComponent(fileName),
        'X-Export-Paper': encodeURIComponent(options.paperSize || 'A4'),
        'X-Export-Orientation': encodeURIComponent(options.orientation || 'auto')
      },
      body: await encodeExportBody(sourceFile, payload)
    })
  } catch {
    return {
      ok: false as const,
      message: 'Không gọi được dxf2pdf. Hãy chạy lại pnpm dev để bật API xuất PDF.'
    }
  }

  if (!response.ok) {
    let detail = ''
    try {
      const errorBody = (await response.json()) as { message?: string }
      detail = errorBody.message || ''
    } catch {
      detail = await response.text()
    }
    return {
      ok: false as const,
      message: detail || 'ezdxf/dxf2pdf không xuất được file PDF.'
    }
  }

  const blob = await response.blob()
  if (blob.size < 32) {
    return { ok: false as const, message: 'File PDF tạo ra không hợp lệ. Không tải xuống.' }
  }

  downloadBlob(blob, fileName)
  return {
    ok: true as const,
    fileName,
    message: `Đã xuất PDF bằng ezdxf/dxf2pdf ra ${fileName}.`
  }
}
