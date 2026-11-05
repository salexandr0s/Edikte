import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button'
import { AlertIcon } from '../../components/ui/icons'
import { Spinner } from '../../components/ui/spinner'
import { cx } from '../../lib/cx'
import { ProviderSummary } from '../settings/providers/provider-row'
import type { ProvidersState } from '../settings/providers/use-providers'

/**
 * The providers found on this computer. A failed detection shows here and
 * never blocks the setup: analysis is optional.
 */
export function ProvidersStep({ providers }: { providers: ProvidersState }) {
  const { t } = useTranslation()

  if (providers.list === null && providers.detecting) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-fg-muted">
        <Spinner />
        {t('firstRun.providers.detecting')}
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {providers.error !== null && (
        <div
          role="alert"
          className="flex flex-wrap items-start gap-3 rounded-md border border-warning-subtle bg-warning-subtle/40 p-4"
        >
          <AlertIcon className="mt-0.5 text-warning-text" />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-sm">
            <p className="font-medium text-fg">{t('firstRun.providers.detectFailed')}</p>
            <p className="text-fg-muted">{t(`errors.${providers.error}`)}</p>
          </div>
          <Button
            variant="outline"
            size="sm"
            loading={providers.detecting}
            onClick={() => void providers.detect()}
          >
            {t('common.retry')}
          </Button>
        </div>
      )}
      {providers.list !== null && (
        <ul className="flex flex-col gap-3">
          {providers.list.map((status) => (
            <li
              key={status.id}
              className={cx(
                'rounded-md border p-4 transition-colors duration-160',
                status.selected ? 'border-accent-subtle bg-accent-soft' : 'border-border',
              )}
            >
              <ProviderSummary status={status} apply={providers.apply} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
