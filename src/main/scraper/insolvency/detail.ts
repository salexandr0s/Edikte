import type { InsolvencyContact, KurzgutachtenFacts } from '@shared/domain'
import { BUNDESLAND_SITE_NAMES, type CategoryCode } from '@shared/edikte-codes'
import { BundeslandSchema, type Bundesland, type DocumentKind } from '@shared/enums'
import { AppError } from '@shared/errors'
import type { ChangeLogEntry, DocumentLink } from '../detail'
import { categoryCodesFor, extractEur, extractSqm, labelKey, normalizeSpace } from '../site-text'
import {
  InsolvencyDetailEnvelopeSchema,
  InsolvencyElementSchema,
  InsolvencyFileItemSchema,
  InsolvencyHistoryItemSchema,
  InsolvencyHistoryRowSchema,
  InsolvencyListItemSchema,
  InsolvencySectionSchema,
  insolvencyFileUrl,
  localDateOf,
  publishedText,
  withIssueFields,
  type InsolvencyElement,
} from './api'

const BASE_SECTION = 'Grunddaten'
const PROPERTY_SECTION = 'Adressdaten, Beschreibung und Schätzwert'
const ADMINISTRATOR_SECTION = 'Insolvenzverwalter:in'
const DEPUTY_SECTION = 'Stellvertreter:in'

// ── The debtor ─────────────────────────────────────────────────────────────

/**
 * The headings the reader keeps from "Grunddaten". That section also names the
 * insolvent person or company, with the company register number and an
 * address. The app does not need that to judge a property, so the value of any
 * other heading in the section is never read. A heading the API adds to the
 * debtor's block stays out in the same way.
 */
const BASE_HEADINGS = [
  'Dienststelle',
  'Aktenzeichen',
  'Bekanntmachungsdatum',
  'Letzte Änderung',
  'Art der Bekanntmachung',
  'Art der Transaktion',
] as const
type BaseHeading = (typeof BASE_HEADINGS)[number]

const BASE_KEYS: ReadonlySet<string> = new Set(BASE_HEADINGS.map((heading) => labelKey(heading)))

function isBaseHeading(heading: string): boolean {
  return BASE_KEYS.has(labelKey(heading))
}

/**
 * The debtor's headings in "Grunddaten". In the section itself the list above
 * is the rule, and these headings are not on it. This list serves the change
 * log: a change to one of these headings is left out of every record, also of
 * one whose "Grunddaten" does not show the heading.
 */
export const INSOLVENCY_DEBTOR_HEADINGS = [
  'Name Schuldner:in',
  'Firmenbuchnummer',
  'Adresse',
  'PLZ, Ort',
] as const

/**
 * True for a text that names the debtor or the company register. It catches a
 * debtor heading the API renames, and a change note about the debtor.
 */
function namesDebtor(text: string): boolean {
  return /schuldner|firmenbuch/i.test(text)
}

/** A heading of the other three sections is read unless it names the debtor. */
function isPublicHeading(heading: string): boolean {
  return !namesDebtor(heading)
}

/**
 * Comparable forms of the headings whose changes the change log of a record
 * leaves out: the debtor's headings, and every heading of the record's
 * "Grunddaten" that the reader does not keep.
 */
function privateHeadingKeys(baseItems: readonly unknown[] | null): ReadonlySet<string> {
  const keys = new Set(INSOLVENCY_DEBTOR_HEADINGS.map((heading) => labelKey(heading)))
  for (const item of baseItems ?? []) {
    const heading = headingOf(item)
    if (heading === null || isBaseHeading(heading)) continue
    const key = labelKey(heading)
    if (key !== '') keys.add(key)
  }
  return keys
}

// ── Result ─────────────────────────────────────────────────────────────────

export type InsolvencyTransaction = 'sale' | 'lease' | 'other'

/** A field or section every sampled record has. The health check counts the records that lack one. */
export type InsolvencyMissingPart =
  | 'court'
  | 'caseNumber'
  | 'plz'
  | 'bundesland'
  | typeof BASE_SECTION
  | typeof PROPERTY_SECTION
  | typeof ADMINISTRATOR_SECTION

/** Files of a record that are not offered for download, by reason. */
export interface SkippedFiles {
  /** A declared file or file list no longer has a readable layout or URL field. */
  unreadable: number
  /** The notice marks the file as deleted. */
  deleted: number
  /** The file has another type than PDF. */
  notPdf: number
  /** The file has no URL of this record: another host, another record, or no readable URL. */
  foreignUrl: number
}

/** One record as `parseInsolvencyDetail` reads it. Text is as published, with tidy whitespace. */
export interface InsolvencyDetail {
  recordNumber: number
  /** "Dienststelle" without the court code in brackets, such as "HG Musterstadt". */
  court: string | null
  /** "Aktenzeichen". */
  caseNumber: string | null
  /** "Bekanntmachungsdatum" as "YYYY-MM-DD". */
  publishedAt: string | null
  /** "Letzte Änderung" as "YYYY-MM-DD"; null for a record that was never changed. */
  changedAt: string | null
  /** "Art der Bekanntmachung", such as "Liegenschaft". */
  announcementKind: string | null
  /** "Art der Transaktion". */
  transactionText: string | null
  /** "Veräußerung" is a sale and "Verpachtung" a lease. Any other text, or none, is `other`. */
  transaction: InsolvencyTransaction
  street: string | null
  /** Four digits, or null. */
  plz: string | null
  city: string | null
  /** "Bundesland" of the property, such as "Niederösterreich". */
  bundeslandName: string | null
  /** The app's code for `bundeslandName`; null when the name is missing or unknown. */
  bundesland: Bundesland | null
  /** "Kurzbeschreibung". */
  title: string | null
  /** "Beschreibung", the long text of the notice. */
  description: string | null
  /** "Kategorie(n)", such as "Mietshaus, Hausanteil". */
  categoryLabel: string | null
  /** Codes of the labels the category table knows. */
  categoryCodes: CategoryCode[]
  /** "Grundbuchnummer". */
  grundbuch: string | null
  grundbuchgericht: string | null
  /** "Einlagezahl". */
  ez: string | null
  grundstuecksnr: string | null
  blnr: string | null
  grundstuecksgroesseSqm: number | null
  objektgroesseSqm: number | null
  objektgroesseRaw: string | null
  /** "Wert des Objekts" in euros. */
  valueEur: number | null
  /** What the accessories are, or the text of "Zubehör" when the notice does not say. Their value follows on a second line. */
  zubehoer: string | null
  /** "Weiterführender Link". It can point anywhere, so the app shows it as text. */
  link: string | null
  /** Facts the auction site prints on its Kurzgutachten page. Null when the notice states none of them. */
  facts: KurzgutachtenFacts | null
  administrator: InsolvencyContact | null
  deputy: InsolvencyContact | null
  /**
   * The filled headings of the four sections above, for a list of labels and
   * values. "Grunddaten" gives only the headings the reader keeps. A date
   * reads as "02.11.2026". Administrator and deputy headings carry their
   * section title, as in "Stellvertreter:in: Name".
   */
  rawLabels: Record<string, string>
  documents: DocumentLink[]
  skippedFiles: SkippedFiles
  /**
   * One entry per change: its date in `publishedAt`, the operation ("ADD",
   * "UPDATE" or "DELETE") in `title`, and the name of what changed in `field`.
   * The API's notes on a change are free text that can name the debtor, and
   * nothing tells such a note apart for certain. So an entry keeps neither a
   * value nor the text of a note: `oldValue` and `newValue` are null and
   * `text` is empty. Changes to the debtor's data are left out.
   */
  changeLog: ChangeLogEntry[]
  /** Parts every sampled record has and this one lacks. */
  missing: InsolvencyMissingPart[]
}

/**
 * Reads one record of the JustizOnline API (`edikte/<number>`). Sections are
 * found by title and values by heading, because element ids differ per record.
 * A missing part stays null and is named in `missing`. The parser throws only
 * for an answer that is not a record, or for the record of another number.
 */
export function parseInsolvencyDetail(json: unknown, recordNumber: number): InsolvencyDetail {
  const envelope = InsolvencyDetailEnvelopeSchema.safeParse(json)
  if (!envelope.success) {
    throw new AppError(
      'site_changed',
      withIssueFields('The JustizOnline record has an unknown layout', envelope.error),
    )
  }
  const { id, sections: published } = envelope.data.edikt
  if (id !== recordNumber) {
    throw new AppError(
      'site_changed',
      `JustizOnline answered with record ${id} instead of record ${recordNumber}`,
    )
  }
  const sections = readSections(published)
  const baseItems = listItems(sections, BASE_SECTION)
  const baseValues = listValues(baseItems, isBaseHeading)
  const propertyValues = listValues(listItems(sections, PROPERTY_SECTION), isPublicHeading)
  const administratorValues = listValues(
    listItems(sections, ADMINISTRATOR_SECTION),
    isPublicHeading,
  )
  const deputyValues = listValues(listItems(sections, DEPUTY_SECTION), isPublicHeading)
  // Typed by the kept headings, so no field can ask "Grunddaten" for another one.
  const base: (heading: BaseHeading) => string | null = lookupIn(baseValues)
  const property = lookupIn(propertyValues)

  const rawLabels: Record<string, string> = {}
  addRawLabels(rawLabels, baseValues)
  addRawLabels(rawLabels, propertyValues)
  addRawLabels(rawLabels, administratorValues, `${ADMINISTRATOR_SECTION}: `)
  addRawLabels(rawLabels, deputyValues, `${DEPUTY_SECTION}: `)

  const court = courtName(firstLine(base('Dienststelle')))
  const caseNumber = firstLine(base('Aktenzeichen'))
  const transactionText = base('Art der Transaktion')
  const plz = postcode(property('PLZ'))
  const bundeslandName = property('Bundesland')
  const bundesland = bundeslandFor(bundeslandName)
  const categoryLabel = property('Kategorie(n)')?.split('\n').join(', ') ?? null
  const objektgroesse = property('Objektgröße')
  // Each of these is null when the record lacks it.
  const required: ReadonlyArray<readonly [InsolvencyMissingPart, unknown]> = [
    ['court', court],
    ['caseNumber', caseNumber],
    ['plz', plz],
    ['bundesland', bundesland],
    [BASE_SECTION, baseValues],
    [PROPERTY_SECTION, propertyValues],
    [ADMINISTRATOR_SECTION, administratorValues],
  ]
  return {
    recordNumber,
    court,
    caseNumber,
    publishedAt: mapValue(base('Bekanntmachungsdatum'), localDateOf),
    changedAt: mapValue(base('Letzte Änderung'), localDateOf),
    announcementKind: base('Art der Bekanntmachung'),
    transactionText,
    transaction: transactionFor(transactionText),
    street: property('Straße'),
    plz,
    city: property('Ort'),
    bundeslandName,
    bundesland,
    title: property('Kurzbeschreibung'),
    description: property('Beschreibung'),
    categoryLabel,
    categoryCodes: categoryCodesFor(categoryLabel),
    grundbuch: property('Grundbuchnummer'),
    grundbuchgericht: property('Grundbuchgericht'),
    ez: property('Einlagezahl'),
    grundstuecksnr: property('Grundstücksnr.'),
    blnr: property('BLNr.'),
    grundstuecksgroesseSqm: mapValue(property('Grundstücksgröße'), extractSqm),
    objektgroesseSqm: mapValue(objektgroesse, extractSqm),
    objektgroesseRaw: objektgroesse,
    valueEur: mapValue(property('Wert des Objekts'), euroAmount),
    zubehoer: accessories(property),
    link: property('Weiterführender Link'),
    facts: readFacts(property),
    administrator: readContact(administratorValues),
    deputy: readContact(deputyValues),
    rawLabels,
    ...readDocuments(sections, recordNumber),
    changeLog: readChangeLog(sections, privateHeadingKeys(baseItems)),
    missing: required.filter(([, found]) => found === null).map(([part]) => part),
  }
}

// ── Sections and list values ───────────────────────────────────────────────

interface Section {
  /** Comparable form of the title, see `labelKey`. */
  key: string
  /** Title as published. */
  title: string
  elements: InsolvencyElement[]
  unreadableFiles: number
}

/** The sections and elements the parser can read. Anything else is passed over. */
function readSections(published: readonly unknown[]): Section[] {
  const sections: Section[] = []
  for (const candidate of published) {
    const section = InsolvencySectionSchema.safeParse(candidate)
    if (!section.success) continue
    const title = normalizeSpace(section.data.title)
    const key = labelKey(title)
    const elements: InsolvencyElement[] = []
    let unreadableFiles = 0
    for (const element of section.data.elements) {
      const parsed = InsolvencyElementSchema.safeParse(element)
      if (parsed.success) elements.push(parsed.data)
      else if (isFileSection(key) || isDeclaredFileList(element)) unreadableFiles += 1
    }
    sections.push({ key, title, elements, unreadableFiles })
  }
  return sections
}

/**
 * The items of every LIST element in the sections with this title, in
 * published order and not yet read. Null when the record has no such section.
 */
function listItems(sections: readonly Section[], title: string): unknown[] | null {
  const key = labelKey(title)
  const matching = sections.filter((section) => section.key === key)
  if (matching.length === 0) return null
  return matching
    .flatMap((section) => section.elements)
    .flatMap((element) => (element.type === 'LIST' ? element.items : []))
}

/** Reads the heading of a LIST item and nothing else. */
const ListHeadingSchema = InsolvencyListItemSchema.pick({ heading: true })

/** The heading of a LIST item with tidy whitespace. Null for an item without one. */
function headingOf(item: unknown): string | null {
  const parsed = ListHeadingSchema.safeParse(item)
  return parsed.success ? emptyToNull(normalizeSpace(parsed.data.heading)) : null
}

interface ListValue {
  /** Heading as published. */
  heading: string
  /** The value as published. */
  value: string
  /** The value as a raw label shows it: a date for a value from `textDate`. */
  label: string
}

/**
 * The filled items among `items` whose heading `keeps` accepts. Of any other
 * item only the heading is read, never the value. Null stays null.
 */
function listValues(
  items: readonly unknown[] | null,
  keeps: (heading: string) => boolean,
): ListValue[] | null {
  if (items === null) return null
  const values: ListValue[] = []
  for (const candidate of items) {
    const heading = headingOf(candidate)
    if (heading === null || !keeps(heading)) continue
    const item = InsolvencyListItemSchema.safeParse(candidate)
    if (!item.success) continue
    const text = publishedText(item.data.text)
    if (text !== null) {
      values.push({ heading, value: text, label: text })
      continue
    }
    const date = publishedText(item.data.textDate)
    if (date !== null) values.push({ heading, value: date, label: displayDate(date) ?? date })
  }
  return values
}

/**
 * "2026-11-02T09:30:00" gives "02.11.2026": the date as the notice shows it,
 * with the digits as written. Null for a text that is no date.
 */
function displayDate(text: string): string | null {
  const date = localDateOf(text)
  return date === null ? null : `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`
}

type Lookup = (heading: string) => string | null

/** Finds a value by heading. The first filled item of a repeated heading wins. */
function lookupIn(values: readonly ListValue[] | null): Lookup {
  const byKey = new Map<string, string>()
  for (const { heading, value } of values ?? []) {
    const key = labelKey(heading)
    if (!byKey.has(key)) byKey.set(key, value)
  }
  return (heading) => byKey.get(labelKey(heading)) ?? null
}

/** Adds values under `prefix` and their heading. A repeated key keeps every value, one per line. */
function addRawLabels(
  target: Record<string, string>,
  values: readonly ListValue[] | null,
  prefix = '',
): void {
  for (const { heading, label } of values ?? []) {
    const key = `${prefix}${heading}`
    const existing = target[key]
    target[key] = existing === undefined ? label : `${existing}\n${label}`
  }
}

// ── Fields ─────────────────────────────────────────────────────────────────

function mapValue<T>(text: string | null, parse: (text: string) => T | null): T | null {
  return text === null ? null : parse(text)
}

function firstLine(text: string | null): string | null {
  return emptyToNull(text?.split('\n')[0])
}

function emptyToNull(text: string | undefined): string | null {
  return text === undefined || text === '' ? null : text
}

/** "HG Musterstadt (099)" gives "HG Musterstadt": the court without its code. */
function courtName(text: string | null): string | null {
  return text === null ? null : emptyToNull(text.replace(/\s*\(\d*\)$/, ''))
}

function postcode(text: string | null): string | null {
  return text !== null && /^\d{4}$/.test(text) ? text : null
}

/** The app's code for a name such as "Niederösterreich". */
function bundeslandFor(name: string | null): Bundesland | null {
  if (name === null) return null
  const key = labelKey(name)
  return (
    BundeslandSchema.options.find((code) => labelKey(BUNDESLAND_SITE_NAMES[code]) === key) ?? null
  )
}

const SALE = labelKey('Veräußerung')
const LEASE = labelKey('Verpachtung')

function transactionFor(text: string | null): InsolvencyTransaction {
  const key = text === null ? '' : labelKey(text)
  if (key === SALE) return 'sale'
  return key === LEASE ? 'lease' : 'other'
}

/**
 * "€ 135 000,00" gives 135000. The API groups thousands with no-break spaces,
 * so every kind of whitespace is removed before the amount is read.
 */
function euroAmount(text: string): number | null {
  return extractEur(text.replace(/\s+/g, ''))
}

function accessories(property: Lookup): string | null {
  // "Zubehör" only says whether there are accessories. The description says what they are.
  const parts = [
    property('Beschreibung des Zubehörs') ?? property('Zubehör'),
    property('Wert des Zubehörs'),
  ]
  const stated = parts.filter((part): part is string => part !== null)
  return stated.length === 0 ? null : stated.join('\n')
}

const USE_PERMIT = 'Benützungsbewilligung'

/** The facts an auction states on its Kurzgutachten page. This notice states them itself. */
function readFacts(property: Lookup): KurzgutachtenFacts | null {
  const usePermit = property(USE_PERMIT)
  const facts: KurzgutachtenFacts = {
    anschluesse: property('Anschlüsse'),
    baubewilligung: property('Baubewilligung'),
    widmung: property('Widmung'),
    bestandsverhaeltnisse: property('Bestandsverhältnisse'),
    stichtag: null,
    lasten: property('Lasten'),
    erstelltVon: null,
    other: usePermit === null ? {} : { [USE_PERMIT]: usePermit },
  }
  const stated = [
    facts.anschluesse,
    facts.baubewilligung,
    facts.widmung,
    facts.bestandsverhaeltnisse,
    facts.lasten,
    usePermit,
  ]
  return stated.some((text) => text !== null) ? facts : null
}

const MAILTO = /^mailto:/i

/** Null for a record without the section, and for a section that names nobody. */
function readContact(values: readonly ListValue[] | null): InsolvencyContact | null {
  if (values === null) return null
  const value = lookupIn(values)
  const contact: InsolvencyContact = {
    name: value('Name'),
    address: value('Anschrift'),
    phone: value('Telefon'),
    fax: value('Fax'),
    email: mailAddress(value('E-Mail')),
  }
  return Object.values(contact).every((part) => part === null) ? null : contact
}

/** "mailto:kanzlei@example.at" gives "kanzlei@example.at". Any other text stays as it is. */
function mailAddress(text: string | null): string | null {
  if (text === null || !MAILTO.test(text)) return text
  // A mail link can carry a subject after "?".
  const [address = ''] = text.replace(MAILTO, '').split('?')
  return emptyToNull(address.trim())
}

// ── Files ──────────────────────────────────────────────────────────────────

const REPORT_SECTIONS: ReadonlySet<string> = new Set(
  ['Gutachten', 'Gutachten / Texte'].map((title) => labelKey(title)),
)
const PHOTO_SECTION = labelKey('Fotos')
const OTHER_DOCUMENTS_SECTION = labelKey('Weitere Dokumente')

function isFileSection(key: string): boolean {
  return REPORT_SECTIONS.has(key) || key === PHOTO_SECTION || key === OTHER_DOCUMENTS_SECTION
}

function isDeclaredFileList(element: unknown): boolean {
  return (
    typeof element === 'object' &&
    element !== null &&
    'type' in element &&
    element.type === 'FILE_LIST'
  )
}

// A report section can also hold photos ("Fotos zum Gutachten") and annexes
// ("Beilage zum Gutachten"). Only the report itself is offered for analysis.
// The word that comes first in the name decides: "Gutachten samt Beilagen" is
// the report, "Beilage zum Gutachten" is an annex.
const REPORT_SECTION_WORD =
  /gutachten|(?<photo>foto|lichtbild|bild)|(?<annex>beilage|anhang|anhänge|anlage)/i
// Drawings among the further documents: "Plan" at the start of a word, the
// compounds listed here, and "Grundriss". "Sanierungsplan" and "Zahlungsplan"
// are papers of the insolvency, not drawings.
const PLAN_NAME =
  /(?<![\p{L}\p{N}])pl[aä]n|(?:lage|bau|einreich|bestands|kataster|teilungs|übersichts)pl[aä]n|grundri(?:ss|ß)/iu
/** Title of a file the notice lists without a name, in a section without a title. */
const UNNAMED_FILE = 'Dokument'

/** The kind of a file in a report section. A name without any of the words is the report. */
function reportSectionKind(name: string): DocumentKind {
  const word = REPORT_SECTION_WORD.exec(name)?.groups
  if (word?.photo !== undefined) return 'photo'
  return word?.annex !== undefined ? 'other' : 'langgutachten'
}

function documentKind(sectionKey: string, name: string): DocumentKind {
  if (REPORT_SECTIONS.has(sectionKey)) return reportSectionKind(name)
  if (sectionKey === PHOTO_SECTION) return 'photo'
  return sectionKey === OTHER_DOCUMENTS_SECTION && PLAN_NAME.test(name) ? 'plan' : 'other'
}

/** The PDFs of every FILE_LIST element, without duplicates, and a count of the files left out. */
function readDocuments(
  sections: readonly Section[],
  recordNumber: number,
): Pick<InsolvencyDetail, 'documents' | 'skippedFiles'> {
  const found = new Map<string, DocumentLink>()
  const skippedFiles: SkippedFiles = { deleted: 0, notPdf: 0, foreignUrl: 0, unreadable: 0 }
  for (const section of sections) {
    skippedFiles.unreadable += section.unreadableFiles
    for (const element of section.elements) {
      if (element.type !== 'FILE_LIST') continue
      for (const candidate of element.items) {
        const file = InsolvencyFileItemSchema.safeParse(candidate)
        if (file.success && file.data.deleted === true) {
          skippedFiles.deleted += 1
          continue
        }
        // The API states the type. A file without one still has to pass the PDF check of the download.
        if (file.success && file.data.mimeType != null && !isPdfType(file.data.mimeType)) {
          skippedFiles.notPdf += 1
          continue
        }
        if (!file.success || file.data.fileUrl == null) {
          skippedFiles.unreadable += 1
          continue
        }
        const url = insolvencyFileUrl(file.data.fileUrl, recordNumber)
        if (url === null) {
          skippedFiles.foreignUrl += 1
          continue
        }
        if (found.has(url)) continue
        const label = publishedText(file.data.fileName)
        const title = (label === null ? section.title : normalizeSpace(label)) || UNNAMED_FILE
        found.set(url, {
          kind: documentKind(section.key, title.normalize('NFC')),
          title,
          fileName: pdfFileName(title),
          url,
          statedSizeKb: sizeKb(file.data.fileSize),
        })
      }
    }
  }
  return { documents: [...found.values()], skippedFiles }
}

function isPdfType(mimeType: string): boolean {
  return mimeType.split(';')[0]?.trim().toLowerCase() === 'application/pdf'
}

/**
 * File name for a label: "Gutachten" gives "Gutachten.pdf". The download step
 * makes the name safe for the file system and keeps only what follows the last
 * slash, so a slash in a label becomes a hyphen here.
 */
function pdfFileName(title: string): string {
  const name = title.replace(/[/\\]+/g, '-')
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`
}

function sizeKb(bytes: number | null | undefined): number | null {
  return bytes == null || bytes < 0 ? null : Math.ceil(bytes / 1024)
}

// ── History ────────────────────────────────────────────────────────────────

/**
 * The API's name for the address group of the property section. A change note
 * can start with it, so it counts as a subject of every record.
 */
const ADDRESS_GROUP = 'Adressdaten'

/** Reads the operation and the field of a history item and nothing else. */
const HistoryFieldSchema = InsolvencyHistoryItemSchema.pick({ operation: true, fieldId: true })

/** Reads the note of a history item and nothing else. */
const HistoryNoteSchema = InsolvencyHistoryItemSchema.pick({ textDe: true })

/**
 * True when `key` starts with `name` and the name ends where a word ends.
 * Both are comparable forms, see `labelKey`.
 */
function startsWithName(key: string, name: string): boolean {
  return key.startsWith(name) && !/^[\p{L}\p{N}]/u.test(key.slice(name.length))
}

/** True for the field of a change that the change log leaves out. */
function isPrivateField(field: string, privateKeys: ReadonlySet<string>): boolean {
  return privateKeys.has(labelKey(field)) || namesDebtor(field)
}

/**
 * True for a change note that the change log leaves out. The API writes a note
 * as "<heading> von <old> auf <new> geändert", so a note about a private
 * heading starts with that heading. The heading has to end where a word ends:
 * "Adresse von …" is such a note, "Adressdaten von …" is not.
 */
function isPrivateNote(note: string, privateKeys: ReadonlySet<string>): boolean {
  if (namesDebtor(note)) return true
  const key = labelKey(note)
  for (const heading of privateKeys) {
    if (startsWithName(key, heading)) return true
  }
  return false
}

/**
 * What a change note of a record can be about: the public headings of the
 * property, administrator and deputy sections, filled or not, the kept
 * "Grunddaten" headings, the titles of the record's sections, and the address
 * group. The map leads from the comparable form of a name to its published
 * spelling.
 */
function noteSubjects(sections: readonly Section[]): ReadonlyMap<string, string> {
  const headings = [PROPERTY_SECTION, ADMINISTRATOR_SECTION, DEPUTY_SECTION]
    .flatMap((title) => listItems(sections, title) ?? [])
    .map((item) => headingOf(item))
    .filter((heading): heading is string => heading !== null && isPublicHeading(heading))
  const names = [
    ...headings,
    ...BASE_HEADINGS,
    ...sections.map((section) => section.title),
    ADDRESS_GROUP,
  ]
  const subjects = new Map<string, string>()
  for (const name of names) {
    const key = labelKey(name)
    if (key !== '' && !subjects.has(key)) subjects.set(key, name)
  }
  return subjects
}

/**
 * The subject of the note of a history item: the longest of `subjects` the
 * note starts with, in its published spelling. Null for an item without a
 * note, for a private note, and for a note that starts with no known subject.
 * The rest of the note is not used.
 */
function noteSubject(
  item: unknown,
  privateKeys: ReadonlySet<string>,
  subjects: ReadonlyMap<string, string>,
): string | null {
  const parsed = HistoryNoteSchema.safeParse(item)
  if (!parsed.success || parsed.data.textDe == null) return null
  // The API sets "von", "auf" and "geändert" in <b> tags. A space takes the
  // place of each tag, so a tag that touches a word cannot join two words.
  const note = parsed.data.textDe.replace(/<\/?[a-z][^<>]*>/gi, ' ')
  if (isPrivateNote(note, privateKeys)) return null
  const key = labelKey(note)
  let found: string | null = null
  let length = 0
  for (const [subject, spelling] of subjects) {
    if (subject.length > length && startsWithName(key, subject)) {
      found = spelling
      length = subject.length
    }
  }
  return found
}

/**
 * One entry per kept item of every HISTORY row, in published order. The API's
 * notes are free text that can name the debtor, and nothing tells such a note
 * apart for certain. A field name such as "PLZ" can belong to the property or
 * to the debtor. So an entry holds the date, the operation and the name of
 * what changed, and never a value or the text of a note.
 *
 * An item names what changed in `fieldId`, and is left out when that field is
 * private. An item without a `fieldId` describes the change in a note. Its
 * name is the subject the note starts with, see `noteSubject`, and the item is
 * left out when the note gives none.
 */
function readChangeLog(
  sections: readonly Section[],
  privateKeys: ReadonlySet<string>,
): ChangeLogEntry[] {
  const subjects = noteSubjects(sections)
  const entries: ChangeLogEntry[] = []
  for (const element of sections.flatMap((section) => section.elements)) {
    if (element.type !== 'HISTORY') continue
    for (const candidate of element.rows) {
      const row = InsolvencyHistoryRowSchema.safeParse(candidate)
      if (!row.success) continue
      const publishedAt = mapValue(row.data.changeDateTime ?? null, localDateOf)
      for (const item of row.data.items) {
        const change = HistoryFieldSchema.safeParse(item)
        if (!change.success) continue
        const fieldId = publishedText(change.data.fieldId)
        if (fieldId !== null && isPrivateField(fieldId, privateKeys)) continue
        // Only an item without a field has its note read, and only for its subject.
        const field = fieldId ?? noteSubject(item, privateKeys, subjects)
        if (field === null) continue
        entries.push({
          publishedAt,
          title: publishedText(change.data.operation) ?? '',
          field,
          oldValue: null,
          newValue: null,
          text: '',
        })
      }
    }
  }
  return entries
}
