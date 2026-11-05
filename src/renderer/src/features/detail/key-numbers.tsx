import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { priceForBasis, pricePerSqm } from '@shared/area'
import type { ListingDetail } from '@shared/domain'
import { PriceBasisSchema } from '@shared/enums'
import { Badge } from '../../components/ui/badge'
import { Card } from '../../components/ui/card'
import { useFormat } from '../../lib/format'
import { knownZubehoer } from './detail-helpers'
import { Fact } from './fact-list'
import { PageLink } from './page-link'

/** Prices from the edict, the area the €/m² uses, and €/m² for both price bases. */
export function KeyNumbers({ detail }: { detail: ListingDetail }) {
  const { t } = useTranslation()
  const format = useFormat()
  const notStated = t('common.notStated')
  const money = (value: number | null) => (value === null ? notStated : format.eur(value))
  const { area } = detail
  const approximate = detail.approximate.length > 0
  const perLand = area?.kind === 'grundflaeche'
  const zubehoer = detail.zubehoer === null ? null : knownZubehoer(detail.zubehoer)
  const showMeistbot = detail.meistbotEur !== null || detail.status === 'sold'

  return (
    <Card title={t('detail.numbers.title')}>
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
          <Stat label={t('priceBasis.schaetzwert')} value={money(detail.schaetzwertEur)} />
          <Stat label={t('priceBasis.geringstes_gebot')} value={money(detail.geringstesGebotEur)} />
          <Stat label={t('detail.numbers.vadium')} value={money(detail.vadiumEur)} />
          {showMeistbot && (
            <Stat label={t('detail.numbers.meistbot')} value={money(detail.meistbotEur)} />
          )}
        </dl>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-border pt-5 lg:grid-cols-4">
          <Stat
            label={t('detail.numbers.area')}
            value={area === null ? t('detail.numbers.noArea') : format.sqm(area.sqm)}
          >
            {area === null ? (
              t('detail.numbers.noAreaHint')
            ) : (
              <>
                <span>
                  {t(`areaKind.${area.kind}`)} · {t(`areaSource.${area.source}`)}
                </span>
                <PageLink documentId={area.documentId} page={area.page} />
              </>
            )}
          </Stat>
          {PriceBasisSchema.options.map((basis) => {
            const value = pricePerSqm(priceForBasis(basis, detail), area?.sqm ?? null)
            return (
              <Stat
                key={basis}
                label={
                  perLand
                    ? t(`detail.numbers.perSqmLand.${basis}`)
                    : t(`detail.numbers.perSqm.${basis}`)
                }
                value={
                  value === null
                    ? notStated
                    : `${approximate ? '≈ ' : ''}${format.eurPerSqm(value)}`
                }
              />
            )
          })}
          {detail.plotSqm !== null && (
            <Stat label={t('detail.numbers.plot')} value={format.sqm(detail.plotSqm)} />
          )}
        </dl>

        {approximate && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <span>{t('detail.numbers.approximateReasons')}</span>
            {detail.approximate.map((reason) => (
              <Badge key={reason} variant="warning">
                {t(`approximate.${reason}`)}
              </Badge>
            ))}
          </div>
        )}

        {detail.zubehoer !== null && (
          <dl>
            {zubehoer === null ? (
              <Fact label={t('detail.numbers.zubehoer')} lang="de">
                {detail.zubehoer}
              </Fact>
            ) : (
              <Fact label={t('detail.numbers.zubehoer')}>
                {t(`detail.numbers.zubehoerValue.${zubehoer}`)}
              </Fact>
            )}
          </dl>
        )}
      </div>
    </Card>
  )
}

interface StatProps {
  label: string
  value: string
  /** Where the value comes from, shown in small text below it. */
  children?: ReactNode
}

function Stat({ label, value, children }: StatProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="flex flex-col gap-1">
        <span className="text-lg font-semibold tracking-tight tabular-nums">{value}</span>
        {children !== undefined && (
          <span className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
            {children}
          </span>
        )}
      </dd>
    </div>
  )
}
