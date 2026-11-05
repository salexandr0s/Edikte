import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { AnalysisOutcome } from '../../src/main/ai/analysis/pipeline'
import {
  createAnalysisJobStore,
  listAnalyses,
  queueAnalyses,
  type NewAnalysisJob,
} from '../../src/main/db/analysis-store'
import { openDatabase } from '../../src/main/db/client'
import { analyses } from '../../src/main/db/schema'
import { houseAnswer } from '../ai/analysis/helpers'
import { NOW, edictId, insertEdict } from '../services/documents/seed'

let folder: string

beforeEach(async () => {
  folder = await mkdtemp(path.join(tmpdir(), 'edikte-analyses-'))
})

afterEach(async () => {
  await rm(folder, { recursive: true, force: true })
})

function job(edict: string, model: string): NewAnalysisJob {
  return {
    edictId: edict,
    provider: 'claude-cli',
    model,
    accountLabel: 'tester@example.com',
    promptVersion: 1,
    schemaVersion: 1,
    documentIds: [1],
  }
}

function outcome(): AnalysisOutcome {
  return {
    provider: 'claude-cli',
    model: 'claude-opus-5-5',
    requestedModel: 'opus',
    accountLabel: 'run@example.com',
    promptVersion: 1,
    schemaVersion: 1,
    result: houseAnswer,
    evidence: [],
    crossChecks: [],
    droppedPages: [],
    inputTokens: 900,
    outputTokens: 100,
    costUsd: null,
    rawResponse: '{}',
    attempts: 1,
  }
}

describe('analysis job store', () => {
  it('lists queued and running jobs after a restart, in queue order', async () => {
    const file = path.join(folder, 'edikte.sqlite')
    const edict = edictId(1)
    let db = openDatabase(file)
    insertEdict(db, edict)
    const [first, second, third] = queueAnalyses(
      db,
      [job(edict, 'opus'), job(edict, 'sonnet'), job(edict, 'haiku')],
      NOW,
    )
    const store = createAnalysisJobStore(db)
    await store.markRunning(first?.analysisId ?? -1, NOW)
    await store.markCancelled(third?.analysisId ?? -1, NOW)
    db.$client.close()

    db = openDatabase(file)
    try {
      expect(await createAnalysisJobStore(db).listPending()).toEqual([first, second])
    } finally {
      db.$client.close()
    }
  })

  it('stores how runs ended and lists analyses newest first', async () => {
    const db = openDatabase(':memory:')
    try {
      const edict = edictId(2)
      insertEdict(db, edict)
      const [older, newer] = queueAnalyses(db, [job(edict, 'opus'), job(edict, 'opus')], NOW)
      const store = createAnalysisJobStore(db)
      await store.markDone(older?.analysisId ?? -1, outcome(), NOW)
      await store.markFailed(
        newer?.analysisId ?? -1,
        {
          error: { code: 'provider_refused', message: 'Refused' },
          rawResponse: null,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
        },
        NOW,
      )

      const records = listAnalyses(db, edict)
      expect(records.map((record) => [record.id, record.status])).toEqual([
        [newer?.analysisId, 'failed'],
        [older?.analysisId, 'done'],
      ])
      expect(records[0]?.error).toEqual({ code: 'provider_refused', message: 'Refused' })
      expect(records[1]).toMatchObject({
        model: 'claude-opus-5-5',
        result: houseAnswer,
        inputTokens: 900,
      })
      expect(
        db
          .select({ requestedModel: analyses.requestedModel, accountLabel: analyses.accountLabel })
          .from(analyses)
          .all(),
      ).toEqual([
        { requestedModel: 'opus', accountLabel: 'run@example.com' },
        { requestedModel: 'opus', accountLabel: 'tester@example.com' },
      ])
    } finally {
      db.$client.close()
    }
  })
})
