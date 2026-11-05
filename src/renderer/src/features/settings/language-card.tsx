import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageSettingSchema, type Settings } from '@shared/domain'
import { Card } from '../../components/ui/card'
import { useApp } from '../../lib/app-context'
import { SaveStatus, useSettingsSaver } from './settings-saver'

type LanguageSetting = Settings['language']

interface LanguageOptionsProps {
  value: LanguageSetting
  disabled?: boolean
  onChange: (language: LanguageSetting) => void
}

/** System, German or English as radio buttons; Settings and the first-run screen use it. */
export function LanguageOptions({ value, disabled, onChange }: LanguageOptionsProps) {
  const { t } = useTranslation()
  const name = useId()
  const helpId = `${name}-help`
  return (
    <fieldset aria-describedby={helpId}>
      <legend className="sr-only">{t('language.label')}</legend>
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          {LanguageSettingSchema.options.map((option) => (
            <label key={option} className="flex items-center gap-2 text-sm text-fg">
              <input
                type="radio"
                name={name}
                value={option}
                checked={value === option}
                disabled={disabled}
                onChange={() => onChange(option)}
                className="size-4 shrink-0 accent-blue-700 disabled:cursor-not-allowed disabled:opacity-55"
              />
              {t(`language.${option}`)}
            </label>
          ))}
        </div>
        <p id={helpId} className="text-xs text-fg-muted">
          {t('settings.languageHelp')}
        </p>
      </div>
    </fieldset>
  )
}

export function LanguageCard() {
  const { t } = useTranslation()
  const { settings } = useApp()
  const saver = useSettingsSaver()
  return (
    <Card title={t('language.label')} actions={<SaveStatus saver={saver} />}>
      <LanguageOptions
        value={saver.pending?.language ?? settings.language}
        disabled={saver.saving}
        onChange={(language) => void saver.save({ language })}
      />
    </Card>
  )
}
