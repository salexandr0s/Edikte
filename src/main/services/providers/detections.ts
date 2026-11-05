import type { Settings } from '@shared/domain'
import { isAppError } from '@shared/errors'
import {
  PROVIDER_KINDS,
  type ProviderId,
  type ProviderState,
  type ProviderStatus,
} from '@shared/providers'
import type { ProviderDetection } from '../../ai/provider'

function bareDetection(
  id: ProviderId,
  state: ProviderState,
  checkedAt: string | null,
  detail: string | null,
): ProviderDetection {
  return {
    id,
    state,
    version: null,
    binaryPath: null,
    binaryPathSource: null,
    accountLabel: null,
    plan: null,
    detail,
    checkedAt,
  }
}

/** Before the first detection: CLIs count as missing, the others as signed out. */
export function initialDetection(id: ProviderId): ProviderDetection {
  return bareDetection(
    id,
    PROVIDER_KINDS[id] === 'cli' ? 'not_installed' : 'signed_out',
    null,
    null,
  )
}

/** Offline mode never starts a CLI, so it cannot tell whether one is installed. */
export function offlineDetection(id: ProviderId, now: Date): ProviderDetection {
  return bareDetection(id, 'not_installed', now.toISOString(), 'Not checked in offline mode')
}

/** A detection that threw. AppError messages are written to be shown; other messages are not. */
export function failedDetection(id: ProviderId, error: unknown, now: Date): ProviderDetection {
  const detail = isAppError(error) ? error.message : 'Detection failed unexpectedly'
  return bareDetection(id, 'error', now.toISOString(), detail)
}

/** The detection plus what the settings add: selection and the saved model. */
export function toStatus(detection: ProviderDetection, settings: Settings): ProviderStatus {
  return {
    ...detection,
    selected: settings.selectedProvider === detection.id,
    model: settings.models[detection.id] ?? null,
  }
}
