import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ExternalLinkIcon } from '../../components/ui/icons'
import { useToast } from '../../components/ui/toast'
import { useApp } from '../../lib/app-context'
import { errorCode, invoke } from '../../lib/bridge'

const SITE_URL = 'https://edikte.justiz.gv.at/'

export function AboutCard() {
  const { t } = useTranslation()
  const { info } = useApp()
  const toast = useToast()
  const [opening, setOpening] = useState(false)

  async function openSite() {
    setOpening(true)
    try {
      await invoke('shell:openExternal', { url: SITE_URL })
    } catch (error) {
      toast({ kind: 'error', title: t(`errors.${errorCode(error)}`) })
    } finally {
      setOpening(false)
    }
  }

  return (
    <Card title={t('settings.about.title')}>
      <div className="flex flex-col gap-3 text-sm text-fg">
        <p className="font-medium tabular-nums">{t('shell.version', { version: info.version })}</p>
        <p>{t('settings.about.notAffiliated')}</p>
        <p>{t('settings.about.source')}</p>
        <p>{t('settings.about.personalUse')}</p>
        <div>
          <Button variant="outline" size="sm" loading={opening} onClick={() => void openSite()}>
            {t('settings.about.openSite')}
            <ExternalLinkIcon />
          </Button>
        </div>
      </div>
    </Card>
  )
}
