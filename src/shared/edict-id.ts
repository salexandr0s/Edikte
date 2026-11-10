// Edict IDs. A court auction keeps the site's Domino document ID. A sale in
// insolvency proceedings has a JustizOnline record number, stored with an
// `mv-` prefix so that the IDs and document folders of the two never collide.
// An edict's `source` column says where it came from; this module only checks
// the form of an ID.

/** 32 lowercase hex characters, the Domino document ID of a court auction. */
export const AUCTION_EDICT_ID_PATTERN = /^[0-9a-f]{32}$/

/** `mv-` and the JustizOnline record number, without leading zeros. */
export const INSOLVENCY_EDICT_ID_PATTERN = /^mv-[1-9]\d{0,11}$/

/** An ID of either kind. Both forms are safe as a folder name. */
export const EDICT_ID_PATTERN = /^(?:[0-9a-f]{32}|mv-[1-9]\d{0,11})$/

/** True for a JustizOnline record number: a positive integer of at most twelve digits. */
export function isInsolvencyRecordNumber(value: number): boolean {
  return Number.isSafeInteger(value) && INSOLVENCY_EDICT_ID_PATTERN.test(`mv-${value}`)
}

/** The stored ID of a JustizOnline record. */
export function insolvencyEdictId(recordNumber: number): string {
  if (!isInsolvencyRecordNumber(recordNumber)) {
    throw new RangeError(`Not a JustizOnline record number: ${recordNumber}`)
  }
  return `mv-${recordNumber}`
}

/** The JustizOnline record number of a stored ID, or null for an ID of the other kind. */
export function insolvencyRecordNumber(id: string): number | null {
  return INSOLVENCY_EDICT_ID_PATTERN.test(id) ? Number(id.slice(3)) : null
}
