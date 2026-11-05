import { describe, expect, it } from 'vitest'
import {
  runExtractWorker,
  type ExtractRequest,
  type ExtractWorkerProcess,
} from '../../src/main/documents/extract-protocol'
import { RasterCollector } from '../../src/main/documents/raster-protocol'

type Respond = (request: ExtractRequest, worker: FakeWorker) => void

class FakeWorker implements ExtractWorkerProcess {
  readonly sent: ExtractRequest[] = []
  killed = false
  readonly #respond: Respond
  readonly #messageListeners: ((message: unknown) => void)[] = []
  readonly #exitListeners: ((code: number) => void)[] = []

  constructor(respond: Respond = () => undefined) {
    this.#respond = respond
  }

  postMessage(message: ExtractRequest): void {
    this.sent.push(message)
    // Replies arrive later, as from a real process.
    setTimeout(() => this.#respond(message, this), 0)
  }

  onMessage(listener: (message: unknown) => void): void {
    this.#messageListeners.push(listener)
  }

  onExit(listener: (code: number) => void): void {
    this.#exitListeners.push(listener)
  }

  kill(): void {
    this.killed = true
  }

  reply(message: unknown): void {
    for (const listener of this.#messageListeners) listener(message)
  }

  exit(code: number): void {
    for (const listener of this.#exitListeners) listener(code)
  }
}

const DOCUMENT = {
  pageCount: 1,
  pages: [{ pageNumber: 1, text: 'Nutzfläche 50 m²', hasText: true, printedLabel: null }],
}

describe('runExtractWorker', () => {
  it('resolves with the validated document and stops the worker', async () => {
    const worker = new FakeWorker((request, self) => {
      self.reply({ id: request.id, ok: true, document: DOCUMENT })
    })
    await expect(runExtractWorker(() => worker, '/docs/a.pdf')).resolves.toEqual(DOCUMENT)
    expect(worker.sent[0]).toMatchObject({ filePath: '/docs/a.pdf' })
    expect(worker.killed).toBe(true)
  })

  it.each([
    {
      name: 'a reply to another request',
      reply: (id: string) => ({ id: `${id}-other`, ok: true, document: DOCUMENT }),
    },
    {
      name: 'a page count that does not match',
      reply: (id: string) => ({ id, ok: true, document: { ...DOCUMENT, pageCount: 2 } }),
    },
    {
      name: 'an unknown error code',
      reply: (id: string) => ({ id, ok: false, code: 'forbidden', message: 'No' }),
    },
  ])('treats $name as a broken reply', async ({ reply }) => {
    const worker = new FakeWorker((request, self) => {
      self.reply(reply(request.id))
    })
    await expect(runExtractWorker(() => worker, '/docs/a.pdf')).rejects.toMatchObject({
      code: 'internal',
    })
    expect(worker.killed).toBe(true)
  })

  it('passes on the error code the worker reports', async () => {
    const worker = new FakeWorker((request, self) => {
      self.reply({ id: request.id, ok: false, code: 'document_unreadable', message: 'Locked' })
    })
    await expect(runExtractWorker(() => worker, '/docs/a.pdf')).rejects.toMatchObject({
      code: 'document_unreadable',
    })
  })

  it('reports a worker that exits without replying', async () => {
    const worker = new FakeWorker((_request, self) => {
      self.exit(1)
    })
    await expect(runExtractWorker(() => worker, '/docs/a.pdf')).rejects.toMatchObject({
      code: 'document_unreadable',
    })
  })

  it('kills the worker on timeout and on cancel', async () => {
    const silent = new FakeWorker()
    await expect(
      runExtractWorker(() => silent, '/docs/a.pdf', { timeoutMs: 10 }),
    ).rejects.toMatchObject({ code: 'timeout' })
    expect(silent.killed).toBe(true)

    const controller = new AbortController()
    const cancelled = new FakeWorker(() => {
      controller.abort()
    })
    await expect(
      runExtractWorker(() => cancelled, '/docs/a.pdf', { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'cancelled' })
    expect(cancelled.killed).toBe(true)
  })
})

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

function thrown(action: () => unknown): unknown {
  try {
    action()
  } catch (error) {
    return error
  }
  return undefined
}

describe('RasterCollector', () => {
  it('returns rendered pages in the requested order and lists the missing ones', () => {
    const collector = new RasterCollector({ pages: [4, 2, 9], maxSide: 1600 })
    collector.acceptPage({ page: 2, jpeg: JPEG, width: 1131, height: 1600 })
    collector.acceptPage({ page: 4, jpeg: JPEG, width: 1600, height: 1131 })
    const result = collector.finish({ failed: [{ page: 9, reason: 'No such page' }], error: null })
    expect(result.images.map((image) => image.page)).toEqual([4, 2])
    expect(result.images[0]).toMatchObject({ type: 'image', mediaType: 'image/jpeg' })
    expect(result.failedPages).toEqual([9])
  })

  it.each([
    { name: 'an unrequested page', payload: { page: 5, jpeg: JPEG, width: 100, height: 100 } },
    { name: 'an oversized page', payload: { page: 2, jpeg: JPEG, width: 3000, height: 100 } },
    {
      name: 'bytes that are not JPEG',
      payload: { page: 2, jpeg: new Uint8Array([0x89, 0x50]), width: 100, height: 100 },
    },
    {
      name: 'a malformed payload',
      payload: { page: 2, jpeg: 'not bytes', width: 100, height: 100 },
    },
  ])('refuses $name', ({ payload }) => {
    const collector = new RasterCollector({ pages: [2], maxSide: 1600 })
    expect(thrown(() => collector.acceptPage(payload))).toMatchObject({ code: 'internal' })
  })

  it('fails as unreadable when the renderer could not open the PDF', () => {
    const collector = new RasterCollector({ pages: [1], maxSide: 1600 })
    expect(thrown(() => collector.finish({ failed: [], error: 'Invalid PDF' }))).toMatchObject({
      code: 'document_unreadable',
    })
  })
})
