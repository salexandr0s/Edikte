import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Bundesland, EdictSource } from '@shared/enums'
import { SwitchRow } from '../../components/ui/switch'
import { BundeslandCheckboxes } from '../settings/bundesland-checkboxes'
import { toggleBundesland, toggleSyncSource } from '../settings/settings-logic'
import { SourceCheckboxes } from '../settings/source-checkboxes'

interface SyncStepProps {
  sources: EdictSource[]
  bundeslaender: Bundesland[]
  autoSync: boolean
  onSourcesChange: (next: EdictSource[]) => void
  onBundeslaenderChange: (next: Bundesland[]) => void
  onAutoSyncChange: (next: boolean) => void
}

/** The scope of the first sync. The values are saved when the setup finishes. */
export function SyncStep({
  sources,
  bundeslaender,
  autoSync,
  onSourcesChange,
  onBundeslaenderChange,
  onAutoSyncChange,
}: SyncStepProps) {
  const { t } = useTranslation()
  const [sourceMissing, setSourceMissing] = useState(false)
  return (
    <div className="flex flex-col gap-6">
      <SourceCheckboxes
        selected={sources}
        error={sourceMissing ? t('settings.data.sourcesRequired') : undefined}
        onToggle={(source, checked) => {
          const next = toggleSyncSource(sources, source, checked)
          setSourceMissing(next === null)
          if (next !== null) onSourcesChange(next)
        }}
      />
      <BundeslandCheckboxes
        legend={t('settings.data.bundeslaender')}
        help={t('settings.data.bundeslaenderHelp')}
        selected={bundeslaender}
        error={bundeslaender.length === 0 ? t('settings.data.bundeslaenderRequired') : undefined}
        onToggle={(land, checked) =>
          onBundeslaenderChange(toggleBundesland(bundeslaender, land, checked))
        }
      />
      <SwitchRow
        label={t('settings.data.autoSync')}
        description={t('settings.data.autoSyncHelp')}
        checked={autoSync}
        onCheckedChange={onAutoSyncChange}
        className="border-t border-border pt-6"
      />
    </div>
  )
}
