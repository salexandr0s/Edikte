import { useTranslation } from 'react-i18next'
import { PROVIDER_KINDS, type ProviderState, type ProviderStatus } from '@shared/providers'
import { Badge, type BadgeVariant } from '../../../components/ui/badge'
import { CheckIcon } from '../../../components/ui/icons'

const STATE_VARIANTS: Record<ProviderState, BadgeVariant> = {
  ready: 'success',
  not_installed: 'default',
  signed_out: 'default',
  signing_in: 'primary',
  update_required: 'warning',
  identity_only: 'warning',
  error: 'danger',
}

/** The state in words; an API-key provider without a key says "No key". */
export function ProviderStateBadge({ status }: { status: ProviderStatus }) {
  const { t } = useTranslation()
  const noKey = status.state === 'signed_out' && PROVIDER_KINDS[status.id] === 'api_key'
  return (
    <Badge
      variant={STATE_VARIANTS[status.state]}
      dot={status.state === 'signing_in'}
      title={status.state === 'error' ? (status.detail ?? undefined) : undefined}
    >
      {noKey ? t('providers.state.noKey') : t(`providers.state.${status.state}`)}
    </Badge>
  )
}

/** Name, state, "In use" and one line on how the provider works. */
export function ProviderHeading({ status }: { status: ProviderStatus }) {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">{t(`providerName.${status.id}`)}</h3>
        <ProviderStateBadge status={status} />
        {status.selected && (
          <Badge variant="primary">
            <CheckIcon className="size-3" />
            {t('providers.inUse')}
          </Badge>
        )}
      </div>
      <p className="text-sm text-fg-muted">{t(`providers.description.${status.id}`)}</p>
    </div>
  )
}
