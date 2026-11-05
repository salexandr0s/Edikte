import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { BASEMAP_TILE_TEMPLATE, TILE_LAYER, TILE_MAX_ZOOM, TILE_SCHEME } from '@shared/map'

// Map tiles for the renderer: parsed from the app scheme, served from the
// tiles folder and fetched from basemap.at when missing or old. Electron-free,
// so the address rules and the cache run under Vitest.

export interface Tile {
  z: number
  x: number
  y: number
}

/** Tiles are small PNGs; anything larger is not a tile. */
const MAX_TILE_BYTES = 1024 * 1024
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const TILE_PATH = /^\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.png$/

/**
 * The tile a `edikte-tile://basemap/{z}/{x}/{y}.png` address names, or null
 * for any other shape or coordinates outside the layer.
 */
export function parseTileUrl(raw: string): Tile | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== `${TILE_SCHEME}:` || url.hostname !== TILE_LAYER) return null
  if (url.port !== '' || url.username !== '' || url.password !== '' || url.search !== '')
    return null
  const match = TILE_PATH.exec(url.pathname)
  if (match === null) return null
  const [, zText, xText, yText] = match
  const z = Number(zText)
  const x = Number(xText)
  const y = Number(yText)
  if (z > TILE_MAX_ZOOM) return null
  const side = 2 ** z
  if (x >= side || y >= side) return null
  return { z, x, y }
}

/** Where a tile is kept: `<tilesDir>/basemap/<z>/<x>/<y>.png`. */
export function tileFilePath(tilesDir: string, tile: Tile): string {
  return path.join(tilesDir, TILE_LAYER, String(tile.z), String(tile.x), `${tile.y}.png`)
}

/** The address a tile is fetched from. */
export function upstreamTileUrl(tile: Tile): string {
  return BASEMAP_TILE_TEMPLATE.replace('{z}', String(tile.z))
    .replace('{x}', String(tile.x))
    .replace('{y}', String(tile.y))
}

export interface TileServerOptions {
  /** AppPaths.tiles. */
  tilesDir: string
  /** `userAgent(appVersion)` from src/main/scraper/client.ts. */
  userAgent: string
  /** Defaults to Node's global fetch; tests inject a fake. */
  fetch?: typeof globalThis.fetch
  /** A stored tile older than this is fetched again; basemap.at allows two weeks. */
  maxAgeMs?: number
  /** Upstream requests in flight at once. */
  concurrency?: number
  timeoutMs?: number
  now?: () => number
}

export interface TileServer {
  /** Answers a request of the app scheme. */
  serve(request: Request): Promise<Response>
}

const DEFAULTS = {
  maxAgeMs: 14 * 24 * 60 * 60 * 1000,
  concurrency: 4,
  timeoutMs: 20_000,
}

export function createTileServer(options: TileServerOptions): TileServer {
  const fetchImpl = options.fetch ?? globalThis.fetch
  const maxAgeMs = options.maxAgeMs ?? DEFAULTS.maxAgeMs
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs
  const now = options.now ?? (() => Date.now())
  const limit = createLimiter(options.concurrency ?? DEFAULTS.concurrency)
  /** One upstream request per tile, however many times the map asks for it meanwhile. */
  const inFlight = new Map<string, Promise<Uint8Array | null>>()

  const fetchTile = async (tile: Tile): Promise<Uint8Array | null> => {
    const response = await fetchImpl(upstreamTileUrl(tile), {
      headers: { 'User-Agent': options.userAgent, Accept: 'image/png,image/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 404) {
      await discard(response)
      return null
    }
    if (!response.ok) {
      await discard(response)
      throw new Error(`Tile server answered ${response.status}`)
    }
    const declared = Number(response.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_TILE_BYTES) {
      await discard(response)
      throw new Error('Tile too large')
    }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > MAX_TILE_BYTES || !isPng(bytes)) throw new Error('Not a PNG tile')
    return bytes
  }

  const fetchOnce = (tile: Tile, file: string): Promise<Uint8Array | null> => {
    const running = inFlight.get(file)
    if (running !== undefined) return running
    const task = limit(() => fetchTile(tile))
      .then(async (bytes) => {
        if (bytes !== null) await store(file, bytes)
        return bytes
      })
      .finally(() => inFlight.delete(file))
    inFlight.set(file, task)
    return task
  }

  return {
    async serve(request) {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(null, { status: 405 })
      }
      const tile = parseTileUrl(request.url)
      if (tile === null) return new Response(null, { status: 404 })
      const file = tileFilePath(options.tilesDir, tile)
      const storedAt = await modifiedAt(file)
      if (storedAt !== null && now() - storedAt < maxAgeMs) {
        return respond(await readFile(file), request.method)
      }
      try {
        const bytes = await fetchOnce(tile, file)
        if (bytes === null) return new Response(null, { status: 404 })
        return respond(bytes, request.method)
      } catch {
        // Offline or the tile server is down: an old tile beats none.
        if (storedAt !== null) return respond(await readFile(file), request.method)
        return new Response(null, { status: 502 })
      }
    },
  }
}

function respond(bytes: Uint8Array, method: string): Response {
  const headers = {
    'Content-Type': 'image/png',
    'Content-Length': String(bytes.byteLength),
    'Cache-Control': 'max-age=86400',
    'X-Content-Type-Options': 'nosniff',
  }
  return new Response(method === 'HEAD' ? null : bytes, { headers })
}

async function modifiedAt(file: string): Promise<number | null> {
  try {
    const info = await stat(file)
    return info.isFile() ? info.mtimeMs : null
  } catch {
    return null
  }
}

/** Writes next to the final name first, so a half-written tile is never served. */
async function store(file: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const partial = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.part`
  try {
    await writeFile(partial, bytes)
    await rename(partial, file)
  } catch (error) {
    await rm(partial, { force: true })
    throw error
  }
}

function isPng(bytes: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // The body is of no use either way.
  }
}

/** Runs at most `slots` tasks at once; the rest wait their turn. */
function createLimiter(slots: number): <T>(task: () => Promise<T>) => Promise<T> {
  let active = 0
  const waiting: Array<() => void> = []
  return async (task) => {
    if (active >= slots) await new Promise<void>((resolve) => waiting.push(resolve))
    active += 1
    try {
      return await task()
    } finally {
      active -= 1
      waiting.shift()?.()
    }
  }
}
