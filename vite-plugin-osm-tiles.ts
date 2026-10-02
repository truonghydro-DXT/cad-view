import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin, ViteDevServer } from 'vite'

const TILE_PATH = /\/osm-tiles\/(\d+)\/(\d+)\/(\d+)\.png(?:\?.*)?$/
const USER_AGENT =
  'cad-viewer/1.0 (https://github.com/mlightcad/cad-viewer-example; OSM overlay)'
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const CACHE_MAX_ENTRIES = 256
const OSM_ORG_TIMEOUT_MS = 2500
const MIRROR_TIMEOUT_MS = 8000

const UPSTREAMS: Array<{
  name: string
  timeoutMs: number
  url: (zoom: number, x: number, y: number) => string
}> = [
  {
    name: 'osm.org',
    timeoutMs: OSM_ORG_TIMEOUT_MS,
    url: (zoom, x, y) => `https://tile.openstreetmap.org/${zoom}/${x}/${y}.png`
  },
  {
    name: 'osm.fr',
    timeoutMs: MIRROR_TIMEOUT_MS,
    url: (zoom, x, y) =>
      `https://${['a', 'b', 'c'][x % 3]}.tile.openstreetmap.fr/osmfr/${zoom}/${x}/${y}.png`
  }
]

type CachedTile = {
  body: Buffer
  contentType: string
  expiresAt: number
}

const tileCache = new Map<string, CachedTile>()
let preferredUpstreamIndex = 0
let osmOrgBlockedUntil = 0

const sendText = (res: ServerResponse, status: number, message: string) => {
  res.statusCode = status
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.end(message)
}

const fetchTile = async (url: string, timeoutMs: number) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'image/png,image/*;q=0.8'
      }
    })

    if (!response.ok) {
      return null
    }

    const body = Buffer.from(await response.arrayBuffer())
    if (body.length < 80) {
      return null
    }

    return {
      body,
      contentType: response.headers.get('content-type') || 'image/png'
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

const rememberCache = (key: string, tile: CachedTile) => {
  if (tileCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = tileCache.keys().next().value
    if (oldestKey) {
      tileCache.delete(oldestKey)
    }
  }

  tileCache.set(key, tile)
}

const handleTileRequest = async (req: IncomingMessage, res: ServerResponse) => {
  const match = (req.url || '').match(TILE_PATH)
  if (!match) {
    sendText(res, 404, 'OSM tile not found')
    return
  }

  const zoom = Number(match[1])
  const x = Number(match[2])
  const y = Number(match[3])
  const cacheKey = `${zoom}/${x}/${y}`
  const cached = tileCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) {
    res.statusCode = 200
    res.setHeader('Content-Type', cached.contentType)
    res.setHeader('Cache-Control', 'public, max-age=604800')
    res.end(cached.body)
    return
  }

  const now = Date.now()
  const order = [preferredUpstreamIndex, ...UPSTREAMS.map((_, index) => index)].filter(
    (index, position, list) => list.indexOf(index) === position
  )

  for (const index of order) {
    const upstream = UPSTREAMS[index]
    if (!upstream) {
      continue
    }

    if (upstream.name === 'osm.org' && now < osmOrgBlockedUntil) {
      continue
    }

    const tile = await fetchTile(upstream.url(zoom, x, y), upstream.timeoutMs)
    if (!tile) {
      if (upstream.name === 'osm.org') {
        osmOrgBlockedUntil = Date.now() + 10 * 60 * 1000
      }
      continue
    }

    preferredUpstreamIndex = index
    rememberCache(cacheKey, {
      body: tile.body,
      contentType: tile.contentType,
      expiresAt: Date.now() + CACHE_TTL_MS
    })
    res.statusCode = 200
    res.setHeader('Content-Type', tile.contentType)
    res.setHeader('Cache-Control', 'public, max-age=604800')
    res.end(tile.body)
    return
  }

  sendText(res, 502, 'OSM tile upstream unavailable')
}

const attachTileMiddleware = (server: ViteDevServer) => {
  server.middlewares.use((req, res, next) => {
    if (req.method !== 'GET' || !TILE_PATH.test(req.url || '')) {
      next()
      return
    }

    void handleTileRequest(req, res)
  })
}

export const osmTilesPlugin = (): Plugin => ({
  name: 'osm-tiles-proxy',
  configureServer: attachTileMiddleware,
  configurePreviewServer: attachTileMiddleware
})
