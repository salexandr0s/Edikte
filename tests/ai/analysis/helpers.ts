import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { AnalysisResultSchema, type AnalysisResult } from '@shared/analysis-schema'
import type { ProviderId } from '@shared/providers'
import type { AnalysisPage, EdictFacts } from '../../../src/main/ai/analysis/types'
import {
  ProviderError,
  type AiProvider,
  type AnalysisRequest,
  type AnalysisResponse,
  type AnalysisUsage,
} from '../../../src/main/ai/provider'

const AnalysisPageSchema = z.object({
  pageNumber: z.number().int().min(1),
  printedLabel: z.string().nullable(),
  hasText: z.boolean(),
  text: z.string(),
})

function readFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as unknown
}

/**
 * A synthetic Gutachten for a house: 14 pages with a running header, a table
 * of contents, scans on pages 6 and 12 and an appendix from page 10. Every
 * name, address and number in it is invented.
 */
export const housePages: AnalysisPage[] = z
  .array(AnalysisPageSchema)
  .parse(readFixture('house-pages.json'))

/** An answer for housePages with at least one fact for each evidence status. */
export const houseAnswer: AnalysisResult = AnalysisResultSchema.parse(
  readFixture('house-answer.json'),
)

export const houseEdict: EdictFacts = {
  source: 'court_auction',
  categoryLabel: 'Einfamilienhaus',
  propertyType: 'house',
  street: 'Lindenweg 7',
  plz: '1100',
  city: 'Wien',
  schaetzwertEur: 544_000,
  objektgroesseSqm: 135.93,
}

export type FakeStep =
  | {
      json: unknown
      raw?: string
      usage?: Partial<AnalysisUsage>
      model?: string
      accountLabel?: string | null
    }
  | { error: Error }
  /** Waits until the request is aborted. */
  | { hang: true }

export interface FakeProvider extends AiProvider {
  readonly requests: AnalysisRequest[]
}

/** A provider that answers from a script instead of the network. */
export function fakeProvider(id: ProviderId, steps: readonly FakeStep[]): FakeProvider {
  const requests: AnalysisRequest[] = []
  const script = [...steps]
  return {
    id,
    requests,
    detect: () =>
      Promise.resolve({
        id,
        state: 'ready',
        version: null,
        binaryPath: null,
        binaryPathSource: null,
        accountLabel: null,
        plan: null,
        detail: null,
        checkedAt: null,
      }),
    models: () => Promise.resolve([]),
    analyze: (request, signal) => {
      requests.push(request)
      const step = script.shift()
      if (step === undefined)
        return Promise.reject(new Error('The fake provider has no answer left'))
      if ('error' in step) return Promise.reject(step.error)
      if ('hang' in step) {
        return new Promise<AnalysisResponse>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new ProviderError(id, 'cancelled', 'Request aborted')),
            { once: true },
          )
        })
      }
      return Promise.resolve({
        json: step.json,
        raw: step.raw ?? JSON.stringify(step.json),
        usage: { inputTokens: 1_000, outputTokens: 200, costUsd: null, ...step.usage },
        model: step.model ?? request.model,
        accountLabel: step.accountLabel === undefined ? 'tester@example.com' : step.accountLabel,
      })
    },
  }
}
