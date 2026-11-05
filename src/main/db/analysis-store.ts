import { and, asc, desc, eq, inArray, type SQL } from 'drizzle-orm'
import type { AnalysisRecord } from '@shared/analysis-schema'
import type { AnalysisStatus } from '@shared/enums'
import type { ProviderId } from '@shared/providers'
import type { AnalysisJob, AnalysisJobStore } from '../ai/analysis/batch'
import type { AppDatabase } from './client'
import { toAnalysisRecord, type AnalysisRow } from './records'
import { analyses } from './schema'

// The analyses table: the jobs of AnalysisQueue (src/main/ai/analysis/batch.ts)
// and the results the detail screen lists.

const PENDING_STATUSES: AnalysisStatus[] = ['queued', 'running']

/** A job to queue. */
export interface NewAnalysisJob {
  edictId: string
  provider: ProviderId
  /** The model chosen in Settings; the run may report a more specific one. */
  model: string
  /** The provider's account when the job was queued. */
  accountLabel: string | null
  promptVersion: number
  schemaVersion: number
  documentIds: number[]
}

/** Inserts queued rows in one transaction and returns them as queue jobs, in order. */
export function queueAnalyses(
  db: AppDatabase,
  jobs: readonly NewAnalysisJob[],
  createdAt: string,
): AnalysisJob[] {
  return db.transaction((tx) =>
    jobs.map((job) => {
      const { id } = tx
        .insert(analyses)
        .values({
          edictId: job.edictId,
          provider: job.provider,
          model: job.model,
          requestedModel: job.model,
          accountLabel: job.accountLabel,
          promptVersion: job.promptVersion,
          schemaVersion: job.schemaVersion,
          status: 'queued',
          documentIds: job.documentIds,
          createdAt,
        })
        .returning({ id: analyses.id })
        .get()
      return { analysisId: id, edictId: job.edictId, provider: job.provider, model: job.model }
    }),
  )
}

/** The queue's view of the table. Jobs left queued or running are listed again after a restart. */
export function createAnalysisJobStore(db: AppDatabase): AnalysisJobStore {
  const update = (analysisId: number, values: Partial<typeof analyses.$inferInsert>): void => {
    db.update(analyses).set(values).where(eq(analyses.id, analysisId)).run()
  }
  return {
    listPending: () =>
      db
        .select({
          id: analyses.id,
          edictId: analyses.edictId,
          provider: analyses.provider,
          model: analyses.model,
          requestedModel: analyses.requestedModel,
        })
        .from(analyses)
        .where(inArray(analyses.status, PENDING_STATUSES))
        .orderBy(asc(analyses.id))
        .all()
        .map((row) => ({
          analysisId: row.id,
          edictId: row.edictId,
          provider: row.provider,
          model: row.requestedModel ?? row.model,
        })),
    markRunning: (analysisId, startedAt) => update(analysisId, { status: 'running', startedAt }),
    markDone: (analysisId, outcome, finishedAt) =>
      update(analysisId, {
        status: 'done',
        model: outcome.model,
        requestedModel: outcome.requestedModel,
        // Keep the account from queueing when the provider reports none.
        ...(outcome.accountLabel === null ? {} : { accountLabel: outcome.accountLabel }),
        promptVersion: outcome.promptVersion,
        schemaVersion: outcome.schemaVersion,
        result: outcome.result,
        evidence: outcome.evidence,
        crossChecks: outcome.crossChecks,
        droppedPages: outcome.droppedPages,
        inputTokens: outcome.inputTokens,
        outputTokens: outcome.outputTokens,
        costUsd: outcome.costUsd,
        rawResponse: outcome.rawResponse,
        errorCode: null,
        errorMessage: null,
        finishedAt,
      }),
    markFailed: (analysisId, failure, finishedAt) =>
      update(analysisId, {
        status: 'failed',
        errorCode: failure.error.code,
        errorMessage: failure.error.message,
        rawResponse: failure.rawResponse,
        inputTokens: failure.inputTokens,
        outputTokens: failure.outputTokens,
        costUsd: failure.costUsd,
        finishedAt,
      }),
    markCancelled: (analysisId, finishedAt) =>
      update(analysisId, { status: 'cancelled', finishedAt }),
  }
}

/** Every analysis of an edict, newest first. */
export function listAnalyses(db: AppDatabase, edictId: string): AnalysisRecord[] {
  return db
    .select()
    .from(analyses)
    .where(eq(analyses.edictId, edictId))
    .orderBy(desc(analyses.createdAt), desc(analyses.id))
    .all()
    .map(toAnalysisRecord)
}

export function findAnalysis(
  db: AppDatabase,
  analysisId: number,
): Pick<AnalysisRow, 'id' | 'edictId' | 'status'> | null {
  const found = db
    .select({ id: analyses.id, edictId: analyses.edictId, status: analyses.status })
    .from(analyses)
    .where(eq(analyses.id, analysisId))
    .get()
  return found ?? null
}

/** Edicts among `edictIds` with a queued or running analysis. */
export function pendingAnalysisEdicts(db: AppDatabase, edictIds: readonly string[]): Set<string> {
  return edictsWhere(db, edictIds, inArray(analyses.status, PENDING_STATUSES))
}

/** Edicts among `edictIds` with a finished analysis made with this prompt version. */
export function analyzedEdicts(
  db: AppDatabase,
  edictIds: readonly string[],
  promptVersion: number,
): Set<string> {
  return edictsWhere(
    db,
    edictIds,
    and(eq(analyses.status, 'done'), eq(analyses.promptVersion, promptVersion)),
  )
}

function edictsWhere(
  db: AppDatabase,
  edictIds: readonly string[],
  condition: SQL | undefined,
): Set<string> {
  if (edictIds.length === 0) return new Set()
  const rows = db
    .selectDistinct({ edictId: analyses.edictId })
    .from(analyses)
    .where(and(inArray(analyses.edictId, [...edictIds]), condition))
    .all()
  return new Set(rows.map((row) => row.edictId))
}
