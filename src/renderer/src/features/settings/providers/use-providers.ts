import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppErrorCode } from '@shared/errors'
import type { ProviderStatus } from '@shared/providers'
import { errorCode, invoke } from '../../../lib/bridge'
import { useBridgeEvent } from '../../../lib/use-bridge-event'
import { applyProviderUpdate, sortProviders, type ProviderUpdate } from './provider-logic'

export interface ProvidersState {
  /** Null until the first answer arrives. */
  list: ProviderStatus[] | null
  /** Why the last list or detection request failed. */
  error: AppErrorCode | null
  detecting: boolean
  /** Runs detection again; it can take a few seconds. */
  detect: () => Promise<void>
  /** Takes the answer of a provider channel. */
  apply: (update: ProviderUpdate) => void
}

/**
 * Provider statuses for one screen. Loads the last known statuses (`list`) or
 * runs a detection (`detect`) on mount, then follows `providers:changed`.
 */
export function useProviders(onMount: 'list' | 'detect'): ProvidersState {
  const [list, setList] = useState<ProviderStatus[] | null>(null)
  const [error, setError] = useState<AppErrorCode | null>(null)
  const [detecting, setDetecting] = useState(onMount === 'detect')
  // Counts providers:changed events, so an answer that left main before the
  // latest event does not replace the newer list.
  const events = useRef(0)

  useBridgeEvent('providers:changed', (next) => {
    events.current += 1
    setList(sortProviders(next))
  })

  useEffect(() => {
    let ignore = false
    const seen = events.current
    const request = onMount === 'detect' ? invoke('providers:detect') : invoke('providers:list')
    void request.then(
      (next) => {
        if (ignore) return
        if (events.current === seen) setList(sortProviders(next))
        setError(null)
        setDetecting(false)
      },
      (caught: unknown) => {
        if (ignore) return
        setError(errorCode(caught))
        setDetecting(false)
      },
    )
    return () => {
      ignore = true
    }
  }, [onMount])

  const detect = useCallback(async () => {
    setDetecting(true)
    setError(null)
    const seen = events.current
    try {
      const next = await invoke('providers:detect')
      if (events.current === seen) setList(sortProviders(next))
    } catch (caught) {
      setError(errorCode(caught))
    } finally {
      setDetecting(false)
    }
  }, [])

  const apply = useCallback((update: ProviderUpdate) => {
    setList((current) => applyProviderUpdate(current, update))
  }, [])

  return { list, error, detecting, detect, apply }
}
