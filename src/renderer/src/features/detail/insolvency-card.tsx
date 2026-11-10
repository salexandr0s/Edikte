import { useTranslation } from 'react-i18next'
import type { InsolvencyContact, InsolvencyFacts } from '@shared/domain'
import { Card } from '../../components/ui/card'
import { Fact, FactList } from './fact-list'

const CONTACT_FIELDS = ['name', 'address', 'phone', 'fax', 'email'] as const

/** Contacts and text from the notice. Published links remain plain text. */
export function InsolvencyCard({ facts }: { facts: InsolvencyFacts }) {
  const { t } = useTranslation()
  return (
    <Card title={t('detail.insolvency.title')}>
      <div className="flex flex-col gap-6">
        <Contact role="administrator" contact={facts.administrator} />
        {facts.deputy !== null && <Contact role="deputy" contact={facts.deputy} />}
        {(facts.description !== null || facts.link !== null) && (
          <FactList columns={1}>
            {facts.description !== null && (
              <Fact label={t('detail.insolvency.description')} lang="de">
                <span className="whitespace-pre-wrap">{facts.description}</span>
              </Fact>
            )}
            {facts.link !== null && (
              <Fact label={t('detail.insolvency.link')}>
                <span className="break-all select-text">{facts.link}</span>
              </Fact>
            )}
          </FactList>
        )}
      </div>
    </Card>
  )
}

function Contact({
  role,
  contact,
}: {
  role: 'administrator' | 'deputy'
  contact: InsolvencyContact | null
}) {
  const { t } = useTranslation()
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">{t(`detail.insolvency.${role}`)}</h3>
      {contact === null ? (
        <p className="text-sm text-fg-muted">{t('common.notStated')}</p>
      ) : (
        <FactList columns={1}>
          {CONTACT_FIELDS.map((field) => {
            const value = contact[field]
            if (value === null) return null
            return (
              <Fact key={field} label={t(`detail.insolvency.${field}`)} lang="de">
                <span className="whitespace-pre-wrap">{value}</span>
              </Fact>
            )
          })}
        </FactList>
      )}
    </section>
  )
}
