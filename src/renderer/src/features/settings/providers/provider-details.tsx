import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PROVIDER_KINDS, type ProviderStatus } from '@shared/providers'
import { cx } from '../../../lib/cx'

interface Detail {
  term: string
  value: ReactNode
  /** Long values such as paths take a line of their own. */
  wide?: boolean
}

interface ProviderDetailsProps {
  status: ProviderStatus
  /** Account and plan only, for the first-run list. */
  compact?: boolean
}

/** Account, plan and, for CLIs, version and program file. Never a secret: the label is masked. */
export function ProviderDetails({ status, compact = false }: ProviderDetailsProps) {
  const { t } = useTranslation()
  const kind = PROVIDER_KINDS[status.id]
  const details: Detail[] = []

  if (status.accountLabel !== null) {
    const term = kind === 'api_key' ? t('providers.key') : t('providers.account')
    details.push({ term, value: status.accountLabel })
  }
  if (status.plan !== null) details.push({ term: t('providers.plan'), value: status.plan })
  if (!compact && kind === 'cli') {
    if (status.version !== null) {
      details.push({ term: t('providers.version'), value: status.version })
    }
    if (status.binaryPath !== null) {
      details.push({
        term: t('providers.program'),
        wide: true,
        value: (
          <span className="flex flex-col gap-0.5">
            <span className="font-mono text-xs break-all">{status.binaryPath}</span>
            {status.binaryPathSource !== null && (
              <span className="text-xs text-fg-muted">
                {t(`providers.source.${status.binaryPathSource}`)}
              </span>
            )}
          </span>
        ),
      })
    }
  }
  // The detail names the failure, or the missing flags of a CLI that needs an update.
  const showDetail = status.state === 'error' || status.state === 'update_required'
  if (!compact && showDetail && status.detail !== null) {
    details.push({
      term: t('common.details'),
      wide: true,
      value: <span className="font-mono text-xs break-all">{status.detail}</span>,
    })
  }

  if (details.length === 0) return null
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
      {details.map(({ term, value, wide }) => (
        <div key={term} className={cx('flex min-w-0 items-baseline gap-2', wide && 'basis-full')}>
          <dt className="shrink-0 text-fg-muted">{term}</dt>
          <dd className="min-w-0 text-fg">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
