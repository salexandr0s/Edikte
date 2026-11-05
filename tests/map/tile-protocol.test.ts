import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createTileServer,
  parseTileUrl,
  tileFilePath,
  upstreamTileUrl,
} from '../../src/main/map/tile-protocol'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe('parseTileUrl', () => {
  it('reads the layer, zoom and tile numbers', () => {
    expect(parseTileUrl('edikte-tile://basemap/14/8940/5680.png')).toEqual({
      z: 14,
      x: 8940,
      y: 5680,
    })
    expect(upstreamTileUrl({ z: 14, x: 8940, y: 5680 })).toBe(
      'https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/14/5680/8940.png',
    )
  })

  it('refuses other shapes and tiles outside the layer', () => {
    for (const raw of [
      'edikte-tile://basemap/14/8940/5680.jpg',
      'edikte-tile://basemap/14/8940.png',
      'edikte-tile://other/14/8940/5680.png',
      'edikte-tile://basemap/14/8940/5680.png?x=1',
      'edikte-tile://basemap/20/1/1.png',
      'edikte-tile://basemap/2/4/1.png',
      'https://basemap/14/8940/5680.png',
      'not a url',
    ]) {
      expect(parseTileUrl(raw), raw).toBeNull()
    }
  })
})

describe('createTileServer', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'edikte-tiles-'))
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  function upstream(answer: () => Response | Error) {
    let calls = 0
    const fetchImpl: typeof fetch = () => {
      calls += 1
      const result = answer()
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result)
    }
    return { fetch: fetchImpl, calls: () => calls }
  }

  const request = (method = 'GET') =>
    new Request('edikte-tile://basemap/14/8940/5680.png', { method })

  it('fetches a missing tile once, keeps it and serves it from disk after that', async () => {
    const source = upstream(() => new Response(PNG, { headers: { 'Content-Type': 'image/png' } }))
    const server = createTileServer({
      tilesDir: dir,
      userAgent: 'Edikte/test',
      fetch: source.fetch,
    })
    const [first, second] = await Promise.all([server.serve(request()), server.serve(request())])
    expect(first.status).toBe(200)
    expect(first.headers.get('content-type')).toBe('image/png')
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(PNG)
    expect(second.status).toBe(200)
    expect(source.calls()).toBe(1)

    const file = tileFilePath(dir, { z: 14, x: 8940, y: 5680 })
    expect(new Uint8Array(await readFile(file))).toEqual(PNG)
    const third = await server.serve(request())
    expect(third.status).toBe(200)
    expect(source.calls()).toBe(1)
    const head = await server.serve(request('HEAD'))
    expect(head.headers.get('content-length')).toBe(String(PNG.byteLength))
  })

  it('fetches an old tile again and falls back to it when the server is down', async () => {
    const file = tileFilePath(dir, { z: 14, x: 8940, y: 5680 })
    await writeFile(file, PNG).catch(async () => {
      const { mkdir } = await import('node:fs/promises')
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, PNG)
    })
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    await utimes(file, old, old)
    const source = upstream(() => new Error('offline'))
    const server = createTileServer({
      tilesDir: dir,
      userAgent: 'Edikte/test',
      fetch: source.fetch,
    })
    const response = await server.serve(request())
    expect(source.calls()).toBe(1)
    expect(response.status).toBe(200)
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG)
  })

  it('answers 502 without a tile when the server is down, and 404 when there is none', async () => {
    const down = upstream(() => new Error('offline'))
    const server = createTileServer({ tilesDir: dir, userAgent: 'Edikte/test', fetch: down.fetch })
    expect((await server.serve(request())).status).toBe(502)
    const missing = upstream(() => new Response(null, { status: 404 }))
    const other = createTileServer({
      tilesDir: dir,
      userAgent: 'Edikte/test',
      fetch: missing.fetch,
    })
    expect((await other.serve(request())).status).toBe(404)
    expect((await other.serve(new Request('edikte-tile://basemap/x.png'))).status).toBe(404)
    expect((await other.serve(request('POST'))).status).toBe(405)
    await expect(stat(tileFilePath(dir, { z: 14, x: 8940, y: 5680 }))).rejects.toThrow()
  })

  it('keeps nothing that is not a PNG', async () => {
    const html = upstream(
      () => new Response('<html>', { headers: { 'Content-Type': 'image/png' } }),
    )
    const server = createTileServer({ tilesDir: dir, userAgent: 'Edikte/test', fetch: html.fetch })
    expect((await server.serve(request())).status).toBe(502)
    await expect(stat(tileFilePath(dir, { z: 14, x: 8940, y: 5680 }))).rejects.toThrow()
  })
})
