import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const VENV_DIR = join(ROOT, '.venv')
const REQUIREMENTS = join(ROOT, 'extract-data-dxf', 'requirements.txt')
const VENV_PYTHON =
  process.platform === 'win32'
    ? join(VENV_DIR, 'Scripts', 'python.exe')
    : join(VENV_DIR, 'bin', 'python')
const FORCE = process.argv.includes('--force')

const run = (command, args, { inherit = true, shell = false } = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: inherit ? 'inherit' : 'ignore',
      windowsHide: true,
      shell
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} ${args.join(' ')} thoát với mã ${code}`))
    })
  })

const venvHasPackages = async () => {
  if (!existsSync(VENV_PYTHON)) {
    return false
  }
  try {
    await run(VENV_PYTHON, ['-c', 'import ezdxf, aspose.cad, pymupdf, PIL, pyproj'], { inherit: false })
    return true
  } catch {
    return false
  }
}

const resolveSystemPython = async () => {
  const candidates =
    process.platform === 'win32'
      ? [
          { command: 'py', prefix: ['-3'], shell: true },
          { command: 'python', prefix: [], shell: false }
        ]
      : [
          { command: 'python3', prefix: [], shell: false },
          { command: 'python', prefix: [], shell: false }
        ]

  for (const candidate of candidates) {
    try {
      await run(candidate.command, [...candidate.prefix, '--version'], {
        inherit: false,
        shell: candidate.shell
      })
      return candidate
    } catch {
      continue
    }
  }

  throw new Error('Không tìm thấy Python 3. Cài Python 3 rồi chạy lại: pnpm setup:python')
}

const main = async () => {
  if (!existsSync(REQUIREMENTS)) {
    throw new Error(`Thiếu ${REQUIREMENTS}`)
  }

  if (!FORCE && (await venvHasPackages())) {
    console.log(`Dùng Python của ứng dụng: ${VENV_PYTHON}`)
    return
  }

  if (!existsSync(VENV_PYTHON)) {
    const python = await resolveSystemPython()
    console.log(`Tạo .venv bằng ${python.command}...`)
    await run(python.command, [...python.prefix, '-m', 'venv', VENV_DIR], {
      shell: python.shell
    })
  }

  if (!existsSync(VENV_PYTHON)) {
    throw new Error(`Không tạo được ${VENV_PYTHON}`)
  }

  console.log(`Cài ezdxf, aspose-cad, pymupdf vào ${VENV_DIR}...`)
  await run(VENV_PYTHON, ['-m', 'pip', 'install', '--upgrade', 'pip'])
  await run(VENV_PYTHON, ['-m', 'pip', 'install', '-r', REQUIREMENTS])
  await run(VENV_PYTHON, [
    '-c',
    'import ezdxf, aspose.cad, pymupdf, pyproj; print("OK ezdxf", ezdxf.__version__, "aspose-cad", "pyproj", pyproj.__version__)'
  ])
  console.log('Môi trường Python của ứng dụng đã sẵn sàng.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
