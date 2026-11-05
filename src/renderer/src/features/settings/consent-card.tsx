import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { useApp } from '../../lib/app-context'
import { useFormat } from '../../lib/format'
import { SaveStatus, useSettingsSaver } from './settings-saver'

/** The one-time consent that Gutachten text goes to the AI provider. */
export function ConsentCard() {
  const { t } = useTranslation()
  const { settings } = useApp()
  const format = useFormat()
  const saver = useSettingsSaver()
  const consentAt = settings.analysisConsentAt

  return (
    <Card title={t('settings.consent.title')} actions={<SaveStatus saver={saver} />}>
      {consentAt === null ? (
        <p className="text-sm text-fg-muted">{t('settings.consent.notGiven')}</p>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-1 flex-col gap-1 text-sm">
            <p className="text-fg">
              {t('settings.consent.given', { date: format.timestamp(consentAt) })}
            </p>
            <p className="text-fg-muted">{t('settings.consent.givenNote')}</p>
          </div>
          <Button
            variant="outline"
            loading={saver.saving}
            onClick={() => void saver.save({ analysisConsentAt: null })}
          >
            {t('settings.consent.withdraw')}
          </Button>
        </div>
      )}
    </Card>
  )
}
