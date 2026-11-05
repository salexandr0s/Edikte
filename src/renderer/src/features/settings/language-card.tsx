import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { LanguageSettingSchema, type Settings } from '@shared/domain'
import { Card } from '../../components/ui/card'
import { RadioGroup } from '../../components/ui/radio-group'
import { useApp } from '../../lib/app-context'
import { SaveStatus, useSettingsSaver } from './settings-saver'

type LanguageSetting = Settings['language']

interface LanguageOptionsProps {
  value: LanguageSetting
  disabled?: boolean
  onChange: (language: LanguageSetting) => void
}

/** System, German or English as option cards; Settings and the first-run screen use it. */
export function LanguageOptions({ value, disabled, onChange }: LanguageOptionsProps) {
  const { t } = useTranslation()
  const helpId = useId()
  return (
    <div className="flex flex-col gap-3">
      <RadioGroup
        label={t('language.label')}
        hideLabel
        variant="cards"
        aria-describedby={helpId}
        options={LanguageSettingSchema.options.map((option) => ({
          value: option,
          label: t(`language.${option}`),
        }))}
        value={value}
        disabled={disabled}
        onValueChange={onChange}
      />
      <p id={helpId} className="text-xs text-fg-muted">
        {t('settings.languageHelp')}
      </p>
    </div>
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
