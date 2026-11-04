import { getDocumentProxy } from 'unpdf'
import { AppError } from '@shared/errors'
import { detectTextPages, layoutPage, type PageLayout, type TextRun } from './page-text'

// Runs in the utility process (extract-worker.ts). The main process must not
// import this module: it loads pdf.js and parses untrusted files.

export interface ExtractedPage {
  /** 1-based PDF page number. */
  pageNumber: number
  text: string
  /** False for scans and photo pages: too little text apart from headers and footers. */
  hasText: boolean
  /** Page label printed on the page, e.g. "Seite 42". */
  printedLabel: string | null
}

export interface ExtractedDocument {
  pageCount: number
  pages: ExtractedPage[]
}

export const MAX_EXTRACT_PAGES = 2000
/** Per-page cap; a real Gutachten page holds a few thousand characters. */
export const MAX_PAGE_TEXT = 100_000

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>

/**
 * Reads the text of every page with unpdf (pdf.js). PDFs encrypted with an
 * empty open password open like any other; password-protected and broken
 * files fail with `document_unreadable`.
 */
export async function extractPages(bytes: Uint8Array): Promise<ExtractedDocument> {
  let pdf: PdfDocument
  try {
    // pdf.js may transfer the buffer it gets, so it gets a plain copy
    // (Buffer.slice would share memory). pdf.js 6 has no eval code path left,
    // so there is no isEvalSupported switch to set.
    pdf = await getDocumentProxy(new Uint8Array(bytes), {
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      stopAtErrors: false,
      verbosity: 0,
    })
  } catch (error) {
    throw unreadable(error)
  }
  try {
    if (pdf.numPages > MAX_EXTRACT_PAGES) {
      throw new AppError('document_too_large', `The PDF has more than ${MAX_EXTRACT_PAGES} pages`)
    }
    const layouts: PageLayout[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      layouts.push(await readPage(pdf, pageNumber))
    }
    const hasText = detectTextPages(layouts.map((layout) => layout.rows.map((row) => row.text)))
    return {
      pageCount: pdf.numPages,
      pages: layouts.map((layout, index) => ({
        pageNumber: index + 1,
        text: layout.text.slice(0, MAX_PAGE_TEXT),
        hasText: hasText[index] ?? false,
        printedLabel: layout.printedLabel,
      })),
    }
  } finally {
    await pdf.loadingTask.destroy()
  }
}

async function readPage(pdf: PdfDocument, pageNumber: number): Promise<PageLayout> {
  try {
    const page = await pdf.getPage(pageNumber)
    try {
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const runs: TextRun[] = []
      for (const item of content.items) {
        if (!('str' in item) || item.str === '') continue
        // Page space after rotation and the y flip, so rows read top to bottom.
        const [a, b, c, d, e, f] = multiply(viewport.transform, item.transform)
        runs.push({
          text: item.str,
          x: e,
          y: f,
          width: item.width,
          size: Math.hypot(c, d) || item.height,
          horizontal: a > 0 && Math.abs(b) <= Math.abs(a) * 0.05,
        })
      }
      return layoutPage(runs, viewport.height)
    } finally {
      page.cleanup()
    }
  } catch {
    // One broken page should not cost the rest of the document.
    return { rows: [], text: '', printedLabel: null }
  }
}

type Matrix = [number, number, number, number, number, number]

function multiply(m1: readonly number[], m2: readonly number[]): Matrix {
  const [a1 = 1, b1 = 0, c1 = 0, d1 = 1, e1 = 0, f1 = 0] = m1
  const [a2 = 1, b2 = 0, c2 = 0, d2 = 1, e2 = 0, f2 = 0] = m2
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ]
}

function unreadable(error: unknown): AppError {
  if (error instanceof AppError) return error
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : null
  const message =
    name === 'PasswordException'
      ? 'The PDF is protected with a password'
      : 'The file is not a readable PDF'
  return new AppError('document_unreadable', message, { cause: error })
}
