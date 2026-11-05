import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button'
import { Field, Input } from '../../components/ui/field'
import type { SettingsSaver } from './settings-saver'
import { parseRetentionDays, RETENTION_MAX_DAYS, RETENTION_MIN_DAYS } from './settings-logic'

interface RetentionFormProps {
  /** The saved number of days. */
  value: number
  saver: SettingsSaver
}

/** Days to keep downloaded documents after a case closes, checked before saving. */
export function RetentionForm({ value, saver }: RetentionFormProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState(String(value))
  const [invalid, setInvalid] = useState(false)
  const changed = draft.trim() !== String(value)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const days = parseRetentionDays(draft)
    setInvalid(days === null)
    if (days === null) return
    if (await saver.save({ documentRetentionDays: days })) setDraft(String(days))
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="max-w-md">
      <Field
        label={t('settings.data.retention')}
        help={t('settings.data.retentionHelp')}
        error={invalid ? t('settings.data.retentionInvalid') : undefined}
      >
        {(control) => (
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-24">
              <Input
                {...control}
                type="number"
                inputMode="numeric"
                min={RETENTION_MIN_DAYS}
                max={RETENTION_MAX_DAYS}
                step={1}
                value={draft}
                disabled={saver.saving}
                className="tabular-nums"
                onChange={(event) => {
                  setDraft(event.target.value)
                  setInvalid(false)
                }}
              />
            </div>
            <span className="text-sm text-fg-muted">{t('settings.data.retentionUnit')}</span>
            <Button type="submit" variant="secondary" disabled={!changed || saver.saving}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </Field>
    </form>
  )
}
