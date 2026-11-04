import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DocumentProgress } from '@shared/domain'
import { AppError } from '@shared/errors'
import type { ExtractedDocument } from '../../src/main/documents/extract'
import { planFill, runFill, type FillCandidate } from '../../src/main/documents/fill'
import type { DocumentStore, PipelineDeps } from '../../src/main/documents/pipeline'

const ID = '0123456789abcdef0123456789abcdef'

function candidate(id: number, stored: boolean, statedSizeKb: number | null = 100): FillCandidate {
  return {
    edictId: ID,
    propertyType: 'apartment',
    document: {
      id,
      url: `https://edikte.justiz.gv.at/edikte/ex/${id}.pdf`,
      fileName: `${id}.pdf`,
      statedSizeKb,
      localPath: stored ? `${ID}/${id}.pdf` : null,
    },
  }
}

function store(overrides: Partial<DocumentStore> = {}): DocumentStore {
  return {
    recordDownload: () => undefined,
    recordPages: () => undefined,
    recordExtractError: () => undefined,
    replaceEstimates: () => undefined,
    ...overrides,
  }
}

const AREA_PAGE: ExtractedDocument = {
  pageCount: 1,
  pages: [
    { pageNumber: 1, text: 'Nutzfläche Wohnung: 70,00 m²', hasText: true, printedLabel: null },
  ],
}

describe('planFill', () => {
  it('counts listings, and downloads only for documents not on disk', () => {
    const plan = planFill([
      candidate(1, false, 300),
      candidate(2, true),
      candidate(3, false, null),
      { edictId: ID, propertyType: 'house', document: null },
    ])
    expect(plan).toEqual({ listings: 4, documents: 2, totalKb: 300 })
  })
})

describe('runFill', () => {
  let documentsDir: string
  const queue = [candidate(1, true), candidate(2, true), candidate(3, true)]

  beforeEach(async () => {
    documentsDir = await mkdtemp(path.join(tmpdir(), 'edikte-fill-'))
    await mkdir(path.join(documentsDir, ID))
    for (const id of [1, 2, 3]) await writeFile(path.join(documentsDir, ID, `${id}.pdf`), '%PDF-')
  })

  afterEach(async () => {
    await rm(documentsDir, { recursive: true, force: true })
  })

  it('records a failing document and continues with the next', async () => {
    const deps: PipelineDeps = {
      documentsDir,
      store: store(),
      extract: (file) =>
        file.endsWith('2.pdf')
          ? Promise.reject(new AppError('document_unreadable', 'Broken'))
          : Promise.resolve(AREA_PAGE),
    }
    const progress: DocumentProgress[] = []
    const outcome = await runFill(queue, deps, {
      signal: new AbortController().signal,
      onProgress: (event) => progress.push(event),
    })
    expect(outcome).toEqual({
      status: 'done',
      processed: 2,
      estimated: 2,
      failures: [{ documentId: 2, code: 'document_unreadable' }],
    })
    expect(progress.at(-1)).toMatchObject({ job: 'fill', phase: 'done', done: 3, total: 3 })
  })

  it('stops the run when the documents folder cannot be written', async () => {
    const deps: PipelineDeps = {
      documentsDir,
      store: store({
        recordPages: () => {
          throw new AppError('storage_unavailable', 'Disk full')
        },
      }),
      extract: () => Promise.resolve(AREA_PAGE),
    }
    const outcome = await runFill(queue, deps, { signal: new AbortController().signal })
    expect(outcome).toEqual({
      status: 'failed',
      processed: 0,
      estimated: 0,
      failures: [{ documentId: 1, code: 'storage_unavailable' }],
    })
  })

  it('starts no further document after cancel', async () => {
    const controller = new AbortController()
    const extracted: string[] = []
    const deps: PipelineDeps = {
      documentsDir,
      store: store(),
      extract: (file) => {
        extracted.push(file)
        controller.abort()
        return Promise.resolve(AREA_PAGE)
      },
    }
    const outcome = await runFill(queue, deps, { signal: controller.signal })
    expect(outcome.status).toBe('cancelled')
    expect(extracted).toHaveLength(1)
  })
})
