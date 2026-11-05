import { useState } from 'react'
import type { AppErrorCode } from '@shared/errors'
import { useToast } from '../../../components/ui/toast'
import { errorCode } from '../../../lib/bridge'
import type { ProviderUpdate } from './provider-logic'

export type ProviderActionName =
  'connect' | 'cancel' | 'disconnect' | 'select' | 'choosePath' | 'resetPath' | 'apiKey' | 'model'

export interface ProviderActionError {
  action: ProviderActionName
  code: AppErrorCode
}

export interface ProviderAction {
  /** The request in flight; the row disables its controls meanwhile. */
  busy: ProviderActionName | null
  error: ProviderActionError | null
  /** Runs a provider request, applies its answer and returns whether it worked. */
  run: (
    name: ProviderActionName,
    request: () => Promise<ProviderUpdate>,
    success?: { title: string; description?: string },
  ) => Promise<boolean>
  clearError: () => void
}

/** One request at a time for a provider row, with its failure kept for display. */
export function useProviderAction(apply: (update: ProviderUpdate) => void): ProviderAction {
  const toast = useToast()
  const [busy, setBusy] = useState<ProviderActionName | null>(null)
  const [error, setError] = useState<ProviderActionError | null>(null)

  const run: ProviderAction['run'] = async (name, request, success) => {
    setBusy(name)
    setError(null)
    try {
      apply(await request())
      if (success !== undefined) toast({ kind: 'success', ...success })
      return true
    } catch (caught) {
      const code = errorCode(caught)
      // A cancelled sign-in or file dialog is the user's choice, not a failure.
      if (code !== 'cancelled') setError({ action: name, code })
      return false
    } finally {
      setBusy(null)
    }
  }

  return { busy, error, run, clearError: () => setError(null) }
}
