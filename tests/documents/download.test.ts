import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { downloadDocument, type DownloadOptions } from '../../src/main/documents/download'
import { safePdfFileName } from '../../src/main/documents/file-names'

const EDICT_ID = '0123456789abcdef0123456789abcdef'
const START = 'https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/0/abc/$file/gutachten.pdf'
// A made-up JustizOnline record and one of its files.
const INSOLVENCY_EDICT_ID = 'mv-990001'
const INSOLVENCY_FILE =
  'https://justizonline.gv.at/jop/service/edi/v1/edikte/990001/resources/TVZfOTkwMDAx'
const PDF = new TextEncoder().encode('%PDF-1.4\n% test file\n%%EOF\n')

let documentsDir: string

beforeEach(async () => {
  documentsDir = await mkdtemp(path.join(tmpdir(), 'edikte-download-'))
})

afterEach(async () => {
  await rm(documentsDir, { recursive: true, force: true })
})

function fakeFetch(respond: (url: string) => Response): { fetch: typeof fetch; urls: string[] } {
  const urls: string[] = []
  return {
    urls,
    fetch: (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      urls.push(url)
      return Promise.resolve(respond(url))
    },
  }
}

function options(fetcher: typeof fetch, extra: Partial<DownloadOptions> = {}): DownloadOptions {
  return {
    url: START,
    edictId: EDICT_ID,
    fileName: 'gutachten.pdf',
    documentsDir,
    fetch: fetcher,
    ...extra,
  }
}

function edictFiles(edictId = EDICT_ID): Promise<string[]> {
  return readdir(path.join(documentsDir, edictId)).catch(() => [])
}

describe('downloadDocument', () => {
  it('writes the file under the edict folder and returns its hash', async () => {
    const { fetch } = fakeFetch(
      () => new Response(PDF, { headers: { 'Content-Length': String(PDF.byteLength) } }),
    )
    const progress: number[] = []
    const result = await downloadDocument(
      options(fetch, { onProgress: (bytes) => progress.push(bytes.bytesDone) }),
    )
    expect(result).toMatchObject({
      localPath: `${EDICT_ID}/gutachten.pdf`,
      bytes: PDF.byteLength,
      sha256: createHash('sha256').update(PDF).digest('hex'),
      finalUrl: START,
    })
    expect(await readFile(result.absolutePath)).toEqual(Buffer.from(PDF))
    // The temporary file was renamed, not left behind.
    expect(await edictFiles()).toEqual(['gutachten.pdf'])
    expect(progress.at(-1)).toBe(PDF.byteLength)
  })

  it('follows a redirect on the same host', async () => {
    const target = 'https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/0/def/$file/neu.pdf'
    const { fetch, urls } = fakeFetch((url) =>
      url === START
        ? new Response(null, { status: 302, headers: { Location: target } })
        : new Response(PDF),
    )
    const result = await downloadDocument(options(fetch))
    expect(urls).toEqual([START, target])
    expect(result.finalUrl).toBe(target)
  })

  it('refuses a redirect to another host', async () => {
    const { fetch, urls } = fakeFetch(
      () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'https://example.com/edikte/gutachten.pdf' },
        }),
    )
    await expect(downloadDocument(options(fetch))).rejects.toMatchObject({ code: 'forbidden' })
    expect(urls).toHaveLength(1)
    expect(await edictFiles()).toEqual([])
  })

  it('refuses start addresses outside the document paths without fetching', async () => {
    const { fetch, urls } = fakeFetch(() => new Response(PDF))
    for (const url of [
      'http://edikte.justiz.gv.at/edikte/gutachten.pdf',
      'https://edikte.justiz.gv.at.example.com/edikte/gutachten.pdf',
      'https://edikte.justiz.gv.at:8443/edikte/gutachten.pdf',
      'https://user@edikte.justiz.gv.at/edikte/gutachten.pdf',
      'https://edikte.justiz.gv.at/other/gutachten.pdf',
    ]) {
      await expect(downloadDocument(options(fetch, { url }))).rejects.toMatchObject({
        code: 'forbidden',
      })
    }
    expect(urls).toEqual([])
  })

  // Catches a download that knows only the auction site: every document of an
  // insolvency sale would then end as forbidden.
  it('downloads a file of an insolvency record into the folder of that record', async () => {
    const { fetch, urls } = fakeFetch(() => new Response(PDF))
    const result = await downloadDocument(
      options(fetch, { url: INSOLVENCY_FILE, edictId: INSOLVENCY_EDICT_ID }),
    )
    expect(urls).toEqual([INSOLVENCY_FILE])
    expect(result).toMatchObject({
      localPath: `${INSOLVENCY_EDICT_ID}/gutachten.pdf`,
      absolutePath: path.join(documentsDir, INSOLVENCY_EDICT_ID, 'gutachten.pdf'),
      finalUrl: INSOLVENCY_FILE,
    })
    expect(await edictFiles(INSOLVENCY_EDICT_ID)).toEqual(['gutachten.pdf'])
  })

  // Catches a policy that accepts both sites for every edict, and one that
  // checks the host of a JustizOnline file without its record number. Either
  // would let a stored row fetch a file that belongs to another edict.
  it.each([
    {
      name: 'a JustizOnline file for an auction',
      url: INSOLVENCY_FILE,
      edictId: EDICT_ID,
    },
    {
      name: 'an auction document for an insolvency record',
      url: START,
      edictId: INSOLVENCY_EDICT_ID,
    },
    {
      name: 'a file of another insolvency record',
      url: 'https://justizonline.gv.at/jop/service/edi/v1/edikte/990002/resources/TVZfOTkwMDAy',
      edictId: INSOLVENCY_EDICT_ID,
    },
  ])('refuses $name without fetching', async ({ url, edictId }) => {
    const { fetch, urls } = fakeFetch(() => new Response(PDF))
    await expect(downloadDocument(options(fetch, { url, edictId }))).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(urls).toEqual([])
  })

  // Catches a redirect check that accepts either site whatever host the
  // download started on, and one that pins the host but lets the download
  // leave the API path for other pages of JustizOnline.
  it.each([
    { name: 'to the auction site', location: START },
    {
      name: 'out of the API path',
      location: 'https://justizonline.gv.at/jop/web/ediktsdatei/suche/990001',
    },
  ])('refuses a redirect of an insolvency file $name', async ({ location }) => {
    const { fetch, urls } = fakeFetch(
      () => new Response(null, { status: 302, headers: { Location: location } }),
    )
    await expect(
      downloadDocument(options(fetch, { url: INSOLVENCY_FILE, edictId: INSOLVENCY_EDICT_ID })),
    ).rejects.toMatchObject({ code: 'forbidden' })
    expect(urls).toEqual([INSOLVENCY_FILE])
    expect(await edictFiles(INSOLVENCY_EDICT_ID)).toEqual([])
  })

  it('stops at the size cap, announced or not', async () => {
    const large = new Uint8Array(4096)
    large.set(PDF)
    const announced = fakeFetch(
      () => new Response(large, { headers: { 'Content-Length': String(large.byteLength) } }),
    )
    await expect(
      downloadDocument(options(announced.fetch, { maxBytes: 1024 })),
    ).rejects.toMatchObject({ code: 'document_too_large' })

    const streamed = fakeFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(large.slice(0, 2048))
              controller.enqueue(large.slice(2048))
              controller.close()
            },
          }),
        ),
    )
    await expect(
      downloadDocument(options(streamed.fetch, { maxBytes: 1024 })),
    ).rejects.toMatchObject({ code: 'document_too_large' })
    expect(await edictFiles()).toEqual([])
  })

  it('cancels on abort and leaves no partial file', async () => {
    const controller = new AbortController()
    let chunks = 0
    const { fetch } = fakeFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(stream) {
              chunks += 1
              if (chunks === 2) controller.abort()
              stream.enqueue(chunks === 1 ? PDF : new Uint8Array(64 * 1024))
            },
          }),
        ),
    )
    await expect(
      downloadDocument(options(fetch, { signal: controller.signal })),
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(await edictFiles()).toEqual([])
  })

  it('gives up when the site stops sending data', async () => {
    const { fetch } = fakeFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(PDF)
            },
          }),
        ),
    )
    await expect(downloadDocument(options(fetch, { idleTimeoutMs: 50 }))).rejects.toMatchObject({
      code: 'timeout',
    })
    expect(await edictFiles()).toEqual([])
  })

  it('does not count the wait for the first answer as idle time', async () => {
    // As when the download waits in the client's queue behind another one.
    const queued: typeof fetch = () =>
      new Promise((resolve) => setTimeout(() => resolve(new Response(PDF)), 120))
    const done = await downloadDocument(options(queued, { idleTimeoutMs: 50 }))
    expect(done.bytes).toBe(PDF.byteLength)
  })

  it('keeps a slow but steady download going until the overall limit', async () => {
    const steady = (): Response => {
      let chunks = 0
      return new Response(
        new ReadableStream<Uint8Array>({
          async pull(stream) {
            await new Promise((resolve) => setTimeout(resolve, 20))
            chunks += 1
            if (chunks > 8) stream.close()
            else stream.enqueue(chunks === 1 ? PDF : new Uint8Array(1024))
          },
        }),
      )
    }
    const done = await downloadDocument(options(fakeFetch(steady).fetch, { idleTimeoutMs: 500 }))
    expect(done.bytes).toBe(PDF.byteLength + 7 * 1024)
    await expect(
      downloadDocument(options(fakeFetch(steady).fetch, { idleTimeoutMs: 500, maxDurationMs: 60 })),
    ).rejects.toMatchObject({ code: 'timeout', message: 'Download took longer than 0 s' })
    expect(await edictFiles()).toEqual([path.basename(done.absolutePath)])
  })

  it('rejects a response that is not a PDF', async () => {
    const { fetch } = fakeFetch(() => new Response('<html>Fehler</html>'))
    await expect(downloadDocument(options(fetch))).rejects.toMatchObject({
      code: 'document_unreadable',
    })
    expect(await edictFiles()).toEqual([])
  })

  it('reports a connection lost mid-download as a network error', async () => {
    let pulls = 0
    const { fetch } = fakeFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(stream) {
              pulls += 1
              if (pulls === 1) stream.enqueue(PDF)
              else stream.error(new TypeError('terminated'))
            },
          }),
        ),
    )
    await expect(downloadDocument(options(fetch))).rejects.toMatchObject({ code: 'network' })
    expect(await edictFiles()).toEqual([])
  })

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)(
    'reports a folder it cannot write to as storage_unavailable',
    async () => {
      await mkdir(path.join(documentsDir, EDICT_ID), { mode: 0o500 })
      const { fetch } = fakeFetch(() => new Response(PDF))
      await expect(downloadDocument(options(fetch))).rejects.toMatchObject({
        code: 'storage_unavailable',
      })
    },
  )

  it.each([
    { status: 404, code: 'not_found' },
    { status: 429, code: 'rate_limited' },
    { status: 503, code: 'site_unavailable' },
  ])('maps HTTP $status to $code', async ({ status, code }) => {
    const { fetch } = fakeFetch(() => new Response('Fehler', { status }))
    await expect(downloadDocument(options(fetch))).rejects.toMatchObject({ code })
  })

  it('keeps hostile file names inside the edict folder', async () => {
    const { fetch } = fakeFetch(() => new Response(PDF))
    for (const fileName of ['../../escape.pdf', '..\\..\\escape.pdf', '%2e%2e%2fescape.pdf']) {
      const result = await downloadDocument(options(fetch, { fileName }))
      expect(path.dirname(result.absolutePath)).toBe(path.join(documentsDir, EDICT_ID))
    }
    expect(await readdir(documentsDir)).toEqual([EDICT_ID])
    expect(await edictFiles()).toEqual(['escape.pdf'])
  })
})

describe('safePdfFileName', () => {
  it.each([
    { raw: '../../etc/passwd', name: 'passwd.pdf' },
    { raw: '..\\..\\Gutachten.PDF', name: 'Gutachten.pdf' },
    { raw: '%2e%2e%2fx.pdf', name: 'x.pdf' },
    { raw: '..', name: 'document.pdf' },
    { raw: 'CON.pdf', name: '_CON.pdf' },
    { raw: 'Gut\u0000achten‮.pdf', name: 'Gutachten.pdf' },
  ])('turns $raw into $name', ({ raw, name }) => {
    expect(safePdfFileName(raw)).toBe(name)
  })

  it('keeps long names within the file system limit', () => {
    const name = safePdfFileName(`${'ä'.repeat(300)}.pdf`)
    expect(Buffer.byteLength(name)).toBeLessThanOrEqual(150)
    expect(name.endsWith('ä.pdf')).toBe(true)
  })
})
