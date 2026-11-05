import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SettingsPatch } from '@shared/domain'
import { CheckIcon } from '../../components/ui/icons'
import { Spinner } from '../../components/ui/spinner'
import { useToast } from '../../components/ui/toast'
import { useApp } from '../../lib/app-context'
import { errorCode } from '../../lib/bridge'

const SAVED_VISIBLE_MS = 2500

export interface SettingsSaver {
  save: (patch: SettingsPatch) => Promise<boolean>
  /** The patch in flight, so controls can show the new value while it saves. */
  pending: SettingsPatch | null
  saving: boolean
  /** True for a moment after a successful save. */
  saved: boolean
}

/** Saves settings changes for one card: failures as a toast, success inline. */
export function useSettingsSaver(): SettingsSaver {
  const { t } = useTranslation()
  const { updateSettings } = useApp()
  const toast = useToast()
  const [pending, setPending] = useState<SettingsPatch | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), SAVED_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [saved])

  async function save(patch: SettingsPatch): Promise<boolean> {
    setPending(patch)
    setSaved(false)
    try {
      await updateSettings(patch)
      setSaved(true)
      return true
    } catch (error) {
      toast({
        kind: 'error',
        title: t('settings.saveFailed'),
        description: t(`errors.${errorCode(error)}`),
      })
      return false
    } finally {
      setPending(null)
    }
  }

  return { save, pending, saving: pending !== null, saved }
}

/** "Saving…" and "Saved" next to a card title; the live region stays mounted. */
export function SaveStatus({ saver }: { saver: SettingsSaver }) {
  const { t } = useTranslation()
  return (
    <span role="status" className="flex h-6 items-center gap-1.5 text-sm text-fg-muted">
      {saver.saving && (
        <>
          <Spinner />
          {t('settings.saving')}
        </>
      )}
      {!saver.saving && saver.saved && (
        <>
          <CheckIcon className="text-success-text" />
          {t('settings.saved')}
        </>
      )}
    </span>
  )
}
