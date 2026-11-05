import { useEffect, useState } from 'react'
import type { GeocodeProgress } from '@shared/domain'
import { invoke } from '../../lib/bridge'
import { useBridgeEvent } from '../../lib/use-bridge-event'

/**
 * Asks main to look up the addresses that have no map position yet, while the
 * map view is open, and again after the listings changed. Main answers at
 * once and reports the rest as events; a lookup that failed a moment ago is
 * not repeated, so the loop between the events and this hook ends on its own.
 */
export function useGeocode(active: boolean): GeocodeProgress {
  const [progress, setProgress] = useState<GeocodeProgress>({ pending: 0, running: false })
  const [requests, setRequests] = useState(0)

  useEffect(() => {
    if (!active) return
    let ignore = false
    invoke('geocode:run').then(
      (result) => {
        if (!ignore) setProgress(result)
      },
      () => {
        // The map works without positions; the chip shows what is missing.
      },
    )
    return () => {
      ignore = true
    }
  }, [active, requests])

  useBridgeEvent('geocode:progress', setProgress)
  useBridgeEvent('listings:changed', () => setRequests((count) => count + 1))

  return progress
}
