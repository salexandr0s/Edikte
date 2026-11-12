/**
 * A boxed item that sits directly on the page: a search result, a count, a
 * digest. Same frame as card.v1; the element and padding are the caller's.
 */
export const TILE = 'rounded-lg border border-border bg-surface shadow-xs'

/** Added when the whole tile is one click target (card.v1 hover). */
export const TILE_INTERACTIVE =
  'transition-[border-color,background-color,box-shadow] duration-120 hover:border-border-strong hover:bg-surface-hover hover:shadow-sm'
