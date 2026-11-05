import { useId, type ReactNode } from 'react'
import type { AnalysisRecord } from '@shared/analysis-schema'
import { evidenceStatus } from '../detail-helpers'
import { GermanQuote } from '../fact-list'
import { PageLink } from '../page-link'
import { EvidenceBadge } from './evidence-badge'

/** The run and the PDF that page links and evidence badges refer to. */
export interface ResultSource {
  record: AnalysisRecord
  /** The Langgutachten the analysis read, when the listing has one. */
  documentId: number | null
}

export function ResultSection({ title, children }: { title: ReactNode; children: ReactNode }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-base font-semibold">
        {title}
      </h3>
      {children}
    </section>
  )
}

interface SourceLineProps {
  source: ResultSource
  /** Evidence path into the result, e.g. "risks.2". */
  path: string
  page: number | null
  quote: string | null
}

/** Page link, evidence badge and German quote of one value in the result. */
export function SourceLine({ source, path, page, quote }: SourceLineProps) {
  const status = evidenceStatus(source.record, path)
  if (page === null && quote === null && status === null) return null
  return (
    <div className="flex flex-col gap-1.5">
      {(page !== null || status !== null) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <PageLink documentId={source.documentId} page={page} />
          {status !== null && <EvidenceBadge status={status} />}
        </div>
      )}
      {quote !== null && <GermanQuote text={quote} />}
    </div>
  )
}
