import type { SyncRunSummary } from '@shared/domain'

// The summary behind the sync bar, without React or the DOM, so it runs under Vitest.

/** The statuses from the worst to the best. A run in progress has no result yet and comes last. */
const RANK: Readonly<Record<SyncRunSummary['status'], number>> = {
  failed: 0,
  degraded: 1,
  cancelled: 2,
  ok: 3,
  running: 4,
}

export interface RunsSummary {
  /** When the newest of the runs ended. */
  finishedAt: string
  /** The worst status among the runs. */
  status: SyncRunSummary['status']
  /** The degraded and failed runs that carry a note, in the given order. */
  troubled: SyncRunSummary[]
}

/** Sums up the last run of each source for the sync bar. Null when there is none. */
export function summarizeRuns(runs: readonly SyncRunSummary[]): RunsSummary | null {
  const [first, ...rest] = runs
  if (first === undefined) return null
  let finishedAt = timeOf(first)
  let status = first.status
  for (const run of rest) {
    // App timestamps are ISO UTC strings in one format, so they compare as text.
    if (timeOf(run) > finishedAt) finishedAt = timeOf(run)
    if (RANK[run.status] < RANK[status]) status = run.status
  }
  return { finishedAt, status, troubled: runs.filter(isTroubled) }
}

/** When a run ended, or when it started as long as it has no end. */
function timeOf(run: SyncRunSummary): string {
  return run.finishedAt ?? run.startedAt
}

function isTroubled(run: SyncRunSummary): boolean {
  return (run.status === 'degraded' || run.status === 'failed') && run.note !== null
}
