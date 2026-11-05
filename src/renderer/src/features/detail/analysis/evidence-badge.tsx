import { useTranslation } from 'react-i18next'
import type { EvidenceStatus } from '@shared/analysis-schema'
import { Badge, type BadgeVariant } from '../../../components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../../components/ui/tooltip'

const VARIANTS: Readonly<Record<EvidenceStatus, BadgeVariant>> = {
  verified: 'success',
  wrong_page: 'success',
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
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className="rounded-full">
          <Badge size="sm" variant={VARIANTS[status]}>
            <span className="sr-only">{`${t('evidence.prefix')} `}</span>
            {t(`evidence.status.${status}.label`)}
          </Badge>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top">{t(`evidence.status.${status}.hint`)}</TooltipContent>
    </Tooltip>
  )
}
