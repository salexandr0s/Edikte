import { statusFor } from '@shared/edikte-codes'
import type { Bundesland, NoticeType } from '@shared/enums'
import { bezirkFromPlz } from '@shared/wien-bezirke'
import { computeContentHash } from '../content-hash'
import type { EdictRecord } from '../edict-record'
import { propertyTypeFor } from '../object-title'
import { insolvencyPublicUrl } from './api'
import type { InsolvencyDetail } from './detail'
import { INSOLVENCY_PARSER_VERSION } from './parser-version'
import type { InsolvencySearchRow } from './search'

export interface ListedInsolvencyRow extends InsolvencySearchRow {
  /** Scope follows the search that listed the record, never its detail field. */
  bundesland: Bundesland
  conflictingBundesland: boolean
}

export function insolvencyContentHash(detail: InsolvencyDetail): string {
  return computeContentHash(detail)
}

export function buildInsolvencyRecord(input: {
  detail: InsolvencyDetail
  row: ListedInsolvencyRow
  fetchedAt: string
}): EdictRecord {
  const { detail, row, fetchedAt } = input
  const noticeType: NoticeType =
    detail.transaction === 'sale'
      ? 'insolvenzverkauf'
      : detail.transaction === 'lease'
        ? 'insolvenzverpachtung'
        : 'other'
  const title = detail.title ?? detail.categoryLabel ?? detail.announcementKind ?? ''
  return {
    id: row.id,
    source: 'insolvency_sale',
    caseKey: `insolvency:${row.recordNumber}`,
    noticeType,
    status: statusFor('insolvency_sale', noticeType),
    url: insolvencyPublicUrl(row.recordNumber),
    court: detail.court ?? row.court,
    caseNumber: detail.caseNumber ?? row.caseNumber,
    categoryLabel: detail.categoryLabel,
    categoryCodes: detail.categoryCodes,
    propertyType: propertyTypeFor(detail.categoryCodes, title),
    title,
    street: detail.street,
    plz: detail.plz,
    city: detail.city,
    bundesland: row.bundesland,
    bezirk: bezirkFromPlz(detail.plz),
    schaetzwertEur: detail.valueEur,
    geringstesGebotEur: null,
    vadiumEur: null,
    meistbotEur: null,
    objektgroesseSqm: detail.objektgroesseSqm,
    objektgroesseRaw: detail.objektgroesseRaw,
    grundstuecksgroesseSqm: detail.grundstuecksgroesseSqm,
    zubehoer: detail.zubehoer,
    auctionAt: null,
    auctionPlace: null,
    viewing: null,
    grundbuch: detail.grundbuch,
    ez: detail.ez,
    remarks: null,
    publishedAt: detail.publishedAt ?? row.publishedAt,
    changedAt: detail.changedAt ?? row.updatedAt,
    corrected: detail.changedAt !== null || row.updatedAt !== null,
    changeLog: detail.changeLog,
    rawLabels: detail.rawLabels,
    kurzgutachten: detail.facts,
    kurzgutachtenUrl: null,
    insolvency: {
      administrator: detail.administrator,
      deputy: detail.deputy,
      description: detail.description,
      link: detail.link,
    },
    relatedIds: [],
    contentHash: insolvencyContentHash(detail),
    parserVersion: INSOLVENCY_PARSER_VERSION,
    firstSeenAt: fetchedAt,
    lastSeenAt: fetchedAt,
    fetchedAt,
    removedAt: null,
  }
}
