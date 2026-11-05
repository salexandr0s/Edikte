import { useTranslation } from 'react-i18next'
import type { KurzgutachtenFacts } from '@shared/domain'
import { Card } from '../../components/ui/card'
import { Fact, FactList } from './fact-list'

const FIELDS = [
  'bestandsverhaeltnisse',
  'lasten',
  'widmung',
  'anschluesse',
  'baubewilligung',
  'stichtag',
  'erstelltVon',
] as const

/** Facts from the Kurzgutachten page, read during sync without AI. */
export function KurzgutachtenCard({ facts }: { facts: KurzgutachtenFacts }) {
  const { t } = useTranslation()
  return (
    <Card title={t('detail.kurzgutachten.title')}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">{t('detail.kurzgutachten.intro')}</p>
        <FactList columns={2}>
          {FIELDS.map((field) => {
            const value = facts[field]
            return (
              <Fact
                key={field}
                label={t(`detail.kurzgutachten.${field}`)}
                lang={value === null ? undefined : 'de'}
              >
                {value ?? t('common.notStated')}
              </Fact>
            )
          })}
          {Object.entries(facts.other).map(([label, value]) => (
            <Fact key={label} label={<span lang="de">{label}</span>} lang="de">
              {value}
            </Fact>
          ))}
        </FactList>
      </div>
    </Card>
  )
}
