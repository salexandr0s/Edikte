import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button'
import { useToast } from '../../components/ui/toast'
import { useApp } from '../../lib/app-context'
import { errorCode } from '../../lib/bridge'

// Placeholder for the first-run screen: it only marks the first run as done.
export function FirstRunScreen() {
  const { t } = useTranslation()
  const { updateSettings, navigate } = useApp()
  const toast = useToast()
  const [saving, setSaving] = useState(false)

  async function finish() {
    setSaving(true)
    try {
      await updateSettings({ firstRunCompletedAt: new Date().toISOString() })
      navigate({ screen: 'listings' })
    } catch (error) {
      setSaving(false)
      toast({ kind: 'error', title: t(`errors.${errorCode(error)}`) })
    }
  }

  return (
    <div className="flex flex-col items-start gap-4 px-6 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t('app.name')}</h1>
      <Button loading={saving} onClick={() => void finish()}>
        {t('common.continue')}
      </Button>
    </div>
  )
}
