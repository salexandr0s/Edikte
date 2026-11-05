import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/ui/button'
import { Card } from '../../../components/ui/card'
import { RefreshIcon } from '../../../components/ui/icons'
import { Spinner } from '../../../components/ui/spinner'
import { cx } from '../../../lib/cx'
import { useFormat } from '../../../lib/format'
import { lastChecked } from './provider-logic'
import { ProviderRow } from './provider-row'
import { useProviders } from './use-providers'

export function ProvidersCard() {
  const { t } = useTranslation()
  const format = useFormat()
  const providers = useProviders('list')
  const checkedAt = providers.list === null ? null : lastChecked(providers.list)

  return (
    <Card
      title={t('providers.title')}
      actions={
        <Button
          variant="outline"
          size="sm"
          loading={providers.detecting}
          onClick={() => void providers.detect()}
        >
          <RefreshIcon />
          {t('providers.checkAgain')}
        </Button>
      }
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm text-fg-muted">{t('providers.intro')}</p>
        {checkedAt !== null && (
          <p className="text-xs text-fg-muted">
            {t('providers.lastChecked', { time: format.timestamp(checkedAt) })}
          </p>
        )}
      </div>
      {providers.error !== null && (
        <p role="alert" className="mt-4 text-sm text-danger-text">
          {t(`errors.${providers.error}`)}
        </p>
      )}
      {providers.list === null && providers.error === null && (
        <p className="mt-4 flex items-center gap-2 text-sm text-fg-muted">
          <Spinner />
          {t('common.loading')}
        </p>
      )}
      {providers.list !== null && (
        <ul className="mt-5 flex flex-col gap-3">
          {providers.list.map((status) => (
            <li
              key={status.id}
              className={cx(
                'rounded-md border p-4 transition-colors duration-160',
                status.selected ? 'border-accent-subtle bg-accent-soft' : 'border-border',
              )}
            >
              <ProviderRow status={status} apply={providers.apply} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}
