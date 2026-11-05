import { useState } from 'react'
import { useBridgeEvent } from '../../lib/use-bridge-event'
import { EMPTY_TRACKER, trackAnalysis, type AnalysisTracker } from './query-helpers'

/**
 * Latest analysis status per listing from analysis:progress events. The
 * screen stays mounted, so this follows every analysis, filtered or not.
 */
export function useAnalysisTracker(): AnalysisTracker {
  const [tracker, setTracker] = useState(EMPTY_TRACKER)
  useBridgeEvent('analysis:progress', (event) => {
    setTracker((current) => trackAnalysis(current, event))
  })
  return tracker
}
