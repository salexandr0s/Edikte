import { useTranslation } from 'react-i18next'
import type { ListingQuery } from '@shared/domain'
import { useApp } from '../../lib/app-context'
import { useFilterLabel } from '../listings/active-filter-chips'
import { activeFilters } from '../listings/query-helpers'

/** Uses the same labels as the list's active filters, without editing controls. */
export function SearchCriteriaSummary({ query }: { query: ListingQuery }) {
  const { t } = useTranslation()
  const { settings } = useApp()
  const describe = useFilterLabel()
  const sources = query.sources.length === 0 ? settings.syncSources : query.sources
  const basis =
    sources.length === 1 && sources[0] === 'insolvency_sale' ? 'schaetzwert' : query.priceBasis
  return (
    <ul aria-label={t('alerts.criteria')} className="flex flex-wrap gap-1.5 text-xs text-fg-muted">
      <li className="rounded-sm border border-border bg-bg-muted px-2 py-1">
        {sources.map((source) => t(`edictSource.${source}`)).join(', ')}
      </li>
      <li className="rounded-sm border border-border bg-bg-muted px-2 py-1">
        {t('filters.priceBasis')}: {t(`priceBasis.${basis}`)}
      </li>
      {sources.length > 1 &&
        sources.includes('insolvency_sale') &&
        query.priceBasis === 'geringstes_gebot' && (
          <li className="rounded-sm border border-border bg-bg-muted px-2 py-1">
            {t('alerts.insolvencyBasis')}
          </li>
        )}
      {activeFilters(query).map((filter) => (
        <li
          key={filter.key}
          className="max-w-full rounded-sm border border-border bg-bg-muted px-2 py-1 wrap-break-word"
        >
          {describe(filter)}
        </li>
      ))}
    </ul>
  )
}
