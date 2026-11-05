import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PriceBasisSchema, type Bundesland } from '@shared/enums'
import { Card } from '../../components/ui/card'
import { Checkbox, Field, Select } from '../../components/ui/field'
import { useApp } from '../../lib/app-context'
import { BundeslandCheckboxes } from './bundesland-checkboxes'
import { RetentionForm } from './retention-form'
import { SaveStatus, useSettingsSaver } from './settings-saver'
import { toggleBundesland } from './settings-logic'

export function DataSyncCard() {
  const { t } = useTranslation()
  const { info, settings } = useApp()
  const saver = useSettingsSaver()
  const [landMissing, setLandMissing] = useState(false)
  // Show the value being saved, so a ticked box does not flip back meanwhile.
  const current = { ...settings, ...saver.pending }

  function toggleLand(land: Bundesland, checked: boolean) {
    const next = toggleBundesland(current.syncBundeslaender, land, checked)
    // At least one stays selected; the box keeps its tick and the message says why.
    setLandMissing(next.length === 0)
    if (next.length > 0) void saver.save({ syncBundeslaender: next })
  }

  return (
    <Card title={t('settings.data.title')} actions={<SaveStatus saver={saver} />}>
      <div className="flex flex-col gap-6">
        <BundeslandCheckboxes
          legend={t('settings.data.bundeslaender')}
          help={t('settings.data.bundeslaenderHelp')}
          selected={current.syncBundeslaender}
          disabled={saver.saving}
          error={landMissing ? t('settings.data.bundeslaenderRequired') : undefined}
          onToggle={toggleLand}
        />
        <Checkbox
          label={t('settings.data.autoSync')}
          description={t('settings.data.autoSyncHelp')}
          checked={current.autoSync}
          disabled={saver.saving}
          onChange={(event) => void saver.save({ autoSync: event.target.checked })}
        />
        <Field
          label={t('settings.data.priceBasis')}
          help={t('settings.data.priceBasisHelp')}
          className="max-w-xs"
        >
          {(control) => (
            <Select
              {...control}
              value={current.priceBasis}
              disabled={saver.saving}
              onChange={(event) =>
                void saver.save({ priceBasis: PriceBasisSchema.parse(event.target.value) })
              }
            >
              {PriceBasisSchema.options.map((basis) => (
                <option key={basis} value={basis}>
                  {t(`priceBasis.${basis}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <RetentionForm value={settings.documentRetentionDays} saver={saver} />
        <dl className="flex flex-col gap-1.5">
          <dt className="text-sm font-medium text-fg">{t('settings.data.dataDir')}</dt>
          <dd className="font-mono text-sm break-all text-fg select-text">{info.dataDir}</dd>
          <dd className="text-xs text-fg-muted">{t('settings.data.dataDirHelp')}</dd>
        </dl>
      </div>
    </Card>
  )
}
