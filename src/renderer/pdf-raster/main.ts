import { getDocument } from 'pdfjs-dist'
import * as pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs'
import type {
  PdfRasterApi,
  RasterFailure,
  RasterJob,
  RasterPageResult,
} from '@shared/raster-channels'

// Hidden window that renders scanned Gutachten pages to JPEG with pdf.js.
// pdf.js runs its parser on this page's thread through its main-thread worker
// hook, so no worker script has to load under the page's CSP.
Object.assign(globalThis, { pdfjsWorker })

declare global {
  interface Window {
    pdfRaster: PdfRasterApi
  }
}

type PdfDocument = Awaited<ReturnType<typeof getDocument>['promise']>

void run(window.pdfRaster)

async function run(api: PdfRasterApi): Promise<void> {
  let job: RasterJob
  let pdf: PdfDocument
  try {
    job = readJob(await api.getJob())
    // pdf.js 6 removed isEvalSupported together with its last eval code path.
    pdf = await getDocument({
      data: job.pdf,
      enableXfa: false,
      stopAtErrors: false,
      verbosity: 0,
    }).promise
  } catch (error) {
    await api.finish({ failed: [], error: describe(error) })
    return
  }
  const failed: RasterFailure[] = []
  for (const pageNumber of job.pages) {
    try {
      await api.sendPage(await renderPage(pdf, pageNumber, job))
    } catch (error) {
      failed.push({ page: pageNumber, reason: describe(error) })
    }
  }
  await pdf.loadingTask.destroy()
  await api.finish({ failed, error: null })
}

async function renderPage(
  pdf: PdfDocument,
  pageNumber: number,
  job: RasterJob,
): Promise<RasterPageResult> {
  if (pageNumber > pdf.numPages) throw new Error('The PDF has no such page')
  const page = await pdf.getPage(pageNumber)
  const canvas = document.createElement('canvas')
  try {
    const natural = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({
      scale: job.maxSide / Math.max(natural.width, natural.height),
    })
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    // JPEG has no transparency; scans and photos read best on white.
    await page.render({ canvas, viewport, background: 'white' }).promise
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, 'image/jpeg', job.quality)
    })
    if (blob === null) throw new Error('JPEG encoding failed')
    return {
      page: pageNumber,
      jpeg: new Uint8Array(await blob.arrayBuffer()),
      width: canvas.width,
      height: canvas.height,
    }
  } finally {
    canvas.width = 0
    canvas.height = 0
    page.cleanup()
  }
}

function readJob(value: unknown): RasterJob {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid job')
  const { pdf, pages, maxSide, quality } = value as Partial<Record<keyof RasterJob, unknown>>
  if (
    !(pdf instanceof Uint8Array) ||
    !Array.isArray(pages) ||
    !pages.every((page) => Number.isInteger(page) && (page as number) > 0) ||
    typeof maxSide !== 'number' ||
    typeof quality !== 'number'
  ) {
    throw new Error('Invalid job')
  }
  return { pdf, pages: pages as number[], maxSide, quality }
}

function describe(error: unknown): string {
  return (error instanceof Error ? error.message : 'Unknown error').slice(0, 300)
}
