import { useEffect, useRef, useState } from 'react'
import type { ListingPage, ListingQuery } from '@shared/domain'
import type { AppErrorCode } from '@shared/errors'
import { errorCode, invoke } from '../../lib/bridge'
import { useBridgeEvent } from '../../lib/use-bridge-event'
import { onlyTextChanged } from './query-helpers'

/** Typing in the search field waits this long before the list is queried. */
const TEXT_DELAY_MS = 250
/** Bursts of listings:changed events (one per analysis step) cause one refetch. */
const REFRESH_DELAY_MS = 100

export interface ListingPageState {
  /** The latest answer; it stays while a newer query loads. */
  page: ListingPage | null
  /** Set when the latest query failed. */
  error: AppErrorCode | null
  loading: boolean
  reload: () => void
}

/**
 * Queries main whenever the query changes and when main reports changed
 * listings. Each run ignores the answer of the run before it, so a slow
 * response never replaces a newer one.
 */
export function useListingPage(query: ListingQuery): ListingPageState {
  const [page, setPage] = useState<ListingPage | null>(null)
  const [error, setError] = useState<AppErrorCode | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshes, setRefreshes] = useState(0)
  const previous = useRef<{ query: ListingQuery; refreshes: number } | null>(null)

  useEffect(() => {
    const last = previous.current
    previous.current = { query, refreshes }
    let wait = 0
    if (last !== null && onlyTextChanged(last.query, query)) wait = TEXT_DELAY_MS
    else if (last?.query === query && last.refreshes !== refreshes) wait = REFRESH_DELAY_MS

    let ignore = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      invoke('listings:query', query).then(
        (result) => {
          if (ignore) return
          setPage(result)
          setError(null)
          setLoading(false)
        },
        (failure: unknown) => {
          if (ignore) return
          setError(errorCode(failure))
          setLoading(false)
        },
      )
    }, wait)
    return () => {
      ignore = true
      window.clearTimeout(timer)
    }
  }, [query, refreshes])

  const reload = () => setRefreshes((count) => count + 1)
  useBridgeEvent('listings:changed', reload)

  return { page, error, loading, reload }
}
