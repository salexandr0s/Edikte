import { useTranslation } from 'react-i18next'
import type { EdictSource } from '@shared/enums'
import { SegmentedControl } from '../../components/ui/segmented-control'

export function SourceSwitch({
  sources,
  onChange,
}: {
  sources: readonly EdictSource[]
  onChange: (sources: EdictSource[]) => void
}) {
  const { t } = useTranslation()
  return (
    <SegmentedControl<EdictSource | 'all'>
      aria-label={t('listings.sources.label')}
      size="sm"
      value={sources.length === 1 ? (sources[0] ?? 'all') : 'all'}
      onValueChange={(source) => onChange(source === 'all' ? [] : [source])}
      segments={[
        { value: 'all', label: t('listings.sources.all') },
        { value: 'court_auction', label: t('edictSource.court_auction') },
        { value: 'insolvency_sale', label: t('edictSource.insolvency_sale') },
      ]}
    />
  )
}
