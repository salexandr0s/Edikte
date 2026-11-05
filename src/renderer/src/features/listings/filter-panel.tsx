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
import { Checkbox, Field, Input } from '../../components/ui/field'
import {
  ChipGroup,
  DateRangeFilter,
  NumberFilter,
  RadioChoice,
  RangeFilter,
} from './filter-controls'
import { showsBezirke } from './query-helpers'

interface FilterPanelProps {
  id: string
  hidden: boolean
  query: ListingQuery
  onChange: (patch: Partial<ListingQuery>) => void
  onReset: () => void
}

/**
 * Every field of the listing query. A column beside the table from 1280 px;
 * narrower windows show it above the table, in two or three columns.
 */
export function FilterPanel({ id, hidden, query, onChange, onReset }: FilterPanelProps) {
  const { t } = useTranslation()
  const titleId = `${id}-title`

  return (
    <section
      id={id}
      hidden={hidden}
      aria-labelledby={titleId}
      className="rounded-lg border border-border bg-surface p-4 xl:w-72 xl:shrink-0"
    >
      <h2 id={titleId} className="sr-only">
        {t('filters.title')}
      </h2>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-3 xl:grid-cols-1">
        <Field label={t('filters.search')}>
          {(control) => (
            <Input
              {...control}
              type="search"
              size="sm"
              maxLength={200}
              placeholder={t('filters.searchPlaceholder')}
              value={query.text}
              onChange={(event) => onChange({ text: event.target.value })}
            />
          )}
        </Field>

        <RadioChoice
          label={t('filters.priceBasis')}
          options={PriceBasisSchema.options.map((value) => ({
            value,
            label: t(`priceBasis.${value}`),
          }))}
          value={query.priceBasis}
          onChange={(priceBasis) => onChange({ priceBasis })}
        />

        <div className="flex min-w-0 flex-col gap-3">
          <NumberFilter
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
        </div>

        <RangeFilter
          label={t('filters.price')}
          help={t('filters.priceHelp')}
          min={query.minPrice}
          max={query.maxPrice}
          onChange={({ min, max }) => onChange({ minPrice: min, maxPrice: max })}
        />

        <RangeFilter
          label={t('filters.area')}
          min={query.minArea}
          max={query.maxArea}
          onChange={({ min, max }) => onChange({ minArea: min, maxArea: max })}
        />

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

        <ChipGroup
          label={t('filters.propertyTypes')}
          options={PropertyTypeSchema.options.map((value) => ({
            value,
            label: t(`propertyType.${value}`),
          }))}
          selected={query.propertyTypes}
          onChange={(propertyTypes) => onChange({ propertyTypes })}
        />

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
          label={t('filters.auctionDate')}
          min={query.auctionFrom}
          max={query.auctionTo}
          onChange={({ min, max }) => onChange({ auctionFrom: min, auctionTo: max })}
        />

        <ChipGroup
          label={t('filters.riskLevels')}
          options={RiskLevelSchema.options.map((value) => ({
            value,
            label: t(`riskLevel.${value}`),
          }))}
          selected={query.riskLevels}
          onChange={(riskLevels) => onChange({ riskLevels })}
        />

        <div className="flex min-w-0 flex-col gap-3">
          <Checkbox
            label={t('filters.analyzedOnly')}
            checked={query.analyzedOnly}
            onChange={(event) => onChange({ analyzedOnly: event.target.checked })}
          />
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
        </div>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        <Button variant="outline" size="sm" onClick={onReset}>
          {t('filters.reset')}
        </Button>
      </div>
    </section>
  )
}
