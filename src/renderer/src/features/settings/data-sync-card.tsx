import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PriceBasisSchema, type Bundesland, type EdictSource } from '@shared/enums'
import { Card } from '../../components/ui/card'
import { Field } from '../../components/ui/field'
import { Select } from '../../components/ui/select'
import { SwitchRow } from '../../components/ui/switch'
import { useApp } from '../../lib/app-context'
import { BundeslandCheckboxes } from './bundesland-checkboxes'
import { RetentionForm } from './retention-form'
import { SaveStatus, useSettingsSaver } from './settings-saver'
import { toggleBundesland, toggleSyncSource } from './settings-logic'
import { SourceCheckboxes } from './source-checkboxes'

export function DataSyncCard() {
  const { t } = useTranslation()
  const { info, settings } = useApp()
  const saver = useSettingsSaver()
  const [landMissing, setLandMissing] = useState(false)
  const [sourceMissing, setSourceMissing] = useState(false)
  // Show the value being saved, so a ticked box does not flip back meanwhile.
  const current = { ...settings, ...saver.pending }

  function toggleLand(land: Bundesland, checked: boolean) {
    const next = toggleBundesland(current.syncBundeslaender, land, checked)
    // At least one stays selected; the box keeps its tick and the message says why.
    setLandMissing(next.length === 0)
    if (next.length > 0) void saver.save({ syncBundeslaender: next })
  }

  function toggleSource(source: EdictSource, checked: boolean) {
    const next = toggleSyncSource(current.syncSources, source, checked)
    setSourceMissing(next === null)
    if (next !== null) void saver.save({ syncSources: next })
  }

  return (
    <Card title={t('settings.data.title')} actions={<SaveStatus saver={saver} />}>
      <div className="flex flex-col gap-6 [&>*+*]:border-t [&>*+*]:border-border [&>*+*]:pt-6">
        <SourceCheckboxes
          selected={current.syncSources}
          disabled={saver.saving}
          error={sourceMissing ? t('settings.data.sourcesRequired') : undefined}
          onToggle={toggleSource}
        />
        <BundeslandCheckboxes
          legend={t('settings.data.bundeslaender')}
          help={t('settings.data.bundeslaenderHelp')}
          selected={current.syncBundeslaender}
          disabled={saver.saving}
          error={landMissing ? t('settings.data.bundeslaenderRequired') : undefined}
          onToggle={toggleLand}
        />
        <SwitchRow
          label={t('settings.data.autoSync')}
          description={t('settings.data.autoSyncHelp')}
          checked={current.autoSync}
          disabled={saver.saving}
          onCheckedChange={(autoSync) => void saver.save({ autoSync })}
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
              onValueChange={(priceBasis) => void saver.save({ priceBasis })}
              options={PriceBasisSchema.options.map((basis) => ({
                value: basis,
                label: t(`priceBasis.${basis}`),
              }))}
            />
          )}
        </Field>
        <RetentionForm value={settings.documentRetentionDays} saver={saver} />
        <dl className="flex flex-col gap-1.5">
          <dt className="text-sm font-medium text-fg">{t('settings.data.dataDir')}</dt>
          <dd className="rounded-md bg-bg-muted px-3 py-2 font-mono text-xs break-all text-fg select-text">
            {info.dataDir}
          </dd>
          <dd className="text-xs text-fg-muted">{t('settings.data.dataDirHelp')}</dd>
        </dl>
      </div>
    </Card>
  )
}
