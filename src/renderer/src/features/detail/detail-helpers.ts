import type { AnalysisRecord, AnalysisResult, EvidenceStatus } from '@shared/analysis-schema'
import { AREA_MISMATCH_THRESHOLD, usableAreaKinds } from '@shared/area'
import type { AnalysisProgress, AreaValue, DocumentProgress } from '@shared/domain'
import type { AnalysisStatus, PropertyType, RiskLevel } from '@shared/enums'

// Pure helpers for the detail screen. They touch neither window nor document,
// so the suites in tests/renderer/detail can import them in Node.

type Risk = AnalysisResult['risks'][number]

const SEVERITY_RANK: Readonly<Record<RiskLevel, number>> = { high: 0, medium: 1, low: 2 }

/**
 * Risks from high to low severity. Each keeps its index in the result,
 * because evidence paths such as "risks.2" refer to the original order.
 */
export function risksBySeverity(risks: readonly Risk[]): Array<{ risk: Risk; index: number }> {
  return risks
    .map((risk, index) => ({ risk, index }))
    .sort(
      (a, b) =>
        SEVERITY_RANK[a.risk.severity] - SEVERITY_RANK[b.risk.severity] || a.index - b.index,
    )
}

/**
 * The app's check of a value such as "areas.0" (null when there is none) and
 * the page its link opens: the cited page, or for `wrong_page` the page where
 * the check found the quote.
 */
export function checkedSource(
  record: AnalysisRecord,
  path: string,
  cited: number | null,
): { status: EvidenceStatus | null; page: number | null } {
  const item = record.evidence.find((entry) => entry.path === path)
  if (item === undefined) return { status: null, page: cited }
  const page = item.status === 'wrong_page' && item.page !== null ? item.page : cited
  return { status: item.status, page }
}

export function isSameArea(a: AreaValue, b: AreaValue): boolean {
  return (
    a.sqm === b.sqm &&
    a.kind === b.kind &&
    a.source === b.source &&
    a.page === b.page &&
    a.documentId === b.documentId
  )
}

/**
 * The relative gap to the chosen area when it exceeds AREA_MISMATCH_THRESHOLD,
 * otherwise null. Only kinds a price per m² may use are compared: a cellar or
 * a balcony always differs from the living area.
 */
export function areaMismatch(
  candidate: AreaValue,
  chosen: AreaValue | null,
  propertyType: PropertyType,
): number | null {
  if (chosen === null || isSameArea(candidate, chosen)) return null
  if (!usableAreaKinds(propertyType).includes(candidate.kind)) return null
  const gap = (candidate.sqm - chosen.sqm) / chosen.sqm
  return Math.abs(gap) > AREA_MISMATCH_THRESHOLD ? gap : null
}

export type PendingStatus = Extract<AnalysisStatus, 'queued' | 'running'>

export function isPending(status: AnalysisStatus): status is PendingStatus {
  return status === 'queued' || status === 'running'
}

export type AnalysisView =
  | { kind: 'none' }
  | {
      kind: 'pending'
      analysisId: number
      status: PendingStatus
      step: AnalysisProgress['step']
      /** Analyses in the queue, when a progress event reported it. */
      queued: number | null
    }
  /** A run has ended, and the listing reload that brings its record is pending or failed. */
  | { kind: 'ended'; analysisId: number }
  | { kind: 'stopped'; record: AnalysisRecord }
  | { kind: 'done'; record: AnalysisRecord }

/**
 * What the analysis section shows: the latest record from listings:get, or a
 * live progress event for a run the record has not caught up with yet.
 */
export function analysisView(
  record: AnalysisRecord | null,
  progress: AnalysisProgress | null,
): AnalysisView {
  const live =
    progress !== null && (record === null || progress.analysisId >= record.id) ? progress : null
  if (live !== null && isPending(live.status)) {
    return {
      kind: 'pending',
      analysisId: live.analysisId,
      status: live.status,
      step: live.step,
      queued: live.queued,
    }
  }
  // The event reports the end of a run that the record shows as older or unfinished.
  if (
    live !== null &&
    (record === null || record.id < live.analysisId || isPending(record.status))
  ) {
    return { kind: 'ended', analysisId: live.analysisId }
  }
  if (record === null) return { kind: 'none' }
  if (isPending(record.status)) {
    return {
      kind: 'pending',
      analysisId: record.id,
      status: record.status,
      step: record.status === 'queued' ? 'waiting' : null,
      queued: null,
    }
  }
  return record.status === 'done' ? { kind: 'done', record } : { kind: 'stopped', record }
}

/** Joins the parts that are present, e.g. an address from street, postcode and city. */
export function joinPresent(parts: ReadonlyArray<string | null>, separator: string): string {
  return parts.filter((part): part is string => part !== null && part !== '').join(separator)
}

/** Page numbers as short ranges, e.g. [3, 5, 6, 7, 12] becomes "3, 5–7, 12". */
export function pageRanges(pages: readonly number[]): string {
  const sorted = [...new Set(pages)].sort((a, b) => a - b)
  const ranges: Array<[number, number]> = []
  for (const page of sorted) {
    const last = ranges.at(-1)
    if (last !== undefined && page === last[1] + 1) last[1] = page
    else ranges.push([page, page])
  }
  return ranges.map(([from, to]) => (from === to ? `${from}` : `${from}–${to}`)).join(', ')
}

export type ActivePhase = Exclude<DocumentProgress['phase'], 'done' | 'failed' | 'cancelled'>
export type ActiveDocumentProgress = DocumentProgress & { phase: ActivePhase }

function isActive(event: DocumentProgress): event is ActiveDocumentProgress {
  return event.phase === 'download' || event.phase === 'extract' || event.phase === 'estimate'
}

/**
 * Applies a documents:progress event to the running transfers of one listing.
 * A finished "fill" job reports no document, so it ends every entry of that job.
 */
export function nextDocumentProgress(
  current: ReadonlyMap<number, ActiveDocumentProgress>,
  event: DocumentProgress,
  ownDocumentIds: ReadonlySet<number>,
): ReadonlyMap<number, ActiveDocumentProgress> {
  if (!isActive(event)) {
    const next = new Map(current)
    for (const [documentId, entry] of current) {
      const ended =
        event.documentId === null ? entry.job === event.job : documentId === event.documentId
      if (ended) next.delete(documentId)
    }
    return next.size === current.size ? current : next
  }
  if (event.documentId === null || !ownDocumentIds.has(event.documentId)) return current
  return new Map(current).set(event.documentId, event)
}
