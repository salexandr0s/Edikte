import { useTranslation } from 'react-i18next'
import type { ListingStatus } from '@shared/enums'
import { Badge, type BadgeVariant } from '../../components/ui/badge'

const STATUS_VARIANTS: Readonly<Record<ListingStatus, BadgeVariant>> = {
  upcoming: 'primary',
  postponed: 'warning',
  on_offer: 'primary',
  cancelled: 'danger',
  sold: 'success',
  closed: 'default',
}

export function ListingStatusBadge({
  status,
  size,
}: {
  status: ListingStatus
  size?: 'sm' | 'md'
}) {
  const { t } = useTranslation()
  return (
    <Badge variant={STATUS_VARIANTS[status]} size={size}>
      {t(`listingStatus.${status}`)}
    </Badge>
  )
}
