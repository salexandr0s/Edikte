import type { EdictSource, PropertyType } from '@shared/enums'

/** One page of a downloaded Gutachten, as stored in `document_pages`. */
export interface AnalysisPage {
  /** 1-based PDF page number. */
  pageNumber: number
  /** Label printed on the page, e.g. "Seite 42", when one was found. */
  printedLabel: string | null
  /** False for pages without a text layer, usually scans. */
  hasText: boolean
  text: string
}

/**
 * Facts from the edict page that the prompt and the cross-checks use. A row of
 * the `edicts` table has these fields under the same names.
 */
export interface EdictFacts {
  /** Decides which rules the prompt carries and how it names the published value. */
  source: EdictSource
  categoryLabel: string | null
  propertyType: PropertyType
  street: string | null
  plz: string | null
  city: string | null
  schaetzwertEur: number | null
  /** Objektgröße in m². */
  objektgroesseSqm: number | null
}

/** A scanned page rendered to JPEG for a model that accepts images. */
export interface RenderedPage {
  page: number
  data: Buffer
}

/** Renders PDF pages to JPEG. Pages missing from the result count as unread. */
export type RenderPages = (pages: readonly number[], signal: AbortSignal) => Promise<RenderedPage[]>
