import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { ExtractedDocument } from './extract'
import { DEFAULT_MAX_DOCUMENT_BYTES } from './download'

// Messages between the main process and the PDF text worker, and the host
// logic around one worker run. Electron-free, so it can be tested in Node.

export const EXTRACT_TIMEOUT_MS = 120_000

export const ExtractRequestSchema = z
  .object({
    id: z.string().min(1),
    filePath: z.string().min(1),
    maxBytes: z.number().int().positive(),
  })
  .strict()
export type ExtractRequest = z.infer<typeof ExtractRequestSchema>

const ExtractedPageSchema = z
  .object({
    pageNumber: z.number().int().positive(),
    text: z.string().max(100_000),
    hasText: z.boolean(),
    printedLabel: z.string().max(40).nullable(),
  })
  .strict()

export const ExtractedDocumentSchema = z
  .object({
    pageCount: z.number().int().nonnegative(),
    pages: z.array(ExtractedPageSchema),
  })
  .strict()
  .refine(
    (document) =>
      document.pages.length === document.pageCount &&
      document.pages.every((page, index) => page.pageNumber === index + 1),
    { message: 'Pages must be numbered 1 to pageCount' },
  )

/** Error codes the worker may report; anything else is treated as a broken reply. */
export const ExtractErrorCodeSchema = z.enum([
  'document_unreadable',
  'document_too_large',
  'not_found',
  'internal',
])

export const ExtractReplySchema = z.discriminatedUnion('ok', [
  z.object({ id: z.string(), ok: z.literal(true), document: ExtractedDocumentSchema }).strict(),
  z
    .object({
      id: z.string(),
      ok: z.literal(false),
      code: ExtractErrorCodeSchema,
      message: z.string().max(500),
    })
    .strict(),
])
export type ExtractReply = z.input<typeof ExtractReplySchema>

/** The parts of an Electron UtilityProcess one run needs. */
export interface ExtractWorkerProcess {
  postMessage(message: ExtractRequest): void
  onMessage(listener: (message: unknown) => void): void
  onExit(listener: (code: number) => void): void
  kill(): void
}

export interface ExtractRunOptions {
  signal?: AbortSignal
  timeoutMs?: number
  maxBytes?: number
}

/**
 * Starts one worker, sends it the file path, validates the reply and kills the
 * worker afterwards, also on timeout, abort or a broken reply.
 */
export function runExtractWorker(
  spawn: () => ExtractWorkerProcess,
  filePath: string,
  options: ExtractRunOptions = {},
): Promise<ExtractedDocument> {
  const { signal } = options
  if (signal?.aborted) return Promise.reject(new AppError('cancelled', 'Reading cancelled'))
  return new Promise<ExtractedDocument>((resolve, reject) => {
    const id = randomUUID()
    let worker: ExtractWorkerProcess
    try {
      worker = spawn()
    } catch (error) {
      reject(new AppError('internal', 'The PDF reader could not be started', { cause: error }))
      return
    }
    let settled = false
    const settle = (outcome: { document: ExtractedDocument } | { error: AppError }): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      worker.kill()
      if ('document' in outcome) resolve(outcome.document)
      else reject(outcome.error)
    }
    const onAbort = (): void => settle({ error: new AppError('cancelled', 'Reading cancelled') })
    const timeoutMs = options.timeoutMs ?? EXTRACT_TIMEOUT_MS
    const timer = setTimeout(() => {
      settle({ error: new AppError('timeout', 'Reading the PDF took too long') })
    }, timeoutMs)
    signal?.addEventListener('abort', onAbort, { once: true })

    worker.onMessage((message) => {
      const reply = ExtractReplySchema.safeParse(message)
      if (!reply.success || reply.data.id !== id) {
        settle({ error: new AppError('internal', 'The PDF reader sent an invalid reply') })
      } else if (reply.data.ok) {
        settle({ document: reply.data.document })
      } else {
        settle({ error: new AppError(reply.data.code, reply.data.message) })
      }
    })
    worker.onExit((code) => {
      settle({
        error: new AppError('document_unreadable', `The PDF reader stopped (exit code ${code})`),
      })
    })
    worker.postMessage({ id, filePath, maxBytes: options.maxBytes ?? DEFAULT_MAX_DOCUMENT_BYTES })
  })
}
