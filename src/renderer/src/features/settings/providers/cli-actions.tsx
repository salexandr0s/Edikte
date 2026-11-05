import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { CliProviderId, ProviderStatus } from '@shared/providers'
import { Button } from '../../../components/ui/button'
import { AlertIcon } from '../../../components/ui/icons'
import { invoke } from '../../../lib/bridge'
import { SigningIn } from './signing-in'
import type { ProviderAction } from './use-provider-action'

interface CliActionsProps {
  provider: CliProviderId
  status: ProviderStatus
  action: ProviderAction
  cancel: ProviderAction
}

/**
 * The user's own Claude or Codex CLI. Main opens the file dialog for "Choose
 * file"; the renderer never sends a path. Sign-in runs the CLI's own login.
 */
export function CliActions({ provider, status, action, cancel }: CliActionsProps) {
  const { t } = useTranslation()
  const busy = action.busy !== null

  if (status.state === 'signing_in' || action.busy === 'connect') {
    return <SigningIn provider={provider} cancel={cancel} />
  }

  const chooseFile = (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      loading={action.busy === 'choosePath'}
      onClick={() =>
        void action.run('choosePath', () => invoke('providers:chooseCliPath', { provider }))
      }
    >
      {t('providers.cli.chooseFile')}
    </Button>
  )

  let message: ReactNode = null
  let primary: ReactNode = null
  switch (status.state) {
    case 'not_installed':
      message = <p className="text-sm text-fg-muted">{t('providers.cli.notInstalled')}</p>
      primary = chooseFile
      break
    case 'update_required':
      message = (
        <p className="flex items-start gap-2 text-sm text-warning-text">
          <AlertIcon className="mt-0.5" />
          {t('providers.cli.updateRequired')}
        </p>
      )
      primary = chooseFile
      break
    case 'signed_out':
      message = <p className="text-sm text-fg-muted">{t('providers.cli.signInHint')}</p>
      primary = (
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            void action.run('connect', () => invoke('providers:connect', { provider }))
          }
        >
          {t('providers.cli.signIn')}
        </Button>
      )
      break
    case 'error':
      primary = chooseFile
      break
    default:
      break
  }

  const resetPath = status.binaryPathSource === 'override' && (
    <Button
      variant="ghost"
      size="sm"
      disabled={busy}
      loading={action.busy === 'resetPath'}
      onClick={() =>
        void action.run('resetPath', () => invoke('providers:resetCliPath', { provider }))
      }
    >
      {t('providers.cli.useDetected')}
    </Button>
  )

  if (message === null && primary === null && resetPath === false) return null
  return (
    <div className="flex flex-col gap-3">
      {message}
      {(primary !== null || resetPath !== false) && (
        <div className="flex flex-wrap gap-2">
          {primary}
          {resetPath}
        </div>
      )}
    </div>
  )
}
