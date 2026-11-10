import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  max,
  notInArray,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { AnalysisRecord } from '@shared/analysis-schema'
import type { AnalysisStatus, EdictSource } from '@shared/enums'
import type { ProviderId } from '@shared/providers'
import type { AnalysisJob, AnalysisJobStore } from '../ai/analysis/batch'
import type { AppDatabase } from './client'
import { activeReportIds, loadActiveReports } from './document-store'
import { toAnalysisRecord, type AnalysisRow } from './records'
import { analyses, documents, edicts } from './schema'

// The analyses table: the jobs of AnalysisQueue (src/main/ai/analysis/batch.ts)
// and the results the detail screen lists.

const PENDING_STATUSES: AnalysisStatus[] = ['queued', 'running']

/** Legacy document IDs may be malformed; preserve the history without guessing a citation. */
export const analysisColumns = {
  ...getTableColumns(analyses),
  documentIds: sql`CASE WHEN json_valid(${analyses.documentIds})
    THEN CASE WHEN json_type(${analyses.documentIds}) = 'array'
      THEN ${analyses.documentIds} ELSE '[]' END
    ELSE '[]' END`.mapWith(analyses.documentIds),
}

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
        documentIds: outcome.documentIds,
        documentSha256: outcome.documentSha256,
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

/**
 * Marks pending rows cancelled in one statement: those of `providers` (every
 * provider when null), except the jobs in `keep`, whose queue stores how they
 * end. Returns the edicts of the rows it changed.
 */
export function cancelPendingAnalyses(
  db: AppDatabase,
  options: { keep: readonly number[]; providers: readonly ProviderId[] | null; finishedAt: string },
): string[] {
  const rows = db
    .update(analyses)
    .set({ status: 'cancelled', finishedAt: options.finishedAt })
    .where(
      and(
        inArray(analyses.status, PENDING_STATUSES),
        options.providers === null ? undefined : inArray(analyses.provider, [...options.providers]),
        options.keep.length === 0 ? undefined : notInArray(analyses.id, [...options.keep]),
      ),
    )
    .returning({ edictId: analyses.edictId })
    .all()
  return [...new Set(rows.map((row) => row.edictId))]
}

/** Every analysis of an edict, newest first. */
export function listAnalyses(db: AppDatabase, edictId: string): AnalysisRecord[] {
  const report = loadActiveReports(db, [edictId]).get(edictId) ?? null
  return db
    .select(analysisColumns)
    .from(analyses)
    .where(eq(analyses.edictId, edictId))
    .orderBy(desc(analyses.createdAt), desc(analyses.id))
    .all()
    .map((row) => toAnalysisRecord(row, report))
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

/** The source of each requested edict, for source-specific analysis instructions. */
export function analysisSources(
  db: AppDatabase,
  edictIds: readonly string[],
): Map<string, EdictSource> {
  if (edictIds.length === 0) return new Map()
  return new Map(
    db
      .select({ id: edicts.id, source: edicts.source })
      .from(edicts)
      .where(inArray(edicts.id, [...edictIds]))
      .all()
      .map((row) => [row.id, row.source]),
  )
}

/** Subquery: the newest completed result of the current report bytes per edict. */
export function latestCurrentAnalysisIds(db: AppDatabase) {
  return db
    .select({ id: max(analyses.id) })
    .from(analyses)
    .innerJoin(
      documents,
      and(
        eq(
          documents.id,
          sql<number | null>`CASE WHEN json_valid(${analyses.documentIds})
            THEN CASE WHEN json_type(${analyses.documentIds}) = 'array'
              AND json_type(${analyses.documentIds}, '$[0]') = 'integer'
              THEN json_extract(${analyses.documentIds}, '$[0]') END END`,
        ),
        eq(documents.edictId, analyses.edictId),
        inArray(documents.id, activeReportIds(db)),
        eq(documents.sha256, analyses.documentSha256),
      ),
    )
    .where(eq(analyses.status, 'done'))
    .groupBy(analyses.edictId)
}

/** Edicts with a current report result made with the current prompt for their source. */
export function analyzedEdicts(
  db: AppDatabase,
  edictIds: readonly string[],
  promptVersions: Readonly<Record<EdictSource, number>>,
): Set<string> {
  if (edictIds.length === 0) return new Set()
  const rows = db
    .selectDistinct({
      edictId: analyses.edictId,
      promptVersion: analyses.promptVersion,
      source: edicts.source,
    })
    .from(analyses)
    .innerJoin(edicts, eq(edicts.id, analyses.edictId))
    .where(
      and(
        inArray(analyses.edictId, [...edictIds]),
        inArray(analyses.id, latestCurrentAnalysisIds(db)),
      ),
    )
    .all()
  return new Set(
    rows
      .filter((row) => row.promptVersion === promptVersions[row.source])
      .map((row) => row.edictId),
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
