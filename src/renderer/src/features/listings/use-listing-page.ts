import { useEffect, useMemo, useRef, useState } from 'react'
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
export function useListingPage(query: ListingQuery, active: boolean): ListingPageState {
  const [refreshes, setRefreshes] = useState(0)
  const criteria = useMemo(() => ({ query, refreshes, active }), [query, refreshes, active])
  const [answer, setAnswer] = useState<{
    page: ListingPage
    request: number
    criteria: typeof criteria
  } | null>(null)
  const [failure, setFailure] = useState<{ criteria: typeof criteria; code: AppErrorCode } | null>(
    null,
  )
  const previous = useRef<{ query: ListingQuery; refreshes: number } | null>(null)
  const sent = useRef(0)

  useEffect(() => {
    if (!criteria.active) {
      previous.current = null
      return
    }
    const { query, refreshes } = criteria
    const last = previous.current
    previous.current = { query, refreshes }
    let wait = 0
    if (last !== null && onlyTypedFieldsChanged(last.query, query)) wait = TYPING_DELAY_MS
    else if (last?.query === query && last.refreshes !== refreshes) wait = REFRESH_DELAY_MS

    let ignore = false
    const timer = window.setTimeout(() => {
      sent.current += 1
      const request = sent.current
      invoke('listings:query', query).then(
        (result) => {
          if (ignore) return
          setAnswer({ page: result, request, criteria })
          setFailure(null)
        },
        (failure: unknown) => {
          if (ignore) return
          setFailure({ criteria, code: errorCode(failure) })
        },
      )
    }, wait)
    return () => {
      ignore = true
      window.clearTimeout(timer)
    }
  }, [criteria])

  const reload = () => setRefreshes((count) => count + 1)
  useBridgeEvent('listings:changed', reload, active)

  const error = failure?.criteria === criteria ? failure.code : null
  const settled = active && answer?.criteria === criteria

  return {
    page: answer?.page ?? null,
    pageRequest: answer?.request ?? 0,
    requestsSent: () => sent.current,
    error,
    loading: active && !settled && error === null,
    settled,
    reload,
  }
}
