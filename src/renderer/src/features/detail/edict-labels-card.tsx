import { useTranslation } from 'react-i18next'
import { Card } from '../../components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible'
import { Fact, FactList } from './fact-list'

/** Every label and value of the edict page as published, folded by default. */
export function EdictLabelsCard({ labels }: { labels: Readonly<Record<string, string>> }) {
  const { t } = useTranslation()
  return (
    <Card title={t('detail.labels.title')}>
      <Collapsible>
        <CollapsibleTrigger className="-ml-1.5">{t('detail.labels.show')}</CollapsibleTrigger>
        <CollapsibleContent>
          <FactList columns={1} className="pt-4">
            {Object.entries(labels).map(([label, value]) => (
              <Fact key={label} label={<span lang="de">{label}</span>} lang="de">
                {value}
              </Fact>
            ))}
          </FactList>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
