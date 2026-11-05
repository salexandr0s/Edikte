import { useTranslation } from 'react-i18next'
import type { ProviderStatus } from '@shared/providers'
import { Button } from '../../../components/ui/button'
import { AlertIcon } from '../../../components/ui/icons'
import { invoke } from '../../../lib/bridge'
import { SigningIn } from './signing-in'
import type { ProviderAction } from './use-provider-action'

interface OauthActionsProps {
  status: ProviderStatus
  action: ProviderAction
  cancel: ProviderAction
}

/** Sign in with ChatGPT: the sign-in runs in the system browser. */
export function OauthActions({ status, action, cancel }: OauthActionsProps) {
  const { t } = useTranslation()
  const provider = status.id
  const busy = action.busy !== null

  if (status.state === 'signing_in' || action.busy === 'connect') {
    return <SigningIn provider={provider} cancel={cancel} />
  }

  const connect = () => void action.run('connect', () => invoke('providers:connect', { provider }))
  const disconnect = (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      loading={action.busy === 'disconnect'}
      onClick={() =>
        void action.run('disconnect', () => invoke('providers:disconnect', { provider }), {
          title: t('providers.disconnected', { provider: t(`providerName.${provider}`) }),
        })
      }
    >
      {t('providers.oauth.disconnect')}
    </Button>
  )

  if (status.state === 'ready') return <div className="flex flex-wrap gap-2">{disconnect}</div>

  if (status.state === 'identity_only') {
    return (
      <div className="flex flex-col gap-3">
        <p className="flex items-start gap-2 text-sm text-warning-text">
          <AlertIcon className="mt-0.5" />
          {t('providers.oauth.identityOnly')}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={connect}>
            {t('providers.oauth.signInAgain')}
          </Button>
          {disconnect}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button size="sm" disabled={busy} onClick={connect}>
        {t('providers.oauth.connect')}
      </Button>
      <span className="text-sm text-fg-muted">{t('providers.oauth.connectHint')}</span>
    </div>
  )
}
