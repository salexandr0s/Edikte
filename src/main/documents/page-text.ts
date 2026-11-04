// Layout helpers for extracted PDF text. Pure functions, so they can be tested
// without pdf.js.

/** A run of text with its baseline in page space: origin top left, y downwards. */
export interface TextRun {
  text: string
  x: number
  y: number
  /** Length along the baseline. */
  width: number
  /** Font size in page units. */
  size: number
  /** False for rotated or vertical text. */
  horizontal: boolean
}

export interface TextRow {
  y: number
  text: string
}

export interface PageLayout {
  /** Horizontal rows from top to bottom. */
  rows: TextRow[]
  /** Rows joined by newlines, followed by any rotated text. */
  text: string
  printedLabel: string | null
}

/** Gap, in ems, above which two runs on one row are separate words. */
const WORD_GAP_EM = 0.15
/** Top and bottom share of the page searched for a printed page label. */
const LABEL_ZONE = 0.12
const SEITE_LABEL = /\bSeite\s+\d{1,4}(?:\s*(?:von|\/)\s*\d{1,4})?(?!\d)/i
const DASH_LABEL = /^[-–—]\s*\d{1,4}\s*[-–—]$/

/** Real characters a page needs, apart from repeated headers and footers, to count as text. */
export const MIN_TEXT_CHARS = 120
/** A row on at least this share of pages (and at least 3) is a header or footer. */
const REPEATED_ROW_SHARE = 0.2

/**
 * Groups runs into rows by baseline and orders them left to right, so table
 * rows read as one line ("Nutzfläche Top 24: 65,76 m²") even when the PDF
 * draws the labels and the values in separate passes.
 */
export function layoutPage(runs: readonly TextRun[], pageHeight: number): PageLayout {
  const visible = runs.filter((run) => run.text.trim() !== '')
  const sorted = visible.filter((run) => run.horizontal).sort((a, b) => a.y - b.y || a.x - b.x)
  const groups: { y: number; size: number; runs: TextRun[] }[] = []
  for (const run of sorted) {
    const last = groups.at(-1)
    // Half a font size keeps superscripts such as the "2" of "m2" on their row.
    if (
      last !== undefined &&
      Math.abs(run.y - last.y) <= Math.max(1, 0.5 * Math.min(last.size, run.size))
    ) {
      last.runs.push(run)
    } else {
      groups.push({ y: run.y, size: run.size, runs: [run] })
    }
  }
  const rows = groups
    .map((group) => ({ y: group.y, text: joinRow(group.runs) }))
    .filter((row) => row.text !== '')
  const rotated = visible
    .filter((run) => !run.horizontal)
    .map((run) => run.text.replace(/\s+/g, ' ').trim())
  return {
    rows,
    text: [...rows.map((row) => row.text), ...rotated].join('\n'),
    printedLabel: findPrintedLabel(rows, pageHeight),
  }
}

function joinRow(runs: TextRun[]): string {
  let text = ''
  let end = Number.NEGATIVE_INFINITY
  for (const run of [...runs].sort((a, b) => a.x - b.x)) {
    if (text !== '' && run.x - end > run.size * WORD_GAP_EM && !/\s$/.test(text)) text += ' '
    text += run.text
    end = Math.max(end, run.x + run.width)
  }
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * The page number printed in the header or footer ("Seite 42", "Seite 8 von 18",
 * "- 42 -"). Only the top and bottom of the page are searched, so references in
 * the body ("siehe Seite 12") are not taken for labels.
 */
export function findPrintedLabel(rows: readonly TextRow[], pageHeight: number): string | null {
  const zone = rows
    .filter((row) => row.y <= pageHeight * LABEL_ZONE || row.y >= pageHeight * (1 - LABEL_ZONE))
    // Footers first: most reports number their pages at the bottom.
    .sort((a, b) => b.y - a.y)
  for (const row of zone) {
    const seite = SEITE_LABEL.exec(row.text)
    if (seite !== null) return seite[0].replace(/\s+/g, ' ')
    if (DASH_LABEL.test(row.text)) return row.text.replace(/\s+/g, ' ')
  }
  return null
}

export function realCharCount(text: string): number {
  return text.match(/[\p{L}\p{N}]/gu)?.length ?? 0
}

/**
 * Flags the pages that carry enough text of their own. Rows that repeat across
 * the document (headers, footers, the expert's letterhead) are not counted, so
 * a scan or photo page with a printed header still counts as having no text.
 */
export function detectTextPages(pages: readonly (readonly string[])[]): boolean[] {
  const pagesWithRow = new Map<string, number>()
  for (const rows of pages) {
    for (const signature of new Set(rows.map(rowSignature))) {
      pagesWithRow.set(signature, (pagesWithRow.get(signature) ?? 0) + 1)
    }
  }
  const repeated = Math.max(3, Math.ceil(pages.length * REPEATED_ROW_SHARE))
  return pages.map((rows) => {
    let chars = 0
    for (const row of rows) {
      if ((pagesWithRow.get(rowSignature(row)) ?? 0) < repeated) chars += realCharCount(row)
    }
    return chars >= MIN_TEXT_CHARS
  })
}

function rowSignature(row: string): string {
  return row.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim()
}
