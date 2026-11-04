import { useTranslation } from 'react-i18next'
import { EmptyState } from '../../components/ui/empty-state'

// Placeholder for the listings screen. The e2e smoke test reads its h1.
export function ListingsScreen() {
  const { t } = useTranslation()
  return (
    <div className="px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t('listings.title')}</h1>
      <EmptyState title={t('listings.empty')} />
    </div>
  )
}
