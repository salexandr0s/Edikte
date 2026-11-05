import { useTranslation } from 'react-i18next'
import type { RelatedEdict } from '@shared/domain'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ExternalLinkIcon } from '../../components/ui/icons'
import { useFormat } from '../../lib/format'
import { joinPresent } from './detail-helpers'
import { ListingStatusBadge } from './status-badge'
import { useOpenExternal } from './use-detail-actions'

/** Other edicts of the same case, such as the first date of a postponed auction. */
export function RelatedCard({ related }: { related: readonly RelatedEdict[] }) {
  const { t } = useTranslation()
  const format = useFormat()
  const openExternal = useOpenExternal()

  return (
    <Card title={t('detail.related.title')}>
      <ul className="flex flex-col divide-y divide-border">
        {related.map((edict) => {
          const notice = t(`noticeType.${edict.noticeType}`)
          const dateParts = [
            edict.publishedAt === null
              ? null
              : t('detail.related.published', { date: format.localDate(edict.publishedAt) }),
            edict.auctionAt === null
              ? null
              : t('detail.related.auction', { date: format.localDateTime(edict.auctionAt) }),
          ]
          const dates = joinPresent(dateParts, ' · ')
          // Edicts of one case often share a notice type; the dates tell the buttons apart.
          const name = joinPresent([notice, ...dateParts], ', ')
          return (
            <li
              key={edict.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{notice}</span>
                  <ListingStatusBadge status={edict.status} size="sm" />
                </div>
                {dates !== '' && <p className="text-xs text-fg-muted">{dates}</p>}
              </div>
              <Button
                size="sm"
                variant="outline"
                aria-label={t('detail.related.openNamed', { edict: name })}
                onClick={() => void openExternal(edict.url)}
              >
                {t('detail.related.open')}
                <ExternalLinkIcon />
              </Button>
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
