import { describe, expect, it } from 'vitest'
import type { AnalysisRecord } from '@shared/analysis-schema'
import type { AnalysisProgress, AreaValue, DocumentProgress } from '@shared/domain'
import type { RiskLevel } from '@shared/enums'
import {
  analysisView,
  areaMismatch,
  checkedSource,
  daysUntil,
  knownZubehoer,
  nextDocumentProgress,
  pageRanges,
  risksBySeverity,
  titleAddsToKind,
} from '../../../src/renderer/src/features/detail/detail-helpers'

const EDICT = 'a'.repeat(32)

function run(id: number, status: AnalysisRecord['status']): AnalysisRecord {
  return {
    id,
    edictId: EDICT,
    documentId: null,
    provider: 'claude-cli',
    model: 'opus',
    promptVersion: 1,
    schemaVersion: 1,
    status,
    result: null,
    evidence: [],
    crossChecks: [],
    droppedPages: [],
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    error: null,
    createdAt: '2026-11-04T09:00:00.000Z',
    startedAt: null,
    finishedAt: null,
  }
}

function progress(
  analysisId: number,
  status: AnalysisProgress['status'],
  step: AnalysisProgress['step'] = null,
): AnalysisProgress {
  return { analysisId, edictId: EDICT, status, step, queued: 2 }
}

describe('analysisView', () => {
  it('shows a new run from its progress before the listing reload has it', () => {
    expect(analysisView(run(4, 'done'), progress(5, 'queued', 'waiting'))).toMatchObject({
      kind: 'pending',
      analysisId: 5,
      status: 'queued',
      queued: 2,
    })
  })

  it('ignores progress of an older run', () => {
    expect(analysisView(run(5, 'done'), progress(4, 'running', 'asking')).kind).toBe('done')
  })

  it('shows a run as ended until the reload brings its end state', () => {
    expect(analysisView(run(5, 'running'), progress(5, 'done'))).toEqual({
      kind: 'ended',
      analysisId: 5,
    })
    expect(analysisView(run(4, 'done'), progress(5, 'failed')).kind).toBe('ended')
    expect(analysisView(run(5, 'running'), null)).toMatchObject({ kind: 'pending', step: null })
    expect(analysisView(run(5, 'cancelled'), progress(5, 'cancelled')).kind).toBe('stopped')
    expect(analysisView(null, null).kind).toBe('none')
  })
})

describe('checkedSource', () => {
  it('links a quote found on another page to the page where it was found', () => {
    const record: AnalysisRecord = {
      ...run(5, 'done'),
      evidence: [
        { path: 'risks.0', page: 9, status: 'wrong_page' },
        { path: 'risks.1', page: 4, status: 'verified' },
      ],
    }
    expect(checkedSource(record, 'risks.0', 3)).toEqual({ status: 'wrong_page', page: 9 })
    expect(checkedSource(record, 'risks.1', 4)).toEqual({ status: 'verified', page: 4 })
    expect(checkedSource(record, 'areas.0', 7)).toEqual({ status: null, page: 7 })
  })
})

describe('risksBySeverity', () => {
  it('sorts from high to low and keeps the index that evidence paths use', () => {
    const risk = (severity: RiskLevel) => ({
      severity,
      title_de: '',
      title_en: '',
      detail_de: '',
      detail_en: '',
      page: null,
      quote: null,
    })
    const sorted = risksBySeverity([risk('low'), risk('high'), risk('medium'), risk('high')])
    expect(sorted.map(({ risk, index }) => [risk.severity, index])).toEqual([
      ['high', 1],
      ['high', 3],
      ['medium', 2],
      ['low', 0],
    ])
  })
})

describe('areaMismatch', () => {
  const area = (sqm: number, kind: AreaValue['kind'], source: AreaValue['source']): AreaValue => ({
    sqm,
    kind,
    source,
    page: null,
    quote: null,
    documentId: null,
  })
  const chosen = area(60, 'nutzflaeche', 'listing')

  it('flags usable areas that differ by more than the threshold', () => {
    expect(areaMismatch(area(70, 'nutzflaeche', 'ai_verified'), chosen, 'apartment')).toBeCloseTo(
      1 / 6,
    )
    expect(areaMismatch(area(64, 'wohnflaeche', 'local_estimate'), chosen, 'apartment')).toBeNull()
  })

  it('compares neither cellars nor the chosen area itself', () => {
    expect(areaMismatch(area(8, 'keller', 'ai_verified'), chosen, 'apartment')).toBeNull()
    expect(areaMismatch(chosen, chosen, 'apartment')).toBeNull()
  })
})

describe('nextDocumentProgress', () => {
  it('ends every entry of a fill job when the job ends without a document', () => {
    const event = (
      documentId: number | null,
      phase: DocumentProgress['phase'],
    ): DocumentProgress => ({
      job: 'fill',
      phase,
      documentId,
      edictId: null,
      done: 0,
      total: 2,
      bytesDone: null,
      bytesTotal: null,
    })
    const own = new Set([1])
    const running = nextDocumentProgress(new Map(), event(1, 'extract'), own)
    expect(running.get(1)?.phase).toBe('extract')
    expect(nextDocumentProgress(running, event(2, 'download'), own)).toBe(running)
    expect(nextDocumentProgress(running, event(null, 'cancelled'), own).size).toBe(0)
  })
})

describe('pageRanges', () => {
  it('joins consecutive pages into ranges', () => {
    expect(pageRanges([12, 3, 5, 6, 7, 5])).toBe('3, 5–7, 12')
  })
})

describe('site text in the detail screen', () => {
  it('translates stock Zubehör values and keeps other text as published', () => {
    expect(knownZubehoer('kein Zubehör')).toBe('none')
    expect(knownZubehoer(' Nicht festgestellt. ')).toBe('notDetermined')
    expect(knownZubehoer('Einbauküche: Zeitwert 0,00 EUR')).toBeNull()
  })

  it('shows a document title only when it says more than the kind', () => {
    expect(titleAddsToKind('Langgutachten', 'Langgutachten')).toBe(false)
    expect(titleAddsToKind('Foto', 'Fotos')).toBe(false)
    expect(titleAddsToKind('Grundriss', 'Plan')).toBe(true)
    expect(titleAddsToKind('Anhang zum Langgutachten', 'Langgutachten')).toBe(true)
  })
})

describe('daysUntil', () => {
  // Local time, like the clock of the computer the app runs on.
  const now = new Date(2026, 10, 5, 23, 30)

  it('counts calendar days, whatever the time of day', () => {
    expect(daysUntil('2026-11-05T09:00', now)).toBe(0)
    expect(daysUntil('2026-11-06T00:15', now)).toBe(1)
    expect(daysUntil('2026-12-03T10:00', now)).toBe(28)
    expect(daysUntil('2026-11-01', now)).toBe(-4)
  })

  it('returns null for text that is not a site date', () => {
    expect(daysUntil('Dezember 2026', now)).toBeNull()
  })
})
