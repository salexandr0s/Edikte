import {
  BundeslandSchema,
  EdictSourceSchema,
  type Bundesland,
  type EdictSource,
} from '@shared/enums'

// Pure helpers for the settings and first-run screens. No DOM access, so the
// unit tests can import them in Node.

export const RETENTION_MIN_DAYS = 1
export const RETENTION_MAX_DAYS = 3650

/** Days to keep documents, or null unless the input is a whole number in range. */
export function parseRetentionDays(input: string): number | null {
  const trimmed = input.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const days = Number(trimmed)
  return days >= RETENTION_MIN_DAYS && days <= RETENTION_MAX_DAYS ? days : null
}

/** The selection after ticking or clearing one Bundesland, in the site's order. */
export function toggleBundesland(
  selected: readonly Bundesland[],
  land: Bundesland,
  checked: boolean,
): Bundesland[] {
  const next = new Set(selected)
  if (checked) next.add(land)
  else next.delete(land)
  return BundeslandSchema.options.filter((option) => next.has(option))
}

/** Source scope in display order, or null when clearing the final source. */
export function toggleSyncSource(
  selected: readonly EdictSource[],
  source: EdictSource,
  checked: boolean,
): EdictSource[] | null {
  const next = new Set(selected)
  if (checked) next.add(source)
  else next.delete(source)
  const sources = EdictSourceSchema.options.filter((option) => next.has(option))
  return sources.length === 0 ? null : sources
}
