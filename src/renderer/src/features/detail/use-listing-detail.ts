import { useCallback, useEffect, useState } from 'react'
import type { ListingDetail } from '@shared/domain'
import type { AppErrorCode } from '@shared/errors'
import { errorCode, invoke } from '../../lib/bridge'
import { useBridgeEvent } from '../../lib/use-bridge-event'

export type DetailState =
  | { status: 'loading' }
  | { status: 'error'; code: AppErrorCode }
  | { status: 'ready'; detail: ListingDetail }

interface ListingDetailHandle {
  state: DetailState
  /** Loads the listing again and keeps showing the current data meanwhile. */
  reload: () => void
  /** Shows the loading state and tries again, after an error. */
  retry: () => void
}

/**
 * Loads a listing and loads it again whenever main reports a change to it.
 * Each load replaces the previous one, so a late answer to an older request
 * never overwrites a newer one.
 */
export function useListingDetail(id: string): ListingDetailHandle {
  const [state, setState] = useState<DetailState>({ status: 'loading' })
  const [version, setVersion] = useState(0)

  useEffect(() => {
    let current = true
    invoke('listings:get', { id }).then(
      (detail) => {
        if (current) setState({ status: 'ready', detail })
      },
      (error: unknown) => {
        if (!current) return
        // A failed reload keeps the data on screen; the next change tries again.
        setState((previous) =>
          previous.status === 'ready' ? previous : { status: 'error', code: errorCode(error) },
        )
      },
    )
    return () => {
      current = false
    }
  }, [id, version])

  const reload = useCallback(() => setVersion((value) => value + 1), [])

  const retry = useCallback(() => {
    setState({ status: 'loading' })
    setVersion((value) => value + 1)
  }, [])

  useBridgeEvent('listings:changed', ({ edictIds }) => {
    if (edictIds === null || edictIds.includes(id)) reload()
  })

  return { state, reload, retry }
}
