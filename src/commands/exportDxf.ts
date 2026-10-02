import { AcApDocManager } from '@mlightcad/cad-simple-viewer'

import { collectEzdxfPayload, collectSheetEzdxfPayload } from './ezdxfPayload'
import { store } from '../store'

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

const encodeExportBody = async (payload: unknown, file?: Blob) => {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload))
  const prefix = new ArrayBuffer(4)
  new DataView(prefix).setUint32(0, payloadBytes.length, true)
  return file ? new Blob([prefix, payloadBytes, file]) : new Blob([prefix, payloadBytes])
}

const postExportDxf = async (
  payload: unknown,
  fileName: string,
  sourceName: string,
  mode: 'merged' | 'sheet',
  file?: Blob
) => {
  let response: Response
  try {
    response = await fetch(`/api/export-dxf?mode=${mode}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Export-Mode': mode,
        'X-Export-File-Name': encodeURIComponent(sourceName),
        'X-Export-Output-Name': encodeURIComponent(fileName)
      },
      body: await encodeExportBody(payload, file)
    })
  } catch {
    return {
      ok: false as const,
      message: 'Không gọi được ezdxf. Hãy chạy lại pnpm dev để bật API xuất DXF.'
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
      message: detail || 'ezdxf không xuất được file DXF.'
    }
  }

  const blob = await response.blob()
  if (blob.size < 32) {
    return { ok: false as const, message: 'File DXF tạo ra không hợp lệ. Không tải xuống.' }
  }

  downloadBlob(blob, fileName)
  return {
    ok: true as const,
    fileName,
    response,
    blob
  }
}

export const exportCurrentDrawingToDxf = async () => {
  const document = getDocument()
  const sourceFile = store.selectedFile
  if (!document || !sourceFile) {
    return { ok: false as const, message: 'Hãy mở bản vẽ trước khi xuất DXF.' }
  }

  const payload = collectEzdxfPayload()
  const fileName = `${fileBaseName(document.fileName || document.docTitle || sourceFile.name)}-xuat.dxf`
  const posted = await postExportDxf(payload, fileName, sourceFile.name, 'merged', sourceFile)
  if (!posted.ok) {
    return posted
  }

  const added = Number(posted.response.headers.get('X-Export-Added') || payload.entities.length)
  const updated = Number(posted.response.headers.get('X-Export-Updated') || payload.updates.length)

  return {
    ok: true as const,
    fileName,
    entityCount: added,
    mode: 'ezdxf' as const,
    message: `Đã xuất bằng ezdxf: giữ nguyên bản vẽ gốc, thêm ${added.toLocaleString('vi-VN')} đối tượng mới${
      updated ? `, cập nhật ${updated.toLocaleString('vi-VN')} đối tượng đã sửa` : ''
    } ra ${fileName}.`
  }
}

export const exportSheetTemplateToDxf = async () => {
  const document = getDocument()
  const sourceFile = store.selectedFile
  if (!document || !sourceFile) {
    return { ok: false as const, message: 'Hãy mở bản vẽ trước khi xuất khung mẫu.' }
  }

  const payload = collectSheetEzdxfPayload()
  if (!payload.entities.length) {
    return {
      ok: false as const,
      message: 'Không tìm thấy khung mẫu trên bản vẽ. Hãy vẽ lại khung mẫu (lớp "Khung mẫu") rồi xuất.'
    }
  }

  const fileName = `${fileBaseName(document.fileName || document.docTitle || sourceFile.name)}-khung-mau.dxf`
  const posted = await postExportDxf(payload, fileName, sourceFile.name, 'sheet', sourceFile)
  if (!posted.ok) {
    return posted
  }

  const added = Number(posted.response.headers.get('X-Export-Added') || payload.entities.length)
  return {
    ok: true as const,
    fileName,
    entityCount: added,
    mode: 'sheet' as const,
    message: `Đã xuất khung mẫu bằng ezdxf, giữ nguyên tọa độ file gốc (${added.toLocaleString('vi-VN')} đối tượng) ra ${fileName}.`
  }
}
