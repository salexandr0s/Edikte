import type { KurzgutachtenFacts } from '@shared/domain'
import { STATUS_BY_NOTICE } from '@shared/edikte-codes'
import type { Bundesland } from '@shared/enums'
import { bezirkFromPlz } from '@shared/wien-bezirke'
import type { edicts } from '../db/schema'
import { buildCaseKey } from './case-key'
import type { ParsedDetail } from './detail'
import { propertyTypeFor } from './object-title'
import { PARSER_VERSION } from './parser-version'
import type { SearchRow } from './search'
import { detailUrl } from './site-text'

/** An `edicts` row as the sync writes it. */
export type EdictRecord = typeof edicts.$inferSelect

export interface EdictRecordInput {
  id: string
  detail: ParsedDetail
  /** List row the page was found through; fills gaps on pages without address or category. */
  row?: SearchRow | null
  bundesland?: Bundesland | null
  kurzgutachten?: KurzgutachtenFacts | null
  /** ISO UTC time of the fetch, also used for first and last seen; the store keeps an older firstSeenAt. */
  fetchedAt: string
}

/** Combines a parsed edict page and its list row into a database row. Page values win. */
export function buildEdictRecord(input: EdictRecordInput): EdictRecord {
  const { id, detail, row = null, fetchedAt } = input
  const fields = detail.fields
  const noticeType =
    detail.noticeType === 'other' ? (row?.noticeType ?? 'other') : detail.noticeType
  const categoryCodes =
    fields.categoryCodes.length > 0 ? fields.categoryCodes : (row?.categoryCodes ?? [])
  const categoryLabel = fields.categoryLabel ?? row?.categoryLabel ?? null
  const objectTitle = detail.objectTitle ?? row?.title ?? null
  const plz = fields.plz ?? row?.plz ?? null
  return {
    id,
    caseKey: buildCaseKey({
      court: fields.court,
      caseNumber: fields.caseNumber,
      object: objectTitle,
      id,
    }),
    noticeType,
    status: STATUS_BY_NOTICE[noticeType],
    url: detailUrl(id),
    court: fields.court,
    caseNumber: fields.caseNumber,
    categoryLabel,
    categoryCodes,
    propertyType: propertyTypeFor(categoryCodes, objectTitle),
    title: objectTitle ?? categoryLabel ?? detail.noticeText,
    street: fields.street ?? row?.street ?? null,
    plz,
    city: fields.city ?? row?.city ?? null,
    bundesland: row?.bundesland ?? input.bundesland ?? null,
    bezirk: bezirkFromPlz(plz),
    schaetzwertEur: fields.schaetzwertEur,
    geringstesGebotEur: fields.geringstesGebotEur,
    vadiumEur: fields.vadiumEur,
    meistbotEur: fields.meistbotEur,
    objektgroesseSqm: fields.objektgroesseSqm,
    objektgroesseRaw: fields.objektgroesseRaw,
    grundstuecksgroesseSqm: fields.grundstuecksgroesseSqm,
    zubehoer: fields.zubehoer,
    auctionAt: fields.auctionAt,
    auctionPlace: fields.auctionPlace,
    viewing: fields.viewing,
    grundbuch: fields.grundbuch,
    ez: fields.ez,
    remarks: fields.remarks,
    // Corrected notices show only the date of the last change.
    publishedAt: fields.publishedAt ?? fields.changedAt,
    changedAt: fields.changedAt,
    corrected: detail.corrected,
    changeLog: detail.changeLog,
    rawLabels: detail.rawLabels,
    kurzgutachten: input.kurzgutachten ?? null,
    kurzgutachtenUrl: detail.kurzgutachtenUrl,
    relatedIds: [
      ...new Set(
        detail.related
          .map((entry) => entry.id)
          .filter((related): related is string => related !== null && related !== id),
      ),
    ],
    contentHash: detail.contentHash,
    parserVersion: PARSER_VERSION,
    firstSeenAt: fetchedAt,
    lastSeenAt: fetchedAt,
    fetchedAt,
    removedAt: null,
  }
}
