import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SyncStatus } from '@shared/domain'
import type { AppErrorCode } from '@shared/errors'
import { useToast } from '../../components/ui/toast'
import { errorCode, invoke } from '../../lib/bridge'
import { useBridgeEvent } from '../../lib/use-bridge-event'

export interface SyncControls {
  /** Null until main answers sync:status. */
  status: SyncStatus | null
  /** Set when sync:status failed. */
  error: AppErrorCode | null
  pending: 'start' | 'cancel' | null
  start: () => void
  cancel: () => void
}

/** Sync status from main, kept current by sync:progress events. */
export function useSync(): SyncControls {
  const { t } = useTranslation()
  const toast = useToast()
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [error, setError] = useState<AppErrorCode | null>(null)
  const [pending, setPending] = useState<'start' | 'cancel' | null>(null)
  // Counts progress events, so an answer that left main before the latest
  // event does not replace the newer status.
  const events = useRef(0)

  useEffect(() => {
    let ignore = false
    const seen = events.current
    invoke('sync:status').then(
      (result) => {
        if (ignore || events.current !== seen) return
        setStatus(result)
        setError(null)
      },
      (failure: unknown) => {
        if (!ignore) setError(errorCode(failure))
      },
    )
    return () => {
      ignore = true
    }
  }, [])

  useBridgeEvent('sync:progress', (next) => {
    events.current += 1
    setStatus(next)
    setError(null)
  })

  async function run(action: 'start' | 'cancel') {
    setPending(action)
    const seen = events.current
    try {
      const next =
        action === 'start'
          ? await invoke('sync:start', { full: false })
          : await invoke('sync:cancel')
      if (events.current === seen) setStatus(next)
      setError(null)
    } catch (failure) {
      toast({
        kind: 'error',
        title: action === 'start' ? t('sync.startFailed') : t('sync.cancelFailed'),
        description: t(`errors.${errorCode(failure)}`),
      })
    } finally {
      setPending(null)
    }
  }

  return {
    status,
    error,
    pending,
    start: () => void run('start'),
    cancel: () => void run('cancel'),
  }
}
