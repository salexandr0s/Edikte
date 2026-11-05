import { Tooltip } from 'radix-ui'
import { useTranslation } from 'react-i18next'
import type { EvidenceStatus } from '@shared/analysis-schema'
import { Badge, type BadgeVariant } from '../../../components/ui/badge'

const VARIANTS: Readonly<Record<EvidenceStatus, BadgeVariant>> = {
  verified: 'success',
  quote_not_found: 'warning',
  number_mismatch: 'warning',
  scanned_page: 'default',
  page_out_of_range: 'warning',
  no_quote: 'default',
}

/**
 * The app's check of a quote, as a badge with a text label. Hovering it or
 * moving keyboard focus to it shows what the status means.
 */
export function EvidenceBadge({ status }: { status: EvidenceStatus }) {
  const { t } = useTranslation()
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button type="button" className="rounded-full">
          <Badge size="sm" variant={VARIANTS[status]}>
            <span className="sr-only">{`${t('evidence.prefix')} `}</span>
            {t(`evidence.status.${status}.label`)}
          </Badge>
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="top"
          sideOffset={6}
          collisionPadding={8}
          className="z-(--edk-z-tooltip) max-w-xs rounded-sm border border-border bg-surface-elevated px-3 py-2 text-xs text-fg shadow-md"
        >
          {t(`evidence.status.${status}.hint`)}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}
