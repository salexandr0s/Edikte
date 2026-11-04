import { z } from 'zod'
import { AppError } from '@shared/errors'
import type { AnalysisContentPart } from '../ai/provider'
import type { RasterJob } from './raster-channels'

// Validation of what the raster window sends back. Electron-free, so it can be
// tested in Node; raster.ts wires it to the window.

export const MAX_RASTER_PAGES = 12
export const DEFAULT_RASTER_SIDE = 1600
export const DEFAULT_JPEG_QUALITY = 0.85
const MAX_JPEG_BYTES = 8 * 1024 * 1024

/** The image part analysis sends to vision models. */
export type RasterImage = Extract<AnalysisContentPart, { type: 'image' }>

export interface RasterResult {
  /** In the requested order. */
  images: RasterImage[]
  /** Requested pages that came back without an image. */
  failedPages: number[]
}

/** Positive, unique page numbers in the given order, at most 12. */
export function chooseRasterPages(pages: readonly number[], max = MAX_RASTER_PAGES): number[] {
  return [...new Set(pages.filter((page) => Number.isInteger(page) && page >= 1))].slice(0, max)
}

const PagePayloadSchema = z
  .object({
    page: z.number().int().positive(),
    jpeg: z.instanceof(Uint8Array),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict()

const DonePayloadSchema = z
  .object({
    failed: z
      .array(z.object({ page: z.number().int().positive(), reason: z.string().max(500) }).strict())
      .max(MAX_RASTER_PAGES),
    error: z.string().max(500).nullable(),
  })
  .strict()

export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
}

/** Collects the pages a raster window sends and rejects anything not asked for. */
export class RasterCollector {
  readonly #pages: readonly number[]
  readonly #maxSide: number
  readonly #images = new Map<number, RasterImage>()

  constructor(job: Pick<RasterJob, 'pages' | 'maxSide'>) {
    this.#pages = job.pages
    this.#maxSide = job.maxSide
  }

  acceptPage(payload: unknown): void {
    const parsed = PagePayloadSchema.safeParse(payload)
    if (!parsed.success) throw invalid('a malformed page')
    const { page, jpeg, width, height } = parsed.data
    if (!this.#pages.includes(page) || this.#images.has(page)) throw invalid('an unexpected page')
    // One pixel of slack for rounding of the scaled viewport.
    if (Math.max(width, height) > this.#maxSide + 1) throw invalid('an oversized page')
    if (jpeg.byteLength > MAX_JPEG_BYTES || !isJpeg(jpeg)) throw invalid('an invalid image')
    this.#images.set(page, {
      type: 'image',
      mediaType: 'image/jpeg',
      data: Buffer.from(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength),
      page,
    })
  }

  finish(payload: unknown): RasterResult {
    const parsed = DonePayloadSchema.safeParse(payload)
    if (!parsed.success) throw invalid('a malformed result')
    if (parsed.data.error !== null) {
      throw new AppError('document_unreadable', 'The PDF could not be opened for rendering')
    }
    const images: RasterImage[] = []
    const failedPages: number[] = []
    for (const page of this.#pages) {
      const image = this.#images.get(page)
      if (image === undefined) failedPages.push(page)
      else images.push(image)
    }
    return { images, failedPages }
  }
}

function invalid(what: string): AppError {
  return new AppError('internal', `The PDF renderer sent ${what}`)
}
