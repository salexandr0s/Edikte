import { useTranslation } from 'react-i18next'
import type { ProviderStatus } from '@shared/providers'
import { Button } from '../../../components/ui/button'
import { AlertIcon } from '../../../components/ui/icons'
import { invoke } from '../../../lib/bridge'
import { ApiKeyActions } from './api-key-actions'
import { CliActions } from './cli-actions'
import { ModelPicker } from './model-picker'
import { OauthActions } from './oauth-actions'
import { ProviderDetails } from './provider-details'
import { ProviderHeading } from './provider-heading'
import { isApiKeyProvider, isCliProvider, type ProviderUpdate } from './provider-logic'
import { useProviderAction, type ProviderAction } from './use-provider-action'

interface RowProps {
  status: ProviderStatus
  apply: (update: ProviderUpdate) => void
}

/** A provider in Settings with every action its kind and state allow. */
export function ProviderRow({ status, apply }: RowProps) {
  const { t } = useTranslation()
  const action = useProviderAction(apply)
  const cancel = useProviderAction(apply)
  const id = status.id
  // The API-key form shows its own failure next to the field.
  const failure = [action.error, cancel.error].find(
    (error) => error !== null && error.action !== 'apiKey',
  )

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <ProviderHeading status={status} />
        <SelectionControl status={status} action={action} />
      </div>
      {status.state === 'error' && (
        <p className="flex items-center gap-2 text-sm text-danger-text">
          <AlertIcon />
          {t('providers.checkFailed')}
        </p>
      )}
      <ProviderDetails status={status} />
      {isCliProvider(id) ? (
        <CliActions provider={id} status={status} action={action} cancel={cancel} />
      ) : isApiKeyProvider(id) ? (
        <ApiKeyActions provider={id} status={status} action={action} />
      ) : (
        <OauthActions status={status} action={action} cancel={cancel} />
      )}
      {status.state === 'ready' && <ModelPicker status={status} action={action} />}
      {failure != null && (
        <p role="alert" className="text-sm text-danger-text">
          {t(`errors.${failure.code}`)}
        </p>
      )}
    </div>
  )
}

/** A provider in the first-run list: state, account and "Use for analysis". */
export function ProviderSummary({ status, apply }: RowProps) {
  const { t } = useTranslation()
  const action = useProviderAction(apply)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <ProviderHeading status={status} />
        <SelectionControl status={status} action={action} />
      </div>
      <ProviderDetails status={status} compact />
      {action.error !== null && (
        <p role="alert" className="text-sm text-danger-text">
          {t(`errors.${action.error.code}`)}
        </p>
      )}
    </div>
  )
}

/** "Use for analysis" on ready providers; "Stop using" on the one in use. */
function SelectionControl({ status, action }: { status: ProviderStatus; action: ProviderAction }) {
  const { t } = useTranslation()
  const provider = status.id
  const name = t(`providerName.${provider}`)
  const busy = action.busy !== null

  if (status.selected) {
    const cli = isCliProvider(provider)
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        loading={action.busy === 'select'}
        onClick={() =>
          void action.run(
            'select',
            // For a CLI, disconnect only stops the app from using it; the CLI stays signed in.
            () =>
              cli
                ? invoke('providers:disconnect', { provider })
                : invoke('providers:select', { provider: null }),
            cli
              ? {
                  title: t('providers.noLongerUsed', { provider: name }),
                  description: t('providers.cli.staysSignedIn'),
                }
              : { title: t('providers.noLongerUsed', { provider: name }) },
          )
        }
      >
        {t('providers.stopUsing')}
      </Button>
    )
  }

  if (status.state !== 'ready') return null
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={busy}
      loading={action.busy === 'select'}
      onClick={() =>
        void action.run('select', () => invoke('providers:select', { provider }), {
          title: t('providers.nowUsed', { provider: name }),
        })
      }
    >
      {t('providers.useForAnalysis')}
    </Button>
  )
}
