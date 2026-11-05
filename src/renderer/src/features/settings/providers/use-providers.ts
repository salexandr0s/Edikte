import { useCallback, useEffect, useState } from 'react'
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

  useBridgeEvent('providers:changed', (next) => setList(sortProviders(next)))

  useEffect(() => {
    let ignore = false
    const request = onMount === 'detect' ? invoke('providers:detect') : invoke('providers:list')
    void request.then(
      (next) => {
        if (ignore) return
        setList(sortProviders(next))
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
    try {
      setList(sortProviders(await invoke('providers:detect')))
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
