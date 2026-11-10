import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'
import { SyncStatusSchema } from '@shared/domain'
import { isAppError } from '@shared/errors'
import { openDatabase } from '../../../src/main/db/client'
import { documents, edicts } from '../../../src/main/db/schema'
import { downloadDocument } from '../../../src/main/documents/download'
import { EdikteClient } from '../../../src/main/scraper/client'
import { createSyncService, type SyncService } from '../../../src/main/services/sync'

interface RequestMetric {
  source: 'court_auction' | 'insolvency_sale'
  kind: 'page' | 'document'
  headersMs: number
  status: number | null
  aborted: boolean
}

function report(label: string, serialized: string | undefined): void {
  process.stdout.write(`${label} ${serialized ?? ''}\n`)
}

function aggregate(metrics: RequestMetric[]) {
  const times = metrics.map((metric) => metric.headersMs).toSorted((a, b) => a - b)
  return {
    requests: metrics.length,
    aborted: metrics.filter((metric) => metric.aborted).length,
    httpErrors: metrics.filter((metric) => metric.status !== null && metric.status >= 400).length,
    medianHeadersMs: times[Math.floor(times.length / 2)] ?? 0,
    p95HeadersMs: times[Math.floor(times.length * 0.95)] ?? 0,
    maxHeadersMs: times.at(-1) ?? 0,
  }
}

// Reads the public sites only when explicitly enabled. All fetched records
// and files are confined to this test's temporary directory and then removed.
describe.skipIf(process.env.EDIKTE_LIVE !== '1')(
  'live Vienna sync and JustizOnline downloads',
  () => {
    it(
      'syncs both sources with the shared default client and downloads three small reports',
      async () => {
        const directory = await mkdtemp(join(tmpdir(), 'edikte-live-vienna-'))
        const db = openDatabase(join(directory, 'edikte.sqlite'))
        const metrics: RequestMetric[] = []
        const startedAt = Date.now()
        const nativeFetch = globalThis.fetch
        const measuredFetch: typeof globalThis.fetch = async (input, init) => {
          const url = new URL(input instanceof Request ? input.url : String(input))
          const started = Date.now()
          const metric: RequestMetric = {
            source: url.hostname === 'justizonline.gv.at' ? 'insolvency_sale' : 'court_auction',
            kind: url.pathname.includes('/resources/') ? 'document' : 'page',
            headersMs: 0,
            status: null,
            aborted: false,
          }
          try {
            const response = await nativeFetch(input, init)
            metric.status = response.status
            return response
          } catch (error) {
            metric.aborted = init?.signal?.aborted === true
            throw error
          } finally {
            metric.headersMs = Date.now() - started
            metrics.push(metric)
          }
        }
        const client = new EdikteClient({ appVersion: '0.1.0', fetch: measuredFetch })
        let service: SyncService | null = null
        let lastProgressAt = 0
        let progressEvents = 0
        let idleEvents = 0
        const downloads: Array<{ outcome: string; bytes: number; durationMs: number }> = []
        try {
          service = createSyncService({
            db,
            source: client,
            offline: true,
            readSettings: () => ({
              syncBundeslaender: ['wien'],
              syncSources: ['court_auction', 'insolvency_sale'],
              autoSync: false,
              firstRunCompletedAt: new Date().toISOString(),
            }),
            emit: (event, payload) => {
              if (event !== 'sync:progress') return
              const progress = SyncStatusSchema.parse(payload)
              progressEvents += 1
              if (progress.state === 'idle') idleEvents += 1
              if (Date.now() - lastProgressAt < 30_000 && progress.state !== 'idle') return
              lastProgressAt = Date.now()
              report(
                'live-sync-progress',
                JSON.stringify({
                  elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
                  state: progress.state,
                  source: progress.current?.source ?? null,
                  phase: progress.phase,
                  done: progress.done,
                  total: progress.total,
                  requests: client.requestCount,
                }),
              )
            },
          })
          service.start({ full: true })
          while (service.status().state !== 'idle') {
            if (Date.now() - startedAt > 25 * 60_000)
              throw new Error('Live sync exceeded 25 minutes')
            await new Promise<void>((resolve) => setTimeout(resolve, 1000))
          }
          const summaries = service.status().lastRuns
          report(
            'live-sync-summary',
            JSON.stringify({
              durationSeconds: Math.round((Date.now() - startedAt) / 1000),
              progressEvents,
              idleEvents,
              sources: summaries.map(
                ({ source, status, listed, fetched, changed, removed, requests }) => ({
                  source,
                  status,
                  listed,
                  fetched,
                  changed,
                  removed,
                  requests,
                }),
              ),
            }),
          )
          const candidates = db
            .select({
              edictId: documents.edictId,
              url: documents.url,
              sizeKb: documents.statedSizeKb,
            })
            .from(documents)
            .innerJoin(edicts, eq(edicts.id, documents.edictId))
            .where(
              and(
                eq(edicts.source, 'insolvency_sale'),
                eq(documents.kind, 'langgutachten'),
                isNull(documents.removedAt),
                isNull(edicts.removedAt),
              ),
            )
            .all()
            .toSorted(
              (a, b) =>
                (a.sizeKb ?? Number.MAX_SAFE_INTEGER) - (b.sizeKb ?? Number.MAX_SAFE_INTEGER),
            )
            .slice(0, 3)
          for (const [index, document] of candidates.entries()) {
            const started = Date.now()
            try {
              const downloaded = await downloadDocument({
                url: document.url,
                edictId: document.edictId,
                fileName: `sample-${index + 1}.pdf`,
                documentsDir: join(directory, 'documents'),
                fetch: client.limitedFetch,
                signal: AbortSignal.timeout(2 * 60_000),
              })
              downloads.push({
                outcome: 'ok',
                bytes: downloaded.bytes,
                durationMs: Date.now() - started,
              })
            } catch (error) {
              downloads.push({
                outcome: isAppError(error) ? error.code : 'unexpected',
                bytes: 0,
                durationMs: Date.now() - started,
              })
            }
            report('live-download-result', JSON.stringify(downloads.at(-1)))
          }
          report(
            'live-request-metrics',
            JSON.stringify({
              courtAuction: aggregate(
                metrics.filter((metric) => metric.source === 'court_auction'),
              ),
              insolvencyApi: aggregate(
                metrics.filter(
                  (metric) => metric.source === 'insolvency_sale' && metric.kind === 'page',
                ),
              ),
              insolvencyDocuments: aggregate(
                metrics.filter((metric) => metric.kind === 'document'),
              ),
            }),
          )
          expect(summaries.map((run) => run.source)).toEqual(['court_auction', 'insolvency_sale'])
          expect(summaries.map((run) => run.status)).toEqual(['ok', 'ok'])
          expect(idleEvents).toBe(1)
          expect(downloads).toHaveLength(3)
          expect(
            downloads.every((download) => download.outcome === 'ok' && download.bytes > 0),
          ).toBe(true)
        } finally {
          await service?.dispose()
          db.$client.close()
          await rm(directory, { recursive: true, force: true })
        }
      },
      35 * 60_000,
    )
  },
)
