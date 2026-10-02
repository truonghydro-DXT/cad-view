import { defineConfig, type Plugin } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import vue from '@vitejs/plugin-vue'
import { networkInterfaces } from 'node:os'

import { ezdxfExportPlugin } from './vite-plugin-ezdxf-export'
import { osmTilesPlugin } from './vite-plugin-osm-tiles'

const isScriptModuleUrl = (url = '') => {
  const path = url.split('?')[0]
  return /\.(?:[cm]?[jt]sx?|vue|mjs)$/i.test(path)
}

const forceScriptMimePlugin = (): Plugin => ({
  name: 'force-script-mime',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const dest = String(req.headers['sec-fetch-dest'] || '')
      const treatAsScript = dest === 'script' || isScriptModuleUrl(req.url)
      if (!treatAsScript) {
        next()
        return
      }

      const setHeader = res.setHeader.bind(res)
      res.setHeader = ((name: string, value: number | string | readonly string[]) => {
        if (String(name).toLowerCase() === 'content-type' && !String(value || '').trim()) {
          return res
        }
        return setHeader(name, value)
      }) as typeof res.setHeader
      setHeader('Content-Type', 'text/javascript')
      next()
    })
  }
})

function getLocalIpv4(): string {
  const nets = networkInterfaces()

  for (const addresses of Object.values(nets)) {
    if (!addresses) {
      continue
    }

    for (const addr of addresses) {
      if (addr.family === 'IPv4' && !addr.internal) {
        return addr.address
      }
    }
  }

  return 'localhost'
}

export default defineConfig(() => {
  const host = getLocalIpv4()
  const plugins = [
    forceScriptMimePlugin(),
    vue(),
    ezdxfExportPlugin(),
    osmTilesPlugin(),
    viteStaticCopy({
      targets: [
        {
          src: './node_modules/@mlightcad/data-model/dist/dxf-parser-worker.js',
          dest: 'assets'
        },
        {
          src: './node_modules/@mlightcad/cad-simple-viewer/dist/*-worker.js',
          dest: 'assets'
        },
        {
          src: './src/assets/fonts/*',
          dest: 'assets/fonts'
        }
      ]
    })
  ]

  return {
    base: './',
    build: {
      outDir: 'dist',
      modulePreload: false,
      rollupOptions: {
        // Main entry point for the app
        input: {
          main: 'index.html'
        }
      }
    },
    optimizeDeps: {
      exclude: ['dwg2dxf-converter']
    },
    server: {
      host,
      cors: true,
      headers: {
        'Cache-Control': 'no-store'
      }
    },
    preview: {
      host
    },
    plugins: plugins
  }
})
