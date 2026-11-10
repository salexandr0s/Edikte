import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { ExternalLinkIcon } from '../../components/ui/icons'
import { useToast } from '../../components/ui/toast'
import { useApp } from '../../lib/app-context'
import { errorCode, invoke } from '../../lib/bridge'

const SITES = [
  { url: 'https://edikte.justiz.gv.at/', label: 'settings.about.openSite' },
  { url: 'https://justizonline.gv.at/', label: 'settings.about.openJustizOnline' },
] as const

export function AboutCard() {
  const { t } = useTranslation()
  const { info } = useApp()
  const toast = useToast()
  const [opening, setOpening] = useState<string | null>(null)

  async function openSite(url: string) {
    setOpening(url)
    try {
      await invoke('shell:openExternal', { url })
    } catch (error) {
      toast({ kind: 'error', title: t(`errors.${errorCode(error)}`) })
    } finally {
      setOpening(null)
    }
  }

  return (
    <Card title={t('settings.about.title')}>
      <div className="flex flex-col gap-3 text-sm text-fg">
        <p className="font-medium tabular-nums">{t('shell.version', { version: info.version })}</p>
        <p>{t('settings.about.notAffiliated')}</p>
        <p>{t('settings.about.source')}</p>
        <p>{t('settings.about.personalUse')}</p>
        <div className="flex flex-wrap gap-2">
          {SITES.map(({ url, label }) => (
            <Button
              key={url}
              variant="outline"
              size="sm"
              loading={opening === url}
              disabled={opening !== null}
              onClick={() => void openSite(url)}
            >
              {t(label)}
              <ExternalLinkIcon />
            </Button>
          ))}
        </div>
      </div>
    </Card>
  )
}
