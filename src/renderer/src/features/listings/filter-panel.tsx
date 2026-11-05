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
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { Field, Input } from '../../components/ui/field'
import { CloseIcon, SearchIcon } from '../../components/ui/icons'
import { RadioGroup } from '../../components/ui/radio-group'
import { SwitchRow } from '../../components/ui/switch'
import { ChipGroup, DateRangeFilter, NumberFilter, RangeFilter } from './filter-controls'
import { showsBezirke } from './query-helpers'

interface FilterPanelProps {
  id: string
  hidden: boolean
  query: ListingQuery
  activeCount: number
  onChange: (patch: Partial<ListingQuery>) => void
  onReset: () => void
}

/**
 * Every field of the listing query. A column beside the table from 1280 px
 * that stays in view and scrolls on its own; narrower windows show it above
 * the table, in two or three columns.
 */
export function FilterPanel({
  id,
  hidden,
  query,
  activeCount,
  onChange,
  onReset,
}: FilterPanelProps) {
  const { t } = useTranslation()
  const titleId = `${id}-title`

  return (
    <section
      id={id}
      hidden={hidden}
      aria-labelledby={titleId}
      className="flex flex-col rounded-lg border border-border bg-surface shadow-xs xl:sticky xl:top-6 xl:max-h-[calc(100cqh-48px)] xl:w-72 xl:shrink-0 xl:overflow-y-auto"
    >
      <div className="sticky top-0 z-(--edk-z-sticky) flex h-12 shrink-0 items-center justify-between gap-3 border-b border-border bg-surface px-4">
        <h2 id={titleId} className="flex items-center gap-2 text-sm font-semibold">
          {t('filters.title')}
          {activeCount > 0 && (
            <Badge size="sm" variant="primary">
              {t('filters.activeCount', { count: activeCount })}
            </Badge>
          )}
        </h2>
        <Button
          variant="ghost"
          size="sm"
          className="-mr-2 text-fg-muted"
          disabled={activeCount === 0}
          onClick={onReset}
        >
          {t('filters.reset')}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-6 p-4 lg:grid-cols-3 xl:grid-cols-1">
        <Field label={t('filters.search')} hideLabel>
          {(control) => (
            <Input
              {...control}
              type="search"
              size="sm"
              maxLength={200}
              placeholder={t('filters.searchPlaceholder')}
              value={query.text}
              leading={<SearchIcon />}
              trailing={
                query.text !== '' ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-6 text-fg-muted"
                    aria-label={t('filters.clearSearch')}
                    onClick={() => onChange({ text: '' })}
                  >
                    <CloseIcon className="size-3.5" />
                  </Button>
                ) : undefined
              }
              onChange={(event) => onChange({ text: event.target.value })}
            />
          )}
        </Field>

        <RadioGroup
          label={t('filters.priceBasis')}
          options={PriceBasisSchema.options.map((value) => ({
            value,
            label: t(`priceBasis.${value}`),
          }))}
          value={query.priceBasis}
          onValueChange={(priceBasis) => onChange({ priceBasis })}
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
            onCheckedChange={(includeWithoutArea) => onChange({ includeWithoutArea })}
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

        <div className="flex min-w-0 flex-col gap-4 border-t border-border pt-5 xl:col-span-full">
          <SwitchRow
            label={t('filters.analyzedOnly')}
            checked={query.analyzedOnly}
            onCheckedChange={(analyzedOnly) => onChange({ analyzedOnly })}
          />
          <SwitchRow
            label={t('filters.starredOnly')}
            checked={query.starredOnly}
            onCheckedChange={(starredOnly) => onChange({ starredOnly })}
          />
          <SwitchRow
            label={t('filters.showHidden')}
            checked={query.showHidden}
            onCheckedChange={(showHidden) => onChange({ showHidden })}
          />
        </div>
      </div>
    </section>
  )
}
