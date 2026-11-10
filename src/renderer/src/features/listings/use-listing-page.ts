import { useEffect, useRef, useState } from 'react'
import type { ListingPage, ListingQuery } from '@shared/domain'
import type { AppErrorCode } from '@shared/errors'
import { errorCode, invoke } from '../../lib/bridge'
import { useBridgeEvent } from '../../lib/use-bridge-event'
import { onlyTypedFieldsChanged } from './query-helpers'

/** Typing in the search field or a number filter waits this long before the list is queried. */
const TYPING_DELAY_MS = 300
/** Bursts of listings:changed events (one per analysis step) cause one refetch. */
const REFRESH_DELAY_MS = 100

export interface ListingPageState {
  /** The latest answer; it stays while a newer query loads. */
  page: ListingPage | null
  /** The number of the query `page` answers, counting from 1. */
  pageRequest: number
  /** How many queries have been sent so far. */
  requestsSent: () => number
  /** Set when the latest query failed. */
  error: AppErrorCode | null
  loading: boolean
  /** The page answers this query and no newer request is loading or failed. */
  settled: boolean
  reload: () => void
}

/**
 * Queries main whenever the query changes and when main reports changed
 * listings. Each run ignores the answer of the run before it, so a slow
 * response never replaces a newer one.
 */
export function useListingPage(query: ListingQuery): ListingPageState {
  const [answer, setAnswer] = useState<{
    page: ListingPage
    request: number
    query: ListingQuery
  } | null>(null)
  const [error, setError] = useState<AppErrorCode | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshes, setRefreshes] = useState(0)
  const previous = useRef<{ query: ListingQuery; refreshes: number } | null>(null)
  const sent = useRef(0)

  useEffect(() => {
    const last = previous.current
    previous.current = { query, refreshes }
    let wait = 0
    if (last !== null && onlyTypedFieldsChanged(last.query, query)) wait = TYPING_DELAY_MS
    else if (last?.query === query && last.refreshes !== refreshes) wait = REFRESH_DELAY_MS

    let ignore = false
    const timer = window.setTimeout(() => {
      setLoading(true)
      sent.current += 1
      const request = sent.current
      invoke('listings:query', query).then(
        (result) => {
          if (ignore) return
          setAnswer({ page: result, request, query })
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

  return {
    page: answer?.page ?? null,
    pageRequest: answer?.request ?? 0,
    requestsSent: () => sent.current,
    error,
    loading,
    settled: answer?.query === query && !loading && error === null,
    reload,
  }
}
