import { useTranslation } from 'react-i18next'
import { priceForBasis } from '@shared/area'
import type { ListingRow } from '@shared/domain'
import type { AnalysisStatus, ListingStatus, PriceBasis, RiskLevel } from '@shared/enums'
import { bezirkName } from '@shared/wien-bezirke'
import { Badge, type BadgeVariant } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { EyeIcon, EyeOffIcon, StarIcon } from '../../components/ui/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'

// table.v1: numbers right-aligned. The last row leaves its border to the frame.
const CELL = 'border-b border-border py-3 align-top group-last/row:border-b-0'

export const STATUS_VARIANT: Readonly<Record<ListingStatus, BadgeVariant>> = {
  upcoming: 'primary',
  postponed: 'warning',
  on_offer: 'primary',
  cancelled: 'danger',
  sold: 'default',
  closed: 'outline',
}

export const RISK_VARIANT: Readonly<Record<RiskLevel, BadgeVariant>> = {
  low: 'success',
  medium: 'warning',
  high: 'danger',
}

const ANALYSIS_VARIANT: Readonly<Record<Exclude<AnalysisStatus, 'done'>, BadgeVariant>> = {
  queued: 'default',
  running: 'primary',
  failed: 'danger',
  cancelled: 'outline',
}

interface ListingTableRowProps {
  row: ListingRow
  columnPriceBasis: PriceBasis
  /** From the latest analysis event when there is one, else from the row. */
  analysisStatus: AnalysisStatus | null
  onOpen: () => void
  onStar: () => void
  onToggleHidden: () => void
}

export function ListingTableRow({
  row,
  columnPriceBasis,
  analysisStatus,
  onOpen,
  onStar,
  onToggleHidden,
}: ListingTableRowProps) {
  const { t } = useTranslation()
  const format = useFormat()
  const notStated = t('common.notStated')
  const otherBasis = row.priceBasis === 'schaetzwert' ? 'geringstes_gebot' : 'schaetzwert'
  const price = priceForBasis(row.priceBasis, row)
  const otherPrice = priceForBasis(otherBasis, row)
  const districtName = row.bezirk === null ? null : bezirkName(row.bezirk)
  const district =
    row.bezirk !== null && districtName !== null
      ? t('bezirk.full', { number: row.bezirk, name: districtName })
      : null
  const address = addressLine(row, district)
  const propertyType = t(`propertyType.${row.propertyType}`)
  const auctionTime = row.auctionAt === null ? null : format.localTime(row.auctionAt)
  const place = address === null ? propertyType : `${propertyType} · ${address}`
  const hideLabel = row.hidden
    ? t('listings.row.unhide', { title: row.title })
    : t('listings.row.hide', { title: row.title })

  return (
    <tr
      className={cx(
        'group/row transition-colors duration-120 hover:bg-surface-hover',
        row.hidden && 'opacity-70',
      )}
    >
      <td className={cx(CELL, 'px-1')}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-pressed={row.starred}
          aria-label={t('listings.row.star', { title: row.title })}
          title={t('listings.columns.star')}
          onClick={onStar}
          className={cx(
            row.starred
              ? 'text-warning-text'
              : 'text-fg-muted/60 hover:text-fg-muted group-hover/row:text-fg-muted',
          )}
        >
          <StarIcon filled={row.starred} />
        </Button>
      </td>
      <td className={cx(CELL, 'min-w-36 px-4')}>
        <div className="flex flex-col items-start gap-0.5">
          <button
            type="button"
            // The shell returns focus here when the user comes back from the listing.
            data-listing-link={row.id}
            onClick={onOpen}
            title={row.title}
            // Titles come from the site in German; long compounds break with hyphens.
            lang="de"
            className={cx(
              'line-clamp-2 rounded-sm text-left font-medium hyphens-auto transition-colors duration-120 hover:text-accent-text',
              row.hidden ? 'text-fg-muted' : 'text-fg',
            )}
          >
            {row.title}
          </button>
          <span title={place} className="line-clamp-2 text-xs text-fg-muted">
            {place}
          </span>
          {(row.hidden || row.removedAt !== null) && (
            <span className="mt-1 flex flex-wrap gap-1">
              {row.hidden && (
                <Badge size="sm" variant="outline">
                  {t('listings.row.hidden')}
                </Badge>
              )}
              {row.removedAt !== null && <Badge size="sm">{t('listings.row.removed')}</Badge>}
            </span>
          )}
        </div>
      </td>
      <td className={cx(CELL, 'px-4')}>
        <div className="flex flex-col items-start gap-1">
          {row.source === 'insolvency_sale' ? (
            row.publishedAt === null ? (
              <Missing label={notStated} />
            ) : (
              <span className="text-xs text-fg-muted">
                {t('listings.row.published', { date: format.localDate(row.publishedAt) })}
              </span>
            )
          ) : row.auctionAt === null ? (
            <Missing label={notStated} />
          ) : (
            <span className="flex flex-col tabular-nums">
              <span className="whitespace-nowrap">
                {format.localDate(row.auctionAt.slice(0, 10))}
              </span>
              {auctionTime !== null && <span className="text-xs text-fg-muted">{auctionTime}</span>}
            </span>
          )}
          <Badge
            size="sm"
            variant={STATUS_VARIANT[row.status]}
            title={t(`noticeType.${row.noticeType}`)}
          >
            {t(`listingStatus.${row.status}`)}
          </Badge>
          {row.noticeType !== 'versteigerung' && (
            <span className="text-xs text-fg-muted">{t(`noticeType.${row.noticeType}`)}</span>
          )}
        </div>
      </td>
      <td className={cx(CELL, 'px-4 text-right')}>
        <div className="flex flex-col items-end gap-0.5">
          {price === null ? (
            <Missing label={notStated} />
          ) : (
            <span className="whitespace-nowrap tabular-nums">{format.eur(price)}</span>
          )}
          {row.priceBasis !== columnPriceBasis && (
            <span className="text-xs text-fg-muted">{t(`priceBasis.${row.priceBasis}`)}</span>
          )}
          {row.source === 'court_auction' && otherPrice !== null && (
            <span className="text-xs text-fg-muted">
              {t(`listings.row.otherPrice.${otherBasis}`, { value: format.eur(otherPrice) })}
            </span>
          )}
        </div>
      </td>
      <td className={cx(CELL, 'px-4 text-right')}>
        {row.area === null ? (
          <Missing label={notStated} />
        ) : (
          <div className="flex flex-col items-end gap-0.5">
            <span className="whitespace-nowrap tabular-nums">{format.sqm(row.area.sqm)}</span>
            <span className="text-xs whitespace-nowrap text-fg-muted">
              {t(`listings.row.areaKind.${row.area.kind}`)}
            </span>
            <span className="text-xs whitespace-nowrap text-fg-muted">
              {t('listings.row.areaSource', { source: t(`areaSource.${row.area.source}`) })}
            </span>
          </div>
        )}
      </td>
      <td className={cx(CELL, 'px-4 text-right')}>
        <PricePerSqm row={row} />
      </td>
      <td className={cx(CELL, 'px-4')}>
        <div className="flex flex-col items-start gap-1">
          {row.analysisStale && (
            <Badge size="sm" variant="warning" title={t('listings.row.analysisStaleHint')}>
              {t('listings.row.analysisStale')}
            </Badge>
          )}
          {(!row.analysisStale || (analysisStatus !== null && analysisStatus !== 'done')) && (
            <AnalysisBadge status={analysisStatus} risk={row.riskLevel} />
          )}
        </div>
      </td>
      <td className={cx(CELL, 'px-1')}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={hideLabel}
          title={hideLabel}
          onClick={onToggleHidden}
          // Appears when the pointer is on the row or the button has focus; stays for hidden rows.
          className={cx(
            'text-fg-muted transition-opacity duration-120 group-hover/row:opacity-100 focus-visible:opacity-100',
            !row.hidden && 'opacity-0',
          )}
        >
          {row.hidden ? <EyeIcon /> : <EyeOffIcon />}
        </Button>
      </td>
    </tr>
  )
}

/** €/m², with the reasons in a tooltip when it is approximate. Focus opens it too. */
function PricePerSqm({ row }: { row: ListingRow }) {
  const { t } = useTranslation()
  const format = useFormat()
  if (row.pricePerSqm === null) return <Missing label={t('common.notStated')} />
  const value = format.eurPerSqm(row.pricePerSqm)
  if (row.approximate.length === 0) {
    return <span className="font-semibold whitespace-nowrap tabular-nums">{value}</span>
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="rounded-sm font-semibold whitespace-nowrap tabular-nums underline decoration-fg-muted/60 decoration-dotted underline-offset-4"
        >
          {t('listings.row.approximateValue', { value })}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" align="end" className="max-w-64">
        <p className="font-medium">{t('listings.row.approximate')}</p>
        <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-4 opacity-90">
          {row.approximate.map((reason) => (
            <li key={reason}>{t(`approximate.${reason}`)}</li>
          ))}
        </ul>
      </TooltipContent>
    </Tooltip>
  )
}

function AnalysisBadge({
  status,
  risk,
}: {
  status: AnalysisStatus | null
  risk: RiskLevel | null
}) {
  const { t } = useTranslation()
  if (status === null) return <Missing label={t('listings.row.notAnalyzed')} />
  if (status === 'done') {
    return risk === null ? (
      <Badge size="sm" variant="success">
        {t('analysisStatus.done')}
      </Badge>
    ) : (
      <Badge size="sm" variant={RISK_VARIANT[risk]}>
        {t('listings.row.risk', { level: t(`riskLevel.${risk}`) })}
      </Badge>
    )
  }
  return (
    <Badge size="sm" variant={ANALYSIS_VARIANT[status]} dot={status === 'running'}>
      {t(`analysisStatus.${status}`)}
    </Badge>
  )
}

/** A dash on screen; screen readers hear why the cell is empty. */
function Missing({ label }: { label: string }) {
  return (
    <span className="text-fg-muted/60">
      <span aria-hidden="true">–</span>
      <span className="sr-only">{label}</span>
    </span>
  )
}

/** Street, then postcode and town, or the district when the site named no town. */
export function addressLine(row: ListingRow, district: string | null): string | null {
  const place = [row.plz, row.city].filter((part) => part !== null && part !== '').join(' ')
  const parts = [row.street, place === '' ? district : place].filter(
    (part): part is string => part !== null && part !== '',
  )
  return parts.length === 0 ? null : parts.join(', ')
}
