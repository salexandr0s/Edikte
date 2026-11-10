import { describe, expect, it } from 'vitest'
import type { SyncRunSummary } from '@shared/domain'
import { summarizeRuns } from '../../../src/renderer/src/features/listings/sync-summary'

function run(fields: Partial<SyncRunSummary>): SyncRunSummary {
  return {
    id: 1,
    source: 'court_auction',
    kind: 'incremental',
    status: 'ok',
    startedAt: '2026-11-10T07:00:00.000Z',
    finishedAt: '2026-11-10T07:04:00.000Z',
    listed: 0,
    fetched: 0,
    changed: 0,
    removed: 0,
    requests: 0,
    note: null,
    ...fields,
  }
}

describe('summarizeRuns', () => {
  it('reports a failed source next to one that finished later without a problem', () => {
    const failed = run({ status: 'failed', note: 'network: the server did not answer' })
    const ok = run({
      id: 2,
      source: 'insolvency_sale',
      startedAt: '2026-11-10T07:04:00.000Z',
      finishedAt: '2026-11-10T07:06:30.000Z',
    })
    expect(summarizeRuns([failed, ok])).toEqual({
      finishedAt: '2026-11-10T07:06:30.000Z',
      status: 'failed',
      troubled: [failed],
    })
  })

  it('has nothing to sum up without a run', () => {
    expect(summarizeRuns([])).toBeNull()
  })
})
