import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, copyFile, readFile, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Plugin } from 'vite'

const ROOT = dirname(fileURLToPath(import.meta.url))
const DXF_SCRIPT = join(ROOT, 'extract-data-dxf', 'extract-data-dxf.py')
const PDF_SCRIPT = join(ROOT, 'extract-data-dxf', 'dxf2pdf.py')
const CONVERT_SCRIPT = join(ROOT, 'extract-data-dxf', 'convert_dxf2dxf.py')
const DWG_TO_DXF_SCRIPT = join(ROOT, 'extract-data-dxf', 'dwg-to-dxf.py')
const VN2000_DIR = join(ROOT, 'VN2000_TM')
const VENV_PYTHON =
  process.platform === 'win32'
    ? join(ROOT, '.venv', 'Scripts', 'python.exe')
    : join(ROOT, '.venv', 'bin', 'python')

const readRequestBuffer = (req: IncomingMessage) =>
  new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })

const headerText = (req: IncomingMessage, name: string) => {
  const value = req.headers[name]
  const raw = Array.isArray(value) ? value[0] || '' : value || ''
  if (!raw) {
    return ''
  }
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

const looksLikeDwgBuffer = (body: Buffer) => /^AC\d{4}/.test(body.subarray(0, 6).toString('latin1'))

const runPython = (args: string[]) =>
  new Promise<string>((resolve, reject) => {
    if (!existsSync(VENV_PYTHON)) {
      reject(new Error('Chưa có môi trường Python của ứng dụng (.venv). Chạy: pnpm setup:python'))
      return
    }

    const child = spawn(VENV_PYTHON, args, {
      cwd: ROOT,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        DOTNET_SYSTEM_GLOBALIZATION_INVARIANT: '1'
      }
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      reject(
        new Error(
          `Không chạy được Python trong .venv. Chạy: pnpm setup:python. ${error.message}`
        )
      )
    })
    child.on('close', (code) => {
      if (code !== 0) {
        const detail = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n')
        console.error('[convert-vn2000] python failed', args.join(' '), detail)
        reject(new Error(detail || `Python thoát với mã ${code}`))
        return
      }
      resolve(stdout.trim())
    })
  })

const parseExportBody = async (req: IncomingMessage) => {
  const fileName = headerText(req, 'x-export-file-name') || 'ban-ve.dxf'
  const outputName = headerText(req, 'x-export-output-name') || 'ban-ve-xuat.dxf'
  const paper = headerText(req, 'x-export-paper') || 'A4'
  const orientation = headerText(req, 'x-export-orientation') || 'auto'
  const queryMode = (() => {
    try {
      return new URL(req.url || '', 'http://127.0.0.1').searchParams.get('mode') || ''
    } catch {
      return ''
    }
  })()
  const exportMode = queryMode || headerText(req, 'x-export-mode') || 'merged'
  const sheetOnly = exportMode === 'sheet'
  const payloadOnly = exportMode === 'payload-only'
  const body = await readRequestBuffer(req)
  if (body.length < 6) {
    throw new Error(sheetOnly || payloadOnly ? 'Thiếu dữ liệu khung mẫu để xuất DXF.' : 'Thiếu file gốc để ezdxf đọc.')
  }

  const payloadSize = body.readUInt32LE(0)
  if (payloadSize < 2 || payloadSize > body.length - 4) {
    throw new Error('Payload xuất không hợp lệ.')
  }

  const payload = JSON.parse(body.subarray(4, 4 + payloadSize).toString('utf8'))
  const fileBytes = body.subarray(4 + payloadSize)
  if (!payloadOnly && !fileBytes.length) {
    throw new Error(
      sheetOnly
        ? 'Thiếu file gốc để giữ hệ tọa độ khi xuất khung mẫu.'
        : 'Thiếu file gốc để ezdxf đọc.'
    )
  }

  return { fileName, outputName, paper, orientation, payload, fileBytes, payloadOnly, sheetOnly }
}

const writeExportWorkspace = async (
  fileName: string,
  fileBytes: Buffer,
  payload: unknown,
  payloadOnly = false
) => {
  const workDir = await mkdtemp(join(tmpdir(), 'cad-ezdxf-'))
  const extension = fileName.toLowerCase().endsWith('.dwg') ? '.dwg' : '.dxf'
  const inputPath = join(workDir, `source${extension}`)
  const mergedPath = join(workDir, 'merged.dxf')
  const payloadPath = join(workDir, 'payload.json')
  if (!payloadOnly) {
    await writeFile(inputPath, fileBytes)
  }
  await writeFile(payloadPath, JSON.stringify(payload), 'utf8')
  return { workDir, inputPath, mergedPath, payloadPath }
}

const sendJsonError = (res: ServerResponse, status: number, message: string) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ ok: false, message }))
}

const handleExportDxf = async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }

  let workDir = ''
  try {
    const { fileName, outputName, payload, fileBytes, payloadOnly, sheetOnly } = await parseExportBody(req)
    const workspace = await writeExportWorkspace(fileName, fileBytes, payload, payloadOnly)
    workDir = workspace.workDir
    const pythonArgs = payloadOnly
      ? [
          DXF_SCRIPT,
          '--export',
          '--payload-only',
          '--output',
          workspace.mergedPath,
          '--payload',
          workspace.payloadPath
        ]
      : sheetOnly
        ? [
            DXF_SCRIPT,
            '--export',
            '--sheet-only',
            '--input',
            workspace.inputPath,
            '--output',
            workspace.mergedPath,
            '--payload',
            workspace.payloadPath
          ]
        : [
            DXF_SCRIPT,
            '--export',
            '--input',
            workspace.inputPath,
            '--output',
            workspace.mergedPath,
            '--payload',
            workspace.payloadPath
          ]
    const stdout = await runPython(pythonArgs)
    const result = (() => {
      try {
        return JSON.parse(stdout || '{"added":0,"updated":0}') as { added?: number; updated?: number }
      } catch {
        return { added: 0, updated: 0 }
      }
    })()
    const dxf = await readFile(workspace.mergedPath)
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/dxf; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`)
    res.setHeader('X-Export-Added', String(result.added ?? 0))
    res.setHeader('X-Export-Updated', String(result.updated ?? 0))
    res.end(dxf)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    sendJsonError(res, 500, detail)
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

const handleExportPdf = async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }

  let workDir = ''
  try {
    const { fileName, outputName, paper, orientation, payload, fileBytes } = await parseExportBody(req)
    const workspace = await writeExportWorkspace(fileName, fileBytes, payload)
    workDir = workspace.workDir
    const pdfPath = join(workDir, 'output.pdf')
    await runPython([
      DXF_SCRIPT,
      '--export',
      '--input',
      workspace.inputPath,
      '--output',
      workspace.mergedPath,
      '--payload',
      workspace.payloadPath
    ])
    await runPython([
      PDF_SCRIPT,
      '--input',
      workspace.mergedPath,
      '--output',
      pdfPath,
      '--paper',
      paper || 'A4',
      '--orientation',
      orientation || 'auto'
    ])
    const pdf = await readFile(pdfPath)
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`)
    res.end(pdf)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    sendJsonError(res, 500, detail)
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

const resolveVn2000Prj = (preset: string) => {
  const name = preset.replace(/[^A-Za-z0-9_]/g, '')
  if (!name || name === 'auto' || name === 'custom') {
    return ''
  }
  const prjPath = join(VN2000_DIR, `${name}.prj`)
  return existsSync(prjPath) ? prjPath : ''
}

const parseConvertJson = (stdout: string) => {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .reverse()
    .find((item) => item.startsWith('{') && item.endsWith('}'))
  if (!line) {
    return {} as Record<string, unknown>
  }
  try {
    return JSON.parse(line) as Record<string, unknown>
  } catch {
    return {} as Record<string, unknown>
  }
}

const handleConvertVn2000 = async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== 'POST') {
    res.statusCode = 405
    res.end('Method Not Allowed')
    return
  }

  let workDir = ''
  try {
    const fileName = headerText(req, 'x-convert-file-name') || 'ban-ve.dxf'
    const outputName = headerText(req, 'x-convert-output-name') || 'ban-ve-wgs84.dxf'
    const preset = headerText(req, 'x-convert-preset') || 'auto'
    const cmText = headerText(req, 'x-convert-cm')
    const force = headerText(req, 'x-convert-force') === '1'
    const body = await readRequestBuffer(req)
    if (body.length < 32) {
      throw new Error('Thiếu file DXF/DWG để chuyển VN2000 → WGS 84.')
    }

    workDir = await mkdtemp(join(tmpdir(), 'cad-vn2000-'))
    const keepCrs = headerText(req, 'x-convert-keep-crs') === '1'
    const isDwg =
      fileName.toLowerCase().endsWith('.dwg') || looksLikeDwgBuffer(body)
    const outputPath = join(workDir, 'converted.dxf')
    const inputPath = join(workDir, 'source.dxf')
    let dwgInfo: Record<string, unknown> = {}

    if (isDwg) {
      const dwgPath = join(workDir, 'source.dwg')
      await writeFile(dwgPath, body)
      const dwgStdout = await runPython([DWG_TO_DXF_SCRIPT, dwgPath, '-o', inputPath, '--json'])
      dwgInfo = parseConvertJson(dwgStdout)
      if (!existsSync(inputPath)) {
        throw new Error(dwgStdout.trim() || 'aspose-cad không chuyển được DWG → DXF.')
      }
      if (keepCrs) {
        await copyFile(inputPath, outputPath)
        const dxf = await readFile(outputPath)
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/dxf; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`)
        res.setHeader('X-Convert-Entities', String(dwgInfo.entities ?? 0))
        res.setHeader('X-Convert-Source', encodeURIComponent(String(dwgInfo.source ?? 'EPSG:3857')))
        res.setHeader('X-Convert-Target', encodeURIComponent(String(dwgInfo.target ?? 'EPSG:3857')))
        res.setHeader('X-Convert-Meridian', encodeURIComponent(String(dwgInfo.central_meridian ?? '')))
        res.setHeader('X-Convert-File-Name', encodeURIComponent(outputName))
        res.setHeader('X-Convert-From-Dwg', '1')
        res.end(dxf)
        return
      }
    } else {
      await writeFile(inputPath, body)
    }

    try {
      const args = keepCrs
        ? [CONVERT_SCRIPT, inputPath, '-o', outputPath, '--json', '--keep-crs']
        : [CONVERT_SCRIPT, inputPath, '-o', outputPath, '--json', '--crs', 'EPSG:3857']
      if (!keepCrs) {
        const prjPath = resolveVn2000Prj(preset)
        if (prjPath) {
          args.push('--prj', prjPath)
        } else if (cmText) {
          const cm = Number(cmText)
          if (Number.isFinite(cm)) {
            args.push('--cm', String(cm))
          }
        }
        if (force) {
          args.push('--force')
        }
      }

      const stdout = await runPython(args)
      if (!existsSync(outputPath)) {
        throw new Error(stdout.trim() || 'Không chuyển được VN2000 → WGS 84.')
      }
      const info = parseConvertJson(stdout)
      const dxf = await readFile(outputPath)
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/dxf; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`)
      res.setHeader('X-Convert-Entities', String(info.entities ?? dwgInfo.entities ?? 0))
      res.setHeader('X-Convert-Source', encodeURIComponent(String(info.source ?? dwgInfo.source ?? '')))
      res.setHeader('X-Convert-Target', encodeURIComponent(String(info.target ?? 'EPSG:3857')))
      res.setHeader('X-Convert-Meridian', encodeURIComponent(String(info.central_meridian ?? '')))
      res.setHeader('X-Convert-File-Name', encodeURIComponent(outputName))
      res.setHeader('X-Convert-From-Dwg', isDwg ? '1' : '0')
      res.end(dxf)
      return
    } catch (crsError) {
      if (isDwg && existsSync(inputPath)) {
        await copyFile(inputPath, outputPath)
        const dxf = await readFile(outputPath)
        res.statusCode = 200
        res.setHeader('Content-Type', 'application/dxf; charset=utf-8')
        res.setHeader('Content-Disposition', `attachment; filename="${outputName}"`)
        res.setHeader('X-Convert-Entities', String(dwgInfo.entities ?? 0))
        res.setHeader('X-Convert-Source', encodeURIComponent(String(dwgInfo.source ?? 'EPSG:3857')))
        res.setHeader('X-Convert-Target', encodeURIComponent('EPSG:3857'))
        res.setHeader('X-Convert-Meridian', encodeURIComponent(''))
        res.setHeader('X-Convert-File-Name', encodeURIComponent(outputName))
        res.setHeader('X-Convert-From-Dwg', '1')
        res.end(dxf)
        return
      }
      throw crsError
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    console.error('[convert-vn2000]', detail)
    sendJsonError(res, 500, detail)
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

export const ezdxfExportPlugin = (): Plugin => ({
  name: 'ezdxf-export',
  configureServer(server) {
    server.middlewares.use('/api/export-dxf', (req, res) => {
      void handleExportDxf(req, res)
    })
    server.middlewares.use('/api/export-pdf', (req, res) => {
      void handleExportPdf(req, res)
    })
    server.middlewares.use('/api/convert-vn2000', (req, res) => {
      void handleConvertVn2000(req, res)
    })
  },
  configurePreviewServer(server) {
    server.middlewares.use('/api/export-dxf', (req, res) => {
      void handleExportDxf(req, res)
    })
    server.middlewares.use('/api/export-pdf', (req, res) => {
      void handleExportPdf(req, res)
    })
    server.middlewares.use('/api/convert-vn2000', (req, res) => {
      void handleConvertVn2000(req, res)
    })
  }
})
