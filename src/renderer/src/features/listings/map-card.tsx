import { useTranslation } from 'react-i18next'
import { priceForBasis } from '@shared/area'
import type { ListingRow } from '@shared/domain'
import { bezirkName } from '@shared/wien-bezirke'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { ChevronRightIcon, CloseIcon, StarIcon } from '../../components/ui/icons'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'
import { RISK_VARIANT, STATUS_VARIANT, addressLine } from './listing-row'
import type { Pin } from './map-pins'

interface PinCardProps {
  pin: Pin
  onOpen: (row: ListingRow) => void
  onClose: () => void
  className?: string
}

/** The auctions at the chosen pin, each a button to its page. */
export function PinCard({ pin, onOpen, onClose, className }: PinCardProps) {
  const { t } = useTranslation()
  const first = pin.rows[0]
  if (first === undefined) return null
  const districtName = first.bezirk === null ? null : bezirkName(first.bezirk)
  const district =
    first.bezirk !== null && districtName !== null
      ? t('bezirk.full', { number: first.bezirk, name: districtName })
      : null
  const address = addressLine(first, district) ?? t('common.notStated')
  return (
    <section
      aria-label={address}
      className={cx(
        'flex min-h-0 origin-top-left flex-col overflow-hidden rounded-lg border border-border bg-surface-elevated shadow-lg animate-pop-in',
        className,
      )}
    >
      <header className="flex items-start gap-2 border-b border-border py-3 pr-2 pl-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p lang="de" title={address} className="line-clamp-2 text-sm font-semibold hyphens-auto">
            {address}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
            <span>{t('map.atLocation', { count: pin.rows.length })}</span>
            {pin.approximate && (
              <Badge size="sm" variant="outline" title={t('map.approximate')}>
                {t('map.approximateShort')}
              </Badge>
            )}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.close')}
          className="-mt-1 text-fg-muted"
          onClick={onClose}
        >
          <CloseIcon />
        </Button>
      </header>
      <ul className="min-h-0 overflow-y-auto">
        {pin.rows.map((row) => (
          <PinCardRow key={row.id} row={row} onOpen={() => onOpen(row)} />
        ))}
      </ul>
    </section>
  )
}

/** Title with its badges, type and date, then the price and what is known about the area. */
function PinCardRow({ row, onOpen }: { row: ListingRow; onOpen: () => void }) {
  const { t } = useTranslation()
  const format = useFormat()
  const price = priceForBasis(row.priceBasis, row)
  const perSqm =
    row.pricePerSqm === null
      ? null
      : `${row.approximate.length > 0 ? '≈ ' : ''}${format.eurPerSqm(row.pricePerSqm)}`
  const area = [row.area === null ? null : format.sqm(row.area.sqm), perSqm]
    .filter((part): part is string => part !== null)
    .join(' · ')
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        // The shell returns focus here when the user comes back from the listing.
        data-listing-link={row.id}
        onClick={onOpen}
        className="group flex w-full items-center gap-3 py-3 pr-3 pl-4 text-left transition-colors duration-120 hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {row.starred && <StarIcon filled className="size-3.5 shrink-0 text-warning-text" />}
            <span
              lang="de"
              title={row.title}
              className="line-clamp-2 text-sm font-medium hyphens-auto"
            >
              {row.title}
            </span>
            {row.status !== 'upcoming' && (
              <Badge size="sm" variant={STATUS_VARIANT[row.status]}>
                {t(`listingStatus.${row.status}`)}
              </Badge>
            )}
            {row.hasAnalysis && row.riskLevel !== null && (
              <Badge size="sm" variant={RISK_VARIANT[row.riskLevel]}>
                {t('listings.row.risk', { level: t(`riskLevel.${row.riskLevel}`) })}
              </Badge>
            )}
          </span>
          <span className="text-xs text-fg-muted">
            {t(`propertyType.${row.propertyType}`)}
            {row.auctionAt !== null && ` · ${format.localDateTime(row.auctionAt)}`}
          </span>
          <span className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
            {price === null ? (
              <span className="text-sm text-fg-muted">{t('common.notStated')}</span>
            ) : (
              <span className="text-sm font-semibold">{format.eur(price)}</span>
            )}
            {area !== '' && <span className="text-xs text-fg-muted">{area}</span>}
          </span>
        </span>
        <ChevronRightIcon className="shrink-0 text-fg-muted/60 transition-colors duration-120 group-hover:text-fg-muted" />
      </button>
    </li>
  )
}
