import { createHash } from 'node:crypto'

/**
 * SHA-256 of a JSON value with object keys sorted at every level, so equal
 * payloads hash equally whatever their key order. Ported from immoradar
 * packages/scraper-core/src/capture/content-hash.ts.
 */
export function computeContentHash(payload: unknown): string {
  return createHash('sha256').update(stableStringify(payload), 'utf8').digest('hex')
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, nested: unknown) => {
    if (nested === null || typeof nested !== 'object' || Array.isArray(nested)) return nested
    const record = nested as Record<string, unknown>
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(record).sort()) sorted[key] = record[key]
    return sorted
  })
}
