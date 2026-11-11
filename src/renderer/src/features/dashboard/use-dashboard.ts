import { useEffect, useState } from 'react'
import type { DashboardData } from '@shared/notifications'
import type { AppErrorCode } from '@shared/errors'
import { errorCode, invoke } from '../../lib/bridge'
import { useBridgeEvent } from '../../lib/use-bridge-event'

/** Retains the last successful answer while a refresh or sync is in progress. */
export function useDashboard(filterId: number | null) {
  const [answer, setAnswer] = useState<{ filterId: number | null; data: DashboardData } | null>(
    null,
  )
  const [failure, setFailure] = useState<{ filterId: number | null; code: AppErrorCode } | null>(
    null,
  )
  const [loading, setLoading] = useState(true)
  const [refreshes, setRefreshes] = useState(0)
  const reload = () => setRefreshes((value) => value + 1)

  useEffect(() => {
    let ignore = false
    const timer = window.setTimeout(
      () => {
        setLoading(true)
        invoke('dashboard:get', { filterId }).then(
          (data) => {
            if (ignore) return
            setAnswer({ filterId, data })
            setFailure(null)
            setLoading(false)
          },
          (error: unknown) => {
            if (ignore) return
            setFailure({ filterId, code: errorCode(error) })
            setLoading(false)
          },
        )
      },
      refreshes === 0 ? 0 : 100,
    )
    return () => {
      ignore = true
      window.clearTimeout(timer)
    }
  }, [filterId, refreshes])

  useBridgeEvent('listings:changed', reload)
  useBridgeEvent('filters:changed', reload)
  useBridgeEvent('alerts:changed', reload)
  useBridgeEvent('notifications:changed', reload)
  useBridgeEvent('sync:progress', (status) => {
    if (status.state === 'idle') reload()
  })

  return {
    data: answer?.filterId === filterId ? answer.data : null,
    error: failure?.filterId === filterId ? failure.code : null,
    loading,
    reload,
  }
}
