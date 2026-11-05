import { useTranslation } from 'react-i18next'
import type { ListingQuery } from '@shared/domain'
import { Button } from '../../components/ui/button'
import { CloseIcon } from '../../components/ui/icons'
import { useFormat } from '../../lib/format'
import { activeFilters, clearFilter, type ActiveFilter } from './query-helpers'

interface ActiveFilterChipsProps {
  query: ListingQuery
  onChange: (patch: Partial<ListingQuery>) => void
  onReset: () => void
}

/**
 * The filters in force, one chip each, so the list explains itself while the
 * dialog is closed. The cross on a chip takes that filter back to its default.
 */
export function ActiveFilterChips({ query, onChange, onReset }: ActiveFilterChipsProps) {
  const { t } = useTranslation()
  const describe = useFilterLabel()
  const filters = activeFilters(query)
  if (filters.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ul aria-label={t('filters.active.label')} className="flex flex-wrap items-center gap-2">
        {filters.map((filter) => {
          const label = describe(filter)
          return (
            <li
              key={filter.key}
              className="inline-flex h-8 max-w-full items-center gap-1 rounded-full border border-border bg-bg-muted pr-1 pl-3 text-sm text-fg"
            >
              <span className="truncate">{label}</span>
              <button
                type="button"
                aria-label={t('filters.active.remove', { label })}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface hover:text-fg"
                onClick={() => onChange(clearFilter(filter.key))}
              >
                <CloseIcon />
              </button>
            </li>
          )
        })}
      </ul>
      <Button variant="link" onClick={onReset}>
        {t('filters.reset')}
      </Button>
    </div>
  )
}

/** One short label per active filter, in the UI language. */
function useFilterLabel(): (filter: ActiveFilter) => string {
  const { t } = useTranslation()
  const format = useFormat()

  const range = (from: string | null, to: string | null, open: 'upTo' | 'until') => {
    if (from !== null && to !== null) return t('filters.active.range', { from, to })
    if (from !== null) return t('filters.active.from', { value: from })
    return t(`filters.active.${open}`, { value: to ?? '' })
  }
  const money = (value: number | null) => (value === null ? null : format.eur(value))
  const sqm = (value: number | null) => (value === null ? null : format.sqm(value))
  const date = (value: string | null) => (value === null ? null : format.localDate(value))

  return (filter) => {
    switch (filter.key) {
      case 'text':
        return t('filters.active.text', { text: filter.text })
      case 'price':
        return range(money(filter.min), money(filter.max), 'upTo')
      case 'maxPricePerSqm':
        return t('filters.active.upTo', { value: format.eurPerSqm(filter.value) })
      case 'includeWithoutArea':
        return t('filters.active.includeWithoutArea')
      case 'area':
        return range(sqm(filter.min), sqm(filter.max), 'upTo')
      case 'bundeslaender':
        return filter.values.length <= 2
          ? filter.values.map((value) => t(`bundesland.${value}`)).join(', ')
          : t('filters.active.bundeslaender', { count: filter.values.length })
      case 'bezirke':
        return filter.values.length <= 3
          ? t('filters.active.bezirkList', {
              list: filter.values.map((number) => t('bezirk.short', { number })).join(', '),
            })
          : t('filters.active.bezirke', { count: filter.values.length })
      case 'propertyTypes':
        return filter.values.length <= 2
          ? filter.values.map((value) => t(`propertyType.${value}`)).join(', ')
          : t('filters.active.propertyTypes', { count: filter.values.length })
      case 'statuses':
        if (filter.values.length === 0) return t('filters.active.allStatuses')
        return filter.values.length <= 2
          ? filter.values.map((value) => t(`listingStatus.${value}`)).join(', ')
          : t('filters.active.statuses', { count: filter.values.length })
      case 'auctionDate':
        return range(date(filter.from), date(filter.to), 'until')
      case 'riskLevels':
        return t('filters.active.riskLevels', {
          list: filter.values.map((value) => t(`riskLevel.${value}`)).join(', '),
        })
      case 'analyzedOnly':
        return t('filters.analyzedOnly')
      case 'starredOnly':
        return t('filters.starredOnly')
      case 'showHidden':
        return t('filters.active.showHidden')
    }
  }
}
