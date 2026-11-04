import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button'
import { useApp } from '../../lib/app-context'

// Placeholder for the listing detail screen.
export function DetailScreen({ id }: { id: string }) {
  const { t } = useTranslation()
  const { navigate } = useApp()
  return (
    <div className="flex flex-col items-start gap-4 px-6 py-8">
      <Button variant="ghost" onClick={() => navigate({ screen: 'listings' })}>
        {t('common.back')}
      </Button>
      <p className="font-mono text-sm text-fg-muted">{id}</p>
    </div>
  )
}
