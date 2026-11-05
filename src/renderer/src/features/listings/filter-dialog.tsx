import { useId, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListingQuery } from '@shared/domain'
import {
  BundeslandSchema,
  ListingStatusSchema,
  PriceBasisSchema,
  PropertyTypeSchema,
  RiskLevelSchema,
} from '@shared/enums'
import { WIEN_BEZIRKE } from '@shared/wien-bezirke'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { Checkbox, Input } from '../../components/ui/field'
import { Spinner } from '../../components/ui/spinner'
import {
  ChipGroup,
  DateRangeFilter,
  NumberFilter,
  RangeFilter,
  SegmentedChoice,
} from './filter-controls'
import { showsBezirke } from './query-helpers'

interface FilterDialogProps {
  /** The toolbar button. The dialog renders in its place and portals its panel. */
  trigger: ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
  query: ListingQuery
  onChange: (patch: Partial<ListingQuery>) => void
  onReset: () => void
  activeCount: number
  /** Auctions the query matches, or null until the first page has loaded. */
  matches: number | null
  loading: boolean
}

/**
 * Every field of the listing query, in sections with the section name on the
 * left. Changes apply to the list at once; the footer counts what matches.
 */
export function FilterDialog({
  trigger,
  open,
  onOpenChange,
  query,
  onChange,
  onReset,
  activeCount,
  matches,
  loading,
}: FilterDialogProps) {
  const { t } = useTranslation()

  return (
    <Dialog
      trigger={trigger}
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={t('filters.title')}
      description={t('filters.dialogHint')}
      footer={
        <>
          <p aria-live="polite" className="mr-auto flex items-center gap-2 text-sm text-fg-muted">
            {matches !== null && <span>{t('filters.matches', { count: matches })}</span>}
            {loading && <Spinner />}
          </p>
          <Button variant="outline" disabled={activeCount === 0} onClick={onReset}>
            {t('filters.reset')}
          </Button>
          <Button onClick={() => onOpenChange(false)}>{t('filters.done')}</Button>
        </>
      }
    >
      <div className="flex flex-col divide-y divide-border">
        <FilterSection title={t('filters.sections.search')}>
          <Input
            type="search"
            aria-label={t('filters.search')}
            maxLength={200}
            placeholder={t('filters.searchPlaceholder')}
            value={query.text}
            onChange={(event) => onChange({ text: event.target.value })}
          />
        </FilterSection>

        <FilterSection title={t('filters.sections.price')}>
          <SegmentedChoice
            label={t('filters.priceBasis')}
            options={PriceBasisSchema.options.map((value) => ({
              value,
              label: t(`priceBasis.${value}`),
            }))}
            value={query.priceBasis}
            onChange={(priceBasis) => onChange({ priceBasis })}
          />
          <RangeFilter
            className="max-w-sm"
            label={t('filters.price')}
            help={t('filters.priceHelp')}
            min={query.minPrice}
            max={query.maxPrice}
            onChange={({ min, max }) => onChange({ minPrice: min, maxPrice: max })}
          />
          <NumberFilter
            className="max-w-48"
            label={t('filters.maxPricePerSqm')}
            value={query.maxPricePerSqm}
            positive
            onChange={(maxPricePerSqm) => onChange({ maxPricePerSqm })}
          />
          <Checkbox
            label={t('filters.includeWithoutArea')}
            description={t('filters.includeWithoutAreaHelp')}
            checked={query.includeWithoutArea}
            onChange={(event) => onChange({ includeWithoutArea: event.target.checked })}
          />
        </FilterSection>

        <FilterSection title={t('filters.sections.area')}>
          <RangeFilter
            className="max-w-sm"
            label={t('filters.area')}
            min={query.minArea}
            max={query.maxArea}
            onChange={({ min, max }) => onChange({ minArea: min, maxArea: max })}
          />
        </FilterSection>

        <FilterSection title={t('filters.sections.location')}>
          <ChipGroup
            label={t('filters.bundeslaender')}
            options={BundeslandSchema.options.map((value) => ({
              value,
              label: t(`bundesland.${value}`),
            }))}
            selected={query.bundeslaender}
            // A hidden district filter would still restrict the list, so it goes too.
            onChange={(bundeslaender) =>
              onChange({
                bundeslaender,
                bezirke: showsBezirke(bundeslaender) ? query.bezirke : [],
              })
            }
          />
          {showsBezirke(query.bundeslaender) && (
            <ChipGroup
              label={t('filters.bezirke')}
              options={WIEN_BEZIRKE.map(({ number, name }) => ({
                value: number,
                label: t('bezirk.short', { number }),
                fullLabel: t('bezirk.full', { number, name }),
              }))}
              selected={query.bezirke}
              onChange={(bezirke) => onChange({ bezirke })}
            />
          )}
        </FilterSection>

        <FilterSection title={t('filters.sections.property')}>
          <ChipGroup
            hideLabel
            label={t('filters.propertyTypes')}
            options={PropertyTypeSchema.options.map((value) => ({
              value,
              label: t(`propertyType.${value}`),
            }))}
            selected={query.propertyTypes}
            onChange={(propertyTypes) => onChange({ propertyTypes })}
          />
        </FilterSection>

        <FilterSection title={t('filters.sections.auction')}>
          <ChipGroup
            label={t('filters.statuses')}
            options={ListingStatusSchema.options.map((value) => ({
              value,
              label: t(`listingStatus.${value}`),
            }))}
            selected={query.statuses}
            onChange={(statuses) => onChange({ statuses })}
          />
          <DateRangeFilter
            className="max-w-sm"
            label={t('filters.auctionDate')}
            min={query.auctionFrom}
            max={query.auctionTo}
            onChange={({ min, max }) => onChange({ auctionFrom: min, auctionTo: max })}
          />
        </FilterSection>

        <FilterSection title={t('filters.sections.analysis')}>
          <ChipGroup
            label={t('filters.riskLevels')}
            options={RiskLevelSchema.options.map((value) => ({
              value,
              label: t(`riskLevel.${value}`),
            }))}
            selected={query.riskLevels}
            onChange={(riskLevels) => onChange({ riskLevels })}
          />
          <Checkbox
            label={t('filters.analyzedOnly')}
            checked={query.analyzedOnly}
            onChange={(event) => onChange({ analyzedOnly: event.target.checked })}
          />
        </FilterSection>

        <FilterSection title={t('filters.sections.marks')}>
          <Checkbox
            label={t('filters.starredOnly')}
            checked={query.starredOnly}
            onChange={(event) => onChange({ starredOnly: event.target.checked })}
          />
          <Checkbox
            label={t('filters.showHidden')}
            checked={query.showHidden}
            onChange={(event) => onChange({ showHidden: event.target.checked })}
          />
        </FilterSection>
      </div>
    </Dialog>
  )
}

/** A section name on the left and its controls on the right. */
function FilterSection({ title, children }: { title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section
      aria-labelledby={id}
      className="grid grid-cols-[10rem_minmax(0,1fr)] gap-x-8 py-5 first:pt-0 last:pb-0"
    >
      <h3 id={id} className="text-sm font-semibold text-fg">
        {title}
      </h3>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  )
}
