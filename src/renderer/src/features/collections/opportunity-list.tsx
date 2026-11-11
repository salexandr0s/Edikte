import { useTranslation } from 'react-i18next'
import { priceForBasis, pricePerSqm } from '@shared/area'
import type { ListingRow } from '@shared/domain'
import type { PriceBasis } from '@shared/enums'
import type { CollectionItem } from '@shared/notifications'
import { Badge } from '../../components/ui/badge'
import { StarIcon } from '../../components/ui/icons'
import { useFormat } from '../../lib/format'
import { ListingStatusBadge } from '../detail/status-badge'

interface OpportunityListProps {
  items: readonly CollectionItem[]
  onOpen: (item: CollectionItem) => void
  filterNames?: ReadonlyMap<number, string>
  showBothPrices?: boolean
  historical?: boolean
}

/** Shared previews keep dashboard and collection facts on the same price basis. */
export function OpportunityList({
  items,
  onOpen,
  filterNames,
  showBothPrices = false,
  historical = false,
}: OpportunityListProps) {
  return (
    <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <li key={item.discoveryId ?? item.listing.caseKey} className="min-w-0">
          <OpportunityCard
            item={item}
            onOpen={() => onOpen(item)}
            filterNames={filterNames}
            showBothPrices={showBothPrices}
            historical={historical}
          />
        </li>
      ))}
    </ul>
  )
}

function OpportunityCard({
  item,
  onOpen,
  filterNames,
  showBothPrices,
  historical,
}: {
  item: CollectionItem
  onOpen: () => void
  filterNames: ReadonlyMap<number, string> | undefined
  showBothPrices: boolean
  historical: boolean
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const row = item.listing
  const address = [row.street, [row.plz, row.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  const names = item.filterIds
    .map((id) => filterNames?.get(id))
    .filter((name): name is string => name !== undefined)
  const unavailable = historical && (item.current === null || item.current.removedAt !== null)
  const changed = historical && item.current !== null && listingChanged(row, item.current)

  return (
    <article className="flex h-full min-w-0 flex-col gap-3 rounded-md border border-border bg-bg-muted p-4">
      <div className="flex items-start gap-2">
        <button
          type="button"
          data-listing-link={item.current?.id ?? row.id}
          onClick={onOpen}
          title={row.title}
          className="min-w-0 flex-1 rounded-sm text-left text-base font-semibold wrap-break-word underline-offset-4 hover:text-accent-text hover:underline focus-visible:ring-3 focus-visible:ring-ring-soft focus-visible:outline-none"
        >
          <span lang="de" className="line-clamp-2">
            {row.title}
          </span>
        </button>
        {row.starred && (
          <span title={t('collections.starred')} className="shrink-0 text-accent-text">
            <StarIcon filled aria-label={t('collections.starred')} />
          </span>
        )}
      </div>
      <div className="flex flex-col gap-1 text-sm text-fg-muted">
        <p className="wrap-break-word">{address || t(`propertyType.${row.propertyType}`)}</p>
        <span className="text-xs">{t(`edictSource.${row.source}`)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ListingStatusBadge status={row.status} size="sm" />
        {row.analysisStale ? (
          <Badge variant="warning" size="sm">
            {t('collections.analysisStale')}
          </Badge>
        ) : row.analysisStatus !== null ? (
          <Badge
            size="sm"
            variant={
              row.analysisStatus === 'running'
                ? 'primary'
                : row.analysisStatus === 'failed'
                  ? 'danger'
                  : row.analysisStatus === 'done' && row.hasAnalysis
                    ? 'success'
                    : 'default'
            }
          >
            {t(`analysisStatus.${row.analysisStatus}`)}
          </Badge>
        ) : (
          <span className="text-xs text-fg-muted">{t('collections.notAnalyzed')}</span>
        )}
      </div>
      <dl className="flex flex-col gap-2 text-sm">
        {showBothPrices && row.source === 'court_auction' ? (
          <>
            <PriceFact row={row} basis="schaetzwert" />
            <PriceFact row={row} basis="geringstes_gebot" />
          </>
        ) : (
          <PriceFact row={row} basis={row.priceBasis} />
        )}
        <div className="flex flex-wrap justify-between gap-x-3 gap-y-1">
          <dt className="text-fg-muted">{t('collections.area')}</dt>
          <dd className="tabular-nums">
            {row.area === null ? t('common.notStated') : format.sqm(row.area.sqm)}
          </dd>
        </div>
      </dl>
      {row.area === null && (
        <p className="text-xs text-fg-muted">{t('collections.areaUnverified')}</p>
      )}
      {row.source === 'court_auction' && row.auctionAt !== null ? (
        <p className="mt-auto text-sm tabular-nums">
          {t('collections.auction', { date: format.localDateTime(row.auctionAt) })}
        </p>
      ) : row.publishedAt !== null ? (
        <p className="mt-auto text-sm text-fg-muted">
          {t('collections.published', { date: format.localDate(row.publishedAt) })}
        </p>
      ) : null}
      {names.length > 0 && (
        <p className="text-xs text-fg-muted wrap-break-word">
          {t('collections.matches', { names: names.join(', ') })}
        </p>
      )}
      {unavailable ? (
        <p className="text-xs font-medium text-warning-text">{t('collections.unavailable')}</p>
      ) : changed && item.current !== null ? (
        <div className="flex flex-col gap-1 text-xs text-fg-muted">
          <p>{t('collections.updated')}</p>
          <p>
            {t('collections.currentStatus', { status: t(`listingStatus.${item.current.status}`) })}
          </p>
        </div>
      ) : null}
    </article>
  )
}

function PriceFact({ row, basis }: { row: ListingRow; basis: PriceBasis }) {
  const { t } = useTranslation()
  const format = useFormat()
  const price = priceForBasis(basis, row)
  const perSqm = pricePerSqm(price, row.area?.sqm ?? null)
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-fg-muted">{t(`priceBasis.${basis}`)}</dt>
      <dd className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 tabular-nums">
        <span className="font-medium">
          {price === null ? t('common.notStated') : format.eur(price)}
        </span>
        {perSqm !== null && (
          <span className="text-xs text-fg-muted">
            {row.approximate.length > 0 ? '≈ ' : ''}
            {format.eurPerSqm(perSqm)}
          </span>
        )}
      </dd>
    </div>
  )
}

function listingChanged(snapshot: ListingRow, current: ListingRow): boolean {
  return (
    snapshot.id !== current.id ||
    snapshot.status !== current.status ||
    snapshot.schaetzwertEur !== current.schaetzwertEur ||
    snapshot.geringstesGebotEur !== current.geringstesGebotEur ||
    snapshot.area?.sqm !== current.area?.sqm ||
    snapshot.auctionAt !== current.auctionAt
  )
}
