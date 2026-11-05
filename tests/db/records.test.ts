import { describe, expect, it } from 'vitest'
import type { AnalysisResult } from '@shared/analysis-schema'
import {
  buildListingRow,
  toAnalysisRecord,
  type AnalysisRow,
  type ListingSources,
} from '../../src/main/db/records'
import { T0, analysisResult, edictId, edictRecord } from './listing-fixtures'

function analysisRow(overrides: Partial<AnalysisRow> = {}): AnalysisRow {
  return {
    id: 1,
    edictId: edictId(1),
    provider: 'claude-cli',
    model: 'opus',
    requestedModel: 'opus',
    accountLabel: null,
    promptVersion: 1,
    schemaVersion: 1,
    status: 'done',
    result: analysisResult(),
    evidence: [],
    crossChecks: [],
    documentIds: [],
    droppedPages: [],
    inputTokens: 1000,
    outputTokens: 200,
    costUsd: null,
    errorCode: null,
    errorMessage: null,
    rawResponse: null,
    createdAt: T0,
    startedAt: T0,
    finishedAt: T0,
    ...overrides,
  }
}

describe('toAnalysisRecord', () => {
  it('keeps a valid stored result and turns an invalid one into null', () => {
    expect(toAnalysisRecord(analysisRow()).result?.areas[0]?.sqm).toBe(60)
    const broken = toAnalysisRecord(analysisRow({ result: { areas: 'from an older schema' } }))
    expect(broken.result).toBeNull()
    expect(broken.status).toBe('done')
  })

  it('reports an error code it does not know as internal', () => {
    const record = toAnalysisRecord(
      analysisRow({
        status: 'failed',
        result: null,
        errorCode: 'code_from_a_newer_version',
        errorMessage: 'Usage limit reached',
      }),
    )
    expect(record.error).toEqual({ code: 'internal', message: 'Usage limit reached' })
  })
})

describe('buildListingRow', () => {
  const edict = edictRecord(1, { objektgroesseSqm: 60 })
  const sources = (ownership: AnalysisResult['ownership']): ListingSources => ({
    starred: false,
    hidden: false,
    hasLanggutachten: true,
    analysisStatus: 'done',
    finished: { result: analysisResult({ ownership }), evidence: [], documentId: null },
    estimates: [],
  })

  it('marks part ownership only outside Wohnungseigentum', () => {
    const share = buildListingRow(
      edict,
      sources({ share: '1/2', wohnungseigentum: false, unit_count: null, bundled_parking: null }),
      'schaetzwert',
    )
    expect(share.row.approximate).toEqual(['partial_ownership'])

    const flat = buildListingRow(
      edict,
      sources({ share: '152/10000', wohnungseigentum: true, unit_count: 2, bundled_parking: true }),
      'schaetzwert',
    )
    expect(flat.row.approximate).toEqual(['multiple_units', 'bundled_parking'])
  })

  it('lets the analysis overrule the title and fills its gaps from it', () => {
    const titled = edictRecord(1, { objektgroesseSqm: 60, title: 'Wohnung W 1+2' })
    const settled = sources({
      share: null,
      wohnungseigentum: true,
      unit_count: 1,
      bundled_parking: null,
    })
    expect(buildListingRow(titled, settled, 'schaetzwert').row.approximate).toEqual([])
    const open = sources({
      share: null,
      wohnungseigentum: null,
      unit_count: null,
      bundled_parking: null,
    })
    expect(buildListingRow(titled, open, 'schaetzwert').row.approximate).toEqual(['multiple_units'])
  })

  it('reads the title and category before any analysis', () => {
    const unanalysed: ListingSources = {
      starred: false,
      hidden: false,
      hasLanggutachten: false,
      analysisStatus: null,
      finished: null,
      estimates: [],
    }
    const reasons = (title: string, categoryLabel = 'Eigentumswohnung') =>
      buildListingRow(
        edictRecord(1, { objektgroesseSqm: 60, title, categoryLabel }),
        unanalysed,
        'schaetzwert',
      ).row.approximate
    expect(reasons('Wohnung W 1+2, ER 1+2')).toEqual(['multiple_units'])
    expect(reasons('Geschäftslokal 1-4', 'Wohnungseigentumsobjekt')).toEqual(['multiple_units'])
    expect(reasons('Wohnung W 1 und KFZ-Abstellplatz 21', 'Wohnungseigentumsobjekt')).toEqual([
      'bundled_parking',
    ])
    expect(reasons('Haus', 'Hausanteil')).toEqual(['partial_ownership'])
    expect(reasons('Wohnung Top 5')).toEqual([])
  })
})
