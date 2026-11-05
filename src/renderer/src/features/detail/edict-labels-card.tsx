import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/card'
import { ChevronDownIcon } from '../../components/ui/icons'
import { Fact, FactList } from './fact-list'

/** Every label and value of the edict page as published, folded by default. */
export function EdictLabelsCard({ labels }: { labels: Readonly<Record<string, string>> }) {
  const { t } = useTranslation()
  return (
    <Card title={t('detail.labels.title')}>
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-sm text-sm font-medium text-accent-text">
          <ChevronDownIcon className="transition-transform duration-120 group-open:rotate-180" />
          {t('detail.labels.show')}
        </summary>
        <FactList columns={1} className="mt-4">
          {Object.entries(labels).map(([label, value]) => (
            <Fact key={label} label={<span lang="de">{label}</span>} lang="de">
              {value}
            </Fact>
          ))}
        </FactList>
      </details>
    </Card>
  )
}
