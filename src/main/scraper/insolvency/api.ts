import { z } from 'zod'
import { isInsolvencyRecordNumber } from '@shared/edict-id'
import {
  BUNDESLAND_JUSTIZONLINE_CODES,
  JUSTIZONLINE_API_PATH,
  JUSTIZONLINE_ORIGIN,
} from '@shared/edikte-codes'
import { BundeslandSchema } from '@shared/enums'
import { isUnavailable, normalizeSpace } from '../site-text'

// JustizOnline publishes the sales in insolvency proceedings through a JSON
// API that has no documentation. This module holds the URLs the reader
// requests, the shapes of the two answers, and how the API writes dates and
// empty values. The schemas ask only for what the parsers read. Zod drops
// every other key, so a new key in an answer changes nothing.

/** Rows per search page. The API answers HTTP 400 for 500. */
export const INSOLVENCY_PAGE_SIZE = 100

const API_ROOT = `${JUSTIZONLINE_ORIGIN}${JUSTIZONLINE_API_PATH}`
/** Folder that the relative file URLs of the API start from. */
const FILE_BASE_PATH = '/jop/'

// ── Record numbers and URLs ────────────────────────────────────────────────

/** A record number as the stored IDs take it: a positive integer of at most twelve digits. */
const RecordNumberSchema = z
  .number()
  .refine(isInsolvencyRecordNumber, 'Not a JustizOnline record number')

const InsolvencySearchRequestSchema = z.object({
  bundesland: BundeslandSchema,
  /** Pages count from 1. */
  page: z.number().int().min(1),
})
export type InsolvencySearchRequest = z.infer<typeof InsolvencySearchRequestSchema>

/** Search URL for the real-estate records of one Bundesland, newest first. */
export function insolvencySearchUrl(request: InsolvencySearchRequest): string {
  const { bundesland, page } = InsolvencySearchRequestSchema.parse(request)
  // Each filter travels as a JSON object in a `filter` parameter of its own.
  const filters = [
    { id: 'ediktType', values: ['MV'] },
    { id: 'mvBekanntmachungType', values: ['LIEGENSCHAFT'] },
    { id: 'bl', values: [BUNDESLAND_JUSTIZONLINE_CODES[bundesland]] },
  ]
  const query = [
    ...filters.map((filter) => `filter=${encodeURIComponent(JSON.stringify(filter))}`),
    `page=${page}`,
    `pageSize=${INSOLVENCY_PAGE_SIZE}`,
    'sort=DATE_DESC',
  ]
  return `${API_ROOT}edikte?${query.join('&')}`
}

/** API URL of one record. */
export function insolvencyDetailUrl(recordNumber: number): string {
  return `${API_ROOT}edikte/${RecordNumberSchema.parse(recordNumber)}`
}

/** The record's page on JustizOnline, for "open on site". */
export function insolvencyPublicUrl(recordNumber: number): string {
  const number = RecordNumberSchema.parse(recordNumber)
  return `${JUSTIZONLINE_ORIGIN}/jop/web/ediktsdatei/suche/${number}`
}

// The last segment is a base64 text. It may hold the characters of both base64
// alphabets, and "+", "/" and "=" as percent escapes. A dot never passes, so
// the segment cannot hold "..", written out or escaped.
const FILE_TOKEN = /^(?:[A-Za-z0-9_+=-]|%2[BbFf]|%3[Dd])+$/

/**
 * Absolute URL of a file the API lists for a record, or null when the app must
 * not fetch it. The API gives `fileUrl` relative to
 * `https://justizonline.gv.at/jop/`. Only this form passes:
 * `<API root>edikte/<the record's own number>/resources/<one path segment>`,
 * without query or fragment. A response therefore cannot point a download at
 * another host or at another record.
 */
export function insolvencyFileUrl(fileUrl: string, recordNumber: number): string | null {
  if (!RecordNumberSchema.safeParse(recordNumber).success) return null
  let url: URL
  try {
    url = new URL(fileUrl, `${JUSTIZONLINE_ORIGIN}${FILE_BASE_PATH}`)
  } catch {
    return null
  }
  const folder = `${API_ROOT}edikte/${recordNumber}/resources/`
  // Query and fragment are part of `href`, so the token check refuses both.
  if (!url.href.startsWith(folder) || !FILE_TOKEN.test(url.href.slice(folder.length))) return null
  // Resolving drops ".." segments and turns backslashes into slashes. A value
  // that needed such a repair is refused: the published text must already be
  // the resolved URL, written in full, from the root, or relative to the folder.
  const spellings = [url.href, url.pathname, url.pathname.slice(FILE_BASE_PATH.length)]
  return spellings.includes(fileUrl) ? url.href : null
}

// ── Values ─────────────────────────────────────────────────────────────────

/**
 * A published value with tidy whitespace and its line breaks kept. Null for a
 * missing value, an empty one and the "-" the API prints for an empty field.
 */
export function publishedText(text: string | null | undefined): string | null {
  if (text == null) return null
  const clean = text
    .split('\n')
    .map((line) => normalizeSpace(line))
    .filter((line) => line !== '')
    .join('\n')
  return isUnavailable(clean) ? null : clean
}

const API_DATE = /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/

/**
 * The date of an API value such as "2026-11-02" or "2026-11-02T09:30:00.123456",
 * as "YYYY-MM-DD". The API gives its timestamps without a time zone. The date
 * is taken as written and never converted, like every date from the site.
 * Null for any other text.
 */
export function localDateOf(text: string): string | null {
  const [, year, month, day] = API_DATE.exec(text.trim()) ?? []
  if (year === undefined || month === undefined || day === undefined) return null
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  const exists =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day)
  return exists ? `${year}-${month}-${day}` : null
}

const ApiDateSchema = z
  .string()
  .refine((text) => localDateOf(text) !== null, 'Not a date')
  .transform((text) => text.trim().slice(0, 10))

/** `message`, followed by the fields a failed check names. Zod paths hold keys, never values. */
export function withIssueFields(message: string, error: z.ZodError): string {
  const fields = error.issues
    .map((issue) => issue.path.map(String).join('.'))
    .filter((field) => field !== '')
  return fields.length === 0 ? message : `${message}: ${[...new Set(fields)].join(', ')}`
}

// ── Search answer ──────────────────────────────────────────────────────────

/** Answer of `edikte?filter=…`. */
export const InsolvencySearchEnvelopeSchema = z.object({
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  /** Matches of the whole search, over all pages. */
  total: z.number().int().nonnegative(),
  incompleteResult: z.boolean(),
  /** Each row is checked on its own, so one unreadable row does not cost the page. */
  edikte: z.array(z.unknown()),
})

/** One row of `edikte`. Both dates are date-only; `updatedAt` is often absent. */
export const InsolvencySearchRowSchema = z.object({
  id: RecordNumberSchema,
  publishedAt: ApiDateSchema,
  updatedAt: ApiDateSchema.nullish(),
  aktenzeichen: z.string().nullish(),
  publisherInfo: z.string().nullish(),
})

// ── Record answer ──────────────────────────────────────────────────────────

/** Answer of `edikte/<number>`. */
export const InsolvencyDetailEnvelopeSchema = z.object({
  edikt: z.object({
    id: z.number(),
    /** Read one by one, so the parser passes over a section it cannot read. */
    sections: z.array(z.unknown()),
  }),
})

export const InsolvencySectionSchema = z.object({
  title: z.string(),
  elements: z.array(z.unknown()),
})

/** The three kinds of element the parser reads. An element of another kind fails this check. */
export const InsolvencyElementSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('LIST'), items: z.array(z.unknown()) }),
  z.object({ type: z.literal('FILE_LIST'), items: z.array(z.unknown()) }),
  z.object({ type: z.literal('HISTORY'), rows: z.array(z.unknown()) }),
])
export type InsolvencyElement = z.infer<typeof InsolvencyElementSchema>

/** One line of a LIST element. Its value is `text`, or the timestamp in `textDate`. */
export const InsolvencyListItemSchema = z.object({
  heading: z.string(),
  text: z.string().nullish(),
  textDate: z.string().nullish(),
})

/** One file of a FILE_LIST element. `fileName` is a label such as "Gutachten"; `fileSize` is in bytes. */
export const InsolvencyFileItemSchema = z.object({
  fileName: z.string().nullish(),
  fileUrl: z.string().nullish(),
  fileSize: z.number().nullish(),
  mimeType: z.string().nullish(),
  deleted: z.boolean().nullish(),
})

/**
 * One change of a HISTORY row. It names the changed field in `fieldId`, or
 * describes the change in the note `textDe`. An item also holds the old and
 * the new value. This schema leaves both out, so the parser never reads them.
 */
export const InsolvencyHistoryItemSchema = z.object({
  operation: z.string().nullish(),
  fieldId: z.string().nullish(),
  textDe: z.string().nullish(),
})

/** One row of a HISTORY element: the changes published at one time. */
export const InsolvencyHistoryRowSchema = z.object({
  changeDateTime: z.string().nullish(),
  items: z.array(z.unknown()),
})
