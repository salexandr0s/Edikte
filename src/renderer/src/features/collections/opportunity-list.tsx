import { useTranslation } from 'react-i18next'
import { priceForBasis, pricePerSqm } from '@shared/area'
import type { ListingRow } from '@shared/domain'
import { PriceBasisSchema, type PriceBasis } from '@shared/enums'
import type { CollectionItem } from '@shared/notifications'
import { Badge } from '../../components/ui/badge'
import { StarIcon } from '../../components/ui/icons'
import { TILE, TILE_INTERACTIVE } from '../../components/ui/tile'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'
import { publishedPrice } from '../../lib/published-price'
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
    <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
  const priceBasis = publishedPrice(row)?.basis ?? row.priceBasis
  const current = historical ? item.current : null
  const changedPrices =
    current === null
      ? []
      : PriceBasisSchema.options.filter(
          (basis) => priceForBasis(basis, row) !== priceForBasis(basis, current),
        )
  const address = [row.street, [row.plz, row.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ')
  const names = item.filterIds
    .map((id) => filterNames?.get(id))
    .filter((name): name is string => name !== undefined)
  const unavailable = historical && (item.current === null || item.current.removedAt !== null)

  return (
    // The title button stretches over the tile, so the whole tile opens the listing.
    <article
      className={cx(TILE, TILE_INTERACTIVE, 'relative flex h-full min-w-0 flex-col gap-4 p-5')}
    >
      <div className="flex flex-col gap-2">
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
          {row.starred && (
            <span className="ml-auto shrink-0 text-warning-text">
              <StarIcon filled aria-label={t('collections.starred')} />
            </span>
          )}
        </div>
        <button
          type="button"
          data-listing-link={item.current?.id ?? row.id}
          onClick={onOpen}
          title={row.title}
          className="rounded-sm text-left text-base font-semibold wrap-break-word after:absolute after:inset-0 after:rounded-lg focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-ring"
        >
          <span lang="de" className="line-clamp-2">
            {row.title}
          </span>
        </button>
        <p className="text-sm wrap-break-word text-fg-muted">
          {address || t(`propertyType.${row.propertyType}`)}
        </p>
      </div>
      <dl className="flex flex-col gap-2">
        {showBothPrices && row.source === 'court_auction' ? (
          <>
            <PriceFact row={row} basis="schaetzwert" />
            <PriceFact row={row} basis="geringstes_gebot" />
          </>
        ) : (
          <PriceFact row={row} basis={priceBasis} showUnitPrice={priceBasis === row.priceBasis} />
        )}
        <Fact
          label={t('collections.area')}
          value={row.area === null ? null : format.sqm(row.area.sqm)}
          note={row.area === null ? t('collections.areaUnverified') : undefined}
        />
      </dl>
      <div className="mt-auto flex flex-col gap-1 border-t border-border pt-3 text-xs text-fg-muted">
        <p className="flex flex-wrap gap-x-2 text-sm">
          {row.source === 'court_auction' && row.auctionAt !== null ? (
            <span className="text-fg tabular-nums">
              {t('collections.auction', { date: format.localDateTime(row.auctionAt) })}
            </span>
          ) : row.publishedAt !== null ? (
            <span className="tabular-nums">
              {t('collections.published', { date: format.localDate(row.publishedAt) })}
            </span>
          ) : null}
          <span className="ml-auto">{t(`edictSource.${row.source}`)}</span>
        </p>
        {names.length > 0 && (
          <p className="wrap-break-word">{t('collections.matches', { names: names.join(', ') })}</p>
        )}
        {unavailable ? (
          <p className="font-medium text-warning-text">{t('collections.unavailable')}</p>
        ) : current !== null && listingChanged(row, current) ? (
          <>
            <p>
              {t('collections.updated')}{' '}
              {t('collections.currentStatus', { status: t(`listingStatus.${current.status}`) })}
            </p>
            {changedPrices.length > 0 && (
              <div>
                <p className="font-medium">{t('collections.currentPrices')}</p>
                <dl>
                  {changedPrices.map((basis) => (
                    <PriceFact key={basis} row={current} basis={basis} showUnitPrice={false} />
                  ))}
                </dl>
              </div>
            )}
          </>
        ) : null}
      </div>
    </article>
  )
}

function PriceFact({
  row,
  basis,
  showUnitPrice = true,
}: {
  row: ListingRow
  basis: PriceBasis
  showUnitPrice?: boolean
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const price = priceForBasis(basis, row)
  const perSqm = showUnitPrice ? pricePerSqm(price, row.area?.sqm ?? null) : null
  return (
    <Fact
      label={t(`priceBasis.${basis}`)}
      value={price === null ? null : format.eur(price)}
      note={
        perSqm === null
          ? undefined
          : `${row.approximate.length > 0 ? '≈ ' : ''}${format.eurPerSqm(perSqm)}`
      }
    />
  )
}

/** A label on the left, its figure on the right; a missing value reads "not stated". */
function Fact({ label, value, note }: { label: string; value: string | null; note?: string }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="min-w-0 text-sm text-fg-muted">{label}</dt>
      <dd className="flex shrink-0 flex-col items-end tabular-nums">
        {value === null ? (
          <span className="text-sm text-fg-muted">{t('common.notStated')}</span>
        ) : (
          <span className="text-base font-semibold">{value}</span>
        )}
        {note !== undefined && <span className="text-xs text-fg-muted">{note}</span>}
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
