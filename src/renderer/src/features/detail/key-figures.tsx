import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { priceForBasis, pricePerSqm } from '@shared/area'
import type { ListingDetail } from '@shared/domain'
import { Badge } from '../../components/ui/badge'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'
import { daysUntil, joinPresent } from './detail-helpers'
import { usePercent } from './use-detail-actions'

/**
 * The four numbers that place the auction at a glance: Schätzwert, the bid
 * to beat (or the winning bid once sold), the price per m² on the chosen
 * basis, and the date.
 */
export function KeyFigures({ detail }: { detail: ListingDetail }) {
  const { t } = useTranslation()
  const format = useFormat()
  const percent = usePercent()
  const headingId = useId()
  const notStated = t('common.notStated')
  const money = (value: number | null) => (value === null ? notStated : format.eur(value))

  const { area, schaetzwertEur, geringstesGebotEur } = detail
  const approximate = detail.approximate.length > 0
  const perSqm = pricePerSqm(priceForBasis(detail.priceBasis, detail), area?.sqm ?? null)
  const showMeistbot = detail.meistbotEur !== null || detail.status === 'sold'
  const share =
    schaetzwertEur !== null && schaetzwertEur > 0 && geringstesGebotEur !== null
      ? percent((geringstesGebotEur / schaetzwertEur) * 100)
      : null
  const days = detail.auctionAt === null ? null : daysUntil(detail.auctionAt, new Date())
  const relative =
    days === null || days < 0
      ? null
      : days === 0
        ? t('detail.hero.today')
        : days === 1
          ? t('detail.hero.tomorrow')
          : t('detail.hero.inDays', { count: days })
  const time = detail.auctionAt === null ? null : format.localTime(detail.auctionAt)

  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border border-border bg-surface shadow-xs"
    >
      <h2 id={headingId} className="sr-only">
        {t('detail.numbers.title')}
      </h2>
      <dl className="grid grid-cols-4 divide-x divide-border">
        <Figure
          label={t('priceBasis.schaetzwert')}
          value={money(schaetzwertEur)}
          note={
            detail.vadiumEur === null
              ? null
              : t('detail.hero.vadium', { value: format.eur(detail.vadiumEur) })
          }
        />
        {showMeistbot ? (
          <Figure
            label={t('detail.numbers.meistbot')}
            value={money(detail.meistbotEur)}
            note={
              geringstesGebotEur === null
                ? null
                : t('detail.hero.minimumBid', { value: format.eur(geringstesGebotEur) })
            }
          />
        ) : (
          <Figure
            label={t('priceBasis.geringstes_gebot')}
            value={money(geringstesGebotEur)}
            note={share === null ? null : t('detail.hero.shareOfSchaetzwert', { percent: share })}
          />
        )}
        <Figure
          label={
            area?.kind === 'grundflaeche' ? t('detail.hero.perSqmLand') : t('detail.hero.perSqm')
          }
          value={
            perSqm === null
              ? area === null
                ? t('detail.numbers.noArea')
                : notStated
              : `${approximate ? '≈ ' : ''}${format.eurPerSqm(perSqm)}`
          }
          muted={perSqm === null}
          note={
            area === null
              ? t('detail.numbers.noAreaHint')
              : joinPresent(
                  [
                    t(`detail.hero.basis.${detail.priceBasis}`),
                    `${format.sqm(area.sqm)} ${t(`areaKind.${area.kind}`)}`,
                  ],
                  ' · ',
                )
          }
        />
        <Figure
          label={t('detail.facts.auction')}
          value={
            detail.auctionAt === null ? notStated : format.localDate(detail.auctionAt.slice(0, 10))
          }
          muted={detail.auctionAt === null}
          note={joinPresent([time, relative], ' · ')}
        />
      </dl>
      {approximate && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3 text-xs text-fg-muted">
          <span>{t('detail.numbers.approximateReasons')}</span>
          {detail.approximate.map((reason) => (
            <Badge key={reason} size="sm" variant="warning">
              {t(`approximate.${reason}`)}
            </Badge>
          ))}
        </div>
      )}
    </section>
  )
}

interface FigureProps {
  label: string
  value: string
  /** Where the value comes from or what it means, in small text below it. */
  note?: ReactNode
  /** For a missing value: smaller and muted, so the gap does not shout. */
  muted?: boolean
}

function Figure({ label, value, note, muted = false }: FigureProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-5 py-4">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="flex flex-col gap-0.5">
        <span
          className={cx(
            'wrap-break-word',
            muted
              ? 'text-base font-medium text-fg-muted'
              : 'text-2xl font-semibold tracking-tight text-fg tabular-nums',
          )}
        >
          {value}
        </span>
        {note !== null && note !== undefined && note !== '' && (
          <span className="text-xs text-fg-muted">{note}</span>
        )}
      </dd>
    </div>
  )
}
