import { load } from 'cheerio'
import { KurzgutachtenFactsSchema, type KurzgutachtenFacts } from '@shared/domain'
import { AppError } from '@shared/errors'
import { isUnavailable, labelKey, parseSiteDate, rawLabelMap, readPageRows } from './site-text'

type FactKey = Exclude<keyof KurzgutachtenFacts, 'other'>

// Matched against the start of the label key, so small wording changes on the
// site still land in the right field.
const FACT_PREFIXES: ReadonlyArray<readonly [prefix: string, key: FactKey]> = [
  ['anschl', 'anschluesse'],
  ['baubewillig', 'baubewilligung'],
  ['widmung', 'widmung'],
  ['bestandsverh', 'bestandsverhaeltnisse'],
  ['bestandverh', 'bestandsverhaeltnisse'],
  ['stichtag', 'stichtag'],
  ['lasten', 'lasten'],
  ['erstellt von', 'erstelltVon'],
  ['gutachten erstellt von', 'erstelltVon'],
  ['sachverstaendig', 'erstelltVon'],
]

/**
 * Reads the facts of a Kurzgutachten HTML page. Lenient: unknown labels go to
 * `other`, missing ones stay null. Returns null for a page without label rows.
 */
export function parseKurzgutachten(html: string): KurzgutachtenFacts | null {
  const $ = load(html)
  const root = $('#druckbereich').first()
  if (root.length === 0) return null
  const labels = rawLabelMap($, readPageRows($, root).fields)
  if (Object.keys(labels).length === 0) return null
  const facts: KurzgutachtenFacts = {
    anschluesse: null,
    baubewilligung: null,
    widmung: null,
    bestandsverhaeltnisse: null,
    stichtag: null,
    lasten: null,
    erstelltVon: null,
    other: {},
  }
  for (const [label, value] of Object.entries(labels)) {
    const key = factKey(label)
    if (key === null) {
      facts.other[label] = value
      continue
    }
    if (isUnavailable(value)) continue
    // Dates follow the app convention when they parse; anything else stays as published.
    const text = key === 'stichtag' ? (parseSiteDate(value) ?? value) : value
    const existing = facts[key]
    facts[key] = existing === null ? text : `${existing}\n${text}`
  }
  const parsed = KurzgutachtenFactsSchema.safeParse(facts)
  if (!parsed.success) throw new AppError('site_changed', 'Unexpected Kurzgutachten page')
  return parsed.data
}

function factKey(label: string): FactKey | null {
  const key = labelKey(label)
  return FACT_PREFIXES.find(([prefix]) => key.startsWith(prefix))?.[1] ?? null
}
