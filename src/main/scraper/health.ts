import type { NoticeType } from '@shared/enums'

/**
 * Share of auction pages that may lack the case number or Schätzwert, and of
 * all pages that may have a heading the parser does not know, before a run
 * counts as degraded.
 */
export const HEALTH_MISSING_LIMIT = 0.2
/** Below this many pages a share means little; such samples are degraded only when every page fails. */
export const HEALTH_MIN_PAGES = 5

export interface HealthSample {
  /** The page's notice type, or the list row's when the page heading is unknown. */
  noticeType: NoticeType
  /** The page heading is not a notice type the parser knows. */
  unknownNotice: boolean
  caseNumber: string | null
  schaetzwertEur: number | null
}

export interface RunHealth {
  versteigerungPages: number
  missingCaseNumber: number
  missingSchaetzwert: number
  unknownNotices: number
  degraded: boolean
  /** Why the run is degraded; null when it is not. */
  note: string | null
}

/** True when `count` of `total` pages is too many for a run to be trusted. */
export function exceedsShare(count: number, total: number, limit: number): boolean {
  if (count === 0 || total === 0) return false
  return total >= HEALTH_MIN_PAGES ? count / total > limit : count === total
}

/**
 * Checks the edict pages read in a run. Real auction edicts always name the
 * case number and nearly always the Schätzwert, and nearly every heading is a
 * known notice type, so many gaps mean the page layout changed and the run
 * must not overwrite stored data.
 */
export function assessRunHealth(pages: readonly HealthSample[]): RunHealth {
  const auctions = pages.filter((page) => page.noticeType === 'versteigerung')
  const missingCaseNumber = auctions.filter((page) => page.caseNumber === null).length
  const missingSchaetzwert = auctions.filter((page) => page.schaetzwertEur === null).length
  const unknownNotices = pages.filter((page) => page.unknownNotice).length
  const notes: string[] = []
  if (
    exceedsShare(
      Math.max(missingCaseNumber, missingSchaetzwert),
      auctions.length,
      HEALTH_MISSING_LIMIT,
    )
  ) {
    notes.push(
      `Of ${auctions.length} auction pages, ${missingCaseNumber} lack the case number and ${missingSchaetzwert} the Schätzwert`,
    )
  }
  if (exceedsShare(unknownNotices, pages.length, HEALTH_MISSING_LIMIT)) {
    notes.push(`${unknownNotices} of ${pages.length} edict pages have an unknown heading`)
  }
  return {
    versteigerungPages: auctions.length,
    missingCaseNumber,
    missingSchaetzwert,
    unknownNotices,
    degraded: notes.length > 0,
    note: notes.length > 0 ? notes.join('; ') : null,
  }
}
