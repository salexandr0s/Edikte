import type { AnalysisPage } from './types'

/** Page text per analysis, in characters: about 100,000 to 130,000 tokens of German text. */
export const TEXT_CHAR_LIMIT = 400_000
/** Scanned pages sent as images per analysis. */
export const MAX_IMAGES = 12

// Pages with less text than this are mostly pictures: photos, plans, scanned extracts.
const SPARSE_PAGE_CHARS = 400
// A line printed on this share of pages, and on at least 3, is a running header or footer.
const RUNNING_LINE_SHARE = 0.3
const RUNNING_LINE_MIN_PAGES = 3
// Appendix headings are looked for in the first lines below the running header.
const HEADING_LINES = 4
const HEADING_MAX_CHARS = 80

const NUMBERING = String.raw`^(?:\d+(?:\.\d+)*\.?\s*)?`
// Opens the appendix: "Beilage 1", "Anlage./I", "7. Anlage", "Fotodokumentation".
// From the first one in the second half of the report on, every page is appendix.
const SECTION_HEADING = new RegExp(
  `${NUMBERING}(?:anhang|anhänge|anlagen?|beilagensammlung|beilagen?|fotodokumentation|bilddokumentation|lichtbilder)(?:$|[\\s./:]+(?:[a-z]|[ivx]+|\\d+)\\b)`,
  'i',
)
// Marks a single page that may also sit in the body, such as an inserted land register extract.
const PAGE_HEADING = new RegExp(
  `${NUMBERING}(?:fotos?|grundbuchs?auszug|grundrisse?|grundrisspläne|pläne|lageplan|katasterplan|einreichpläne?|bestandspläne?|energieausweis)\\b`,
  'i',
)
const PAGE_LABEL = /^seite\s+\d+(?:\s+von\s+\d+)?$/i
// Table of contents lines: "6. Fotodokumentation..........60".
const DOT_LEADER = /\.{4,}/

export interface PagePlanOptions {
  imagesSupported: boolean
  textCharLimit?: number
  maxImages?: number
}

export interface PagePlan {
  /** Highest PDF page number. */
  pageCount: number
  /** Pages with any text that go into the prompt, in page order. */
  textPages: AnalysisPage[]
  /** Scanned pages to send as images, in page order. */
  imagePages: number[]
  /** Scanned pages that cannot be sent as images. */
  unreadPages: number[]
  /** Text pages left out because the text was over the limit. */
  droppedPages: number[]
  appendixPages: number[]
  /** Characters of page text in the prompt. */
  textChars: number
}

/**
 * Decides what goes into the prompt. Over the text limit, appendix pages go
 * first, last page first; then body pages from the middle outward, so the
 * opening (object, areas) and the end (value, encumbrances) stay longest.
 * Scanned body pages get images before scanned appendix pages.
 */
export function planPages(pages: readonly AnalysisPage[], options: PagePlanOptions): PagePlan {
  const sorted = sortPages(pages)
  const appendix = detectAppendixPages(sorted)
  const limit = options.textCharLimit ?? TEXT_CHAR_LIMIT
  const maxImages = options.imagesSupported ? (options.maxImages ?? MAX_IMAGES) : 0

  // Pages without enough text of their own are scans, photos or plans, rendered
  // when the model takes images. The few lines such a page may carry (a caption,
  // a signature) still go into the prompt with the other text.
  const scanned = sorted.filter((page) => !page.hasText).map((page) => page.pageNumber)
  const imagePages = [
    ...scanned.filter((pageNumber) => !appendix.has(pageNumber)),
    ...scanned.filter((pageNumber) => appendix.has(pageNumber)),
  ]
    .slice(0, maxImages)
    .sort(byNumber)
  const unreadPages = scanned.filter((pageNumber) => !imagePages.includes(pageNumber))

  const withText = sorted.filter((page) => pageChars(page) > 0)
  let textChars = withText.reduce((total, page) => total + pageChars(page), 0)
  const dropped = new Set<number>()
  for (const page of dropOrder(withText, appendix)) {
    if (textChars <= limit) break
    dropped.add(page.pageNumber)
    textChars -= pageChars(page)
  }

  return {
    pageCount: sorted.at(-1)?.pageNumber ?? 0,
    textPages: withText.filter((page) => !dropped.has(page.pageNumber)),
    imagePages,
    unreadPages,
    droppedPages: [...dropped].sort(byNumber),
    appendixPages: [...appendix].sort(byNumber),
    textChars,
  }
}

/** Characters a page adds to the prompt. */
export function pageChars(page: AnalysisPage): number {
  return page.text.trim().length
}

/**
 * Appendix pages, found from the page text: headings such as Beilage, Anlage,
 * Anhang or Fotodokumentation, single pages headed Grundbuchsauszug, Grundriss
 * or Energieausweis, and the block of photos, plans and scans at the end.
 */
export function detectAppendixPages(pages: readonly AnalysisPage[]): Set<number> {
  const sorted = sortPages(pages)
  const running = runningLines(sorted)
  const lastPage = sorted.at(-1)?.pageNumber ?? 0
  const appendix = new Set<number>()
  let sectionStart: number | null = null
  for (const page of sorted) {
    const heading = headingKind(page, running)
    if (heading === null) continue
    appendix.add(page.pageNumber)
    if (heading === 'section' && sectionStart === null && page.pageNumber > lastPage / 2) {
      sectionStart = page.pageNumber
    }
  }
  for (const page of sorted) {
    if (sectionStart !== null && page.pageNumber >= sectionStart) appendix.add(page.pageNumber)
  }
  // Sparse pages at the end belong to the appendix even without a heading, as
  // long as a page with real text comes before them.
  const trailing: number[] = []
  for (const page of [...sorted].reverse()) {
    if (!appendix.has(page.pageNumber) && !isSparse(page, running)) {
      for (const pageNumber of trailing) appendix.add(pageNumber)
      break
    }
    trailing.push(page.pageNumber)
  }
  return appendix
}

function dropOrder(pages: readonly AnalysisPage[], appendix: ReadonlySet<number>): AnalysisPage[] {
  const appendixPages = pages.filter((page) => appendix.has(page.pageNumber)).reverse()
  const body = pages.filter((page) => !appendix.has(page.pageNumber))
  const middle = (body.length - 1) / 2
  const fromMiddle = body
    .map((page, index) => ({ page, index, distance: Math.abs(index - middle) }))
    .sort((a, b) => a.distance - b.distance || b.index - a.index)
    .map(({ page }) => page)
  return [...appendixPages, ...fromMiddle]
}

function headingKind(page: AnalysisPage, running: ReadonlySet<string>): 'section' | 'page' | null {
  if (!page.hasText) return null
  const top = contentLines(page, running)
    .slice(0, HEADING_LINES)
    .filter((line) => line.length <= HEADING_MAX_CHARS && !DOT_LEADER.test(line))
  if (top.some((line) => SECTION_HEADING.test(line))) return 'section'
  if (top.some((line) => PAGE_HEADING.test(line))) return 'page'
  return null
}

function isSparse(page: AnalysisPage, running: ReadonlySet<string>): boolean {
  return !page.hasText || contentLines(page, running).join('\n').length < SPARSE_PAGE_CHARS
}

function contentLines(page: AnalysisPage, running: ReadonlySet<string>): string[] {
  return page.text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !running.has(line) && !PAGE_LABEL.test(line))
}

function runningLines(pages: readonly AnalysisPage[]): Set<string> {
  const counts = new Map<string, number>()
  for (const page of pages) {
    for (const line of new Set(page.text.split(/\r?\n/).map((text) => text.trim()))) {
      if (line !== '') counts.set(line, (counts.get(line) ?? 0) + 1)
    }
  }
  const threshold = Math.max(RUNNING_LINE_MIN_PAGES, Math.ceil(pages.length * RUNNING_LINE_SHARE))
  return new Set([...counts].filter(([, count]) => count >= threshold).map(([line]) => line))
}

function sortPages(pages: readonly AnalysisPage[]): AnalysisPage[] {
  return [...pages].sort((a, b) => a.pageNumber - b.pageNumber)
}

function byNumber(a: number, b: number): number {
  return a - b
}
