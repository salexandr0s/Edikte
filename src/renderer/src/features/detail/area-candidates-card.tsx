import { useTranslation } from 'react-i18next'
import type { ListingDetail } from '@shared/domain'
import { Badge } from '../../components/ui/badge'
import { Card } from '../../components/ui/card'
import { useFormat } from '../../lib/format'
import { areaMismatch, isSameArea } from './detail-helpers'
import { Fact, GermanQuote } from './fact-list'
import { PageLink } from './page-link'
import { usePercent } from './use-detail-actions'

/** Every area value known for the listing, with the one the €/m² uses marked. */
export function AreaCandidatesCard({ detail }: { detail: ListingDetail }) {
  const { t } = useTranslation()
  const format = useFormat()
  const percent = usePercent()
  const { area: chosen, areaCandidates, propertyType } = detail

  return (
    <Card title={t('detail.areas.title')}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">{t('detail.areas.intro')}</p>
        {detail.objektgroesseRaw !== null && (
          <dl>
            <Fact label={t('detail.areas.objektgroesse')} lang="de">
              {detail.objektgroesseRaw}
            </Fact>
          </dl>
        )}
        {areaCandidates.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('detail.areas.empty')}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {areaCandidates.map((candidate, index) => {
              const gap = areaMismatch(candidate, chosen, propertyType)
              return (
                <li
                  // Area values have no ID; the list is replaced as a whole on reload.
                  key={index}
                  className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0"
                >
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm font-semibold tabular-nums">
                      {format.sqm(candidate.sqm)}
                    </span>
                    <span className="text-sm">{t(`areaKind.${candidate.kind}`)}</span>
                    <Badge variant="outline" size="sm">
                      {t(`areaSource.${candidate.source}`)}
                    </Badge>
                    {chosen !== null && isSameArea(candidate, chosen) && (
                      <Badge variant="primary" size="sm">
                        {t('detail.areas.chosen')}
                      </Badge>
                    )}
                    {gap !== null && (
                      <Badge variant="warning" size="sm">
                        {t('detail.areas.differs', { percent: percent(gap * 100, true) })}
                      </Badge>
                    )}
                    <PageLink documentId={candidate.documentId} page={candidate.page} />
                  </div>
                  {candidate.quote !== null && <GermanQuote text={candidate.quote} />}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}
