import { useTranslation } from 'react-i18next'
import type { KurzgutachtenFacts } from '@shared/domain'
import type { EdictSource } from '@shared/enums'
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
export function KurzgutachtenCard({
  facts,
  source,
}: {
  facts: KurzgutachtenFacts
  source: EdictSource
}) {
  const { t } = useTranslation()
  const insolvency = source === 'insolvency_sale'
  const fields = insolvency
    ? FIELDS.filter((field) => field !== 'stichtag' && field !== 'erstelltVon')
    : FIELDS
  return (
    <Card title={t(insolvency ? 'detail.kurzgutachten.noticeTitle' : 'detail.kurzgutachten.title')}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-fg-muted">
          {t(insolvency ? 'detail.kurzgutachten.noticeIntro' : 'detail.kurzgutachten.intro')}
        </p>
        <FactList columns={2}>
          {fields.map((field) => {
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
