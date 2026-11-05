import { useTranslation } from 'react-i18next'
import type { Bundesland } from '@shared/enums'
import { SwitchRow } from '../../components/ui/switch'
import { BundeslandCheckboxes } from '../settings/bundesland-checkboxes'
import { toggleBundesland } from '../settings/settings-logic'

interface SyncStepProps {
  bundeslaender: Bundesland[]
  autoSync: boolean
  onBundeslaenderChange: (next: Bundesland[]) => void
  onAutoSyncChange: (next: boolean) => void
}

/** The scope of the first sync. The values are saved when the setup finishes. */
export function SyncStep({
  bundeslaender,
  autoSync,
  onBundeslaenderChange,
  onAutoSyncChange,
}: SyncStepProps) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-6">
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
