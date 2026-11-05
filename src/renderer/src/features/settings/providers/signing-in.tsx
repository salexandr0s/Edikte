import { useTranslation } from 'react-i18next'
import type { ProviderId } from '@shared/providers'
import { Button } from '../../../components/ui/button'
import { Spinner } from '../../../components/ui/spinner'
import { invoke } from '../../../lib/bridge'
import type { ProviderAction } from './use-provider-action'

interface SigningInProps {
  provider: ProviderId
  /** Separate from the row's action: Cancel must work while a connect request is open. */
  cancel: ProviderAction
}

/** Shown while the provider's sign-in waits for the browser. */
export function SigningIn({ provider, cancel }: SigningInProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span role="status" className="flex items-center gap-2 text-sm text-fg-muted">
        <Spinner />
        {t('providers.signingIn')}
      </span>
      <Button
        variant="outline"
        size="sm"
        loading={cancel.busy !== null}
        onClick={() =>
          void cancel.run('cancel', () => invoke('providers:cancelConnect', { provider }))
        }
      >
        {t('common.cancel')}
      </Button>
    </div>
  )
}
