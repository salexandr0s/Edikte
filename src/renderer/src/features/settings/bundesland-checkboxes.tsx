import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { BundeslandSchema, type Bundesland } from '@shared/enums'
import { Checkbox } from '../../components/ui/field'

interface BundeslandCheckboxesProps {
  legend: string
  help?: string
  selected: readonly Bundesland[]
  disabled?: boolean
  /** Shown below the boxes and announced, e.g. when none is ticked. */
  error?: string
  onToggle: (land: Bundesland, checked: boolean) => void
}

/** One checkbox per Bundesland, used in Settings and in the first-run sync step. */
export function BundeslandCheckboxes({
  legend,
  help,
  selected,
  disabled,
  error,
  onToggle,
}: BundeslandCheckboxesProps) {
  const { t } = useTranslation()
  const id = useId()
  const helpId = help === undefined ? undefined : `${id}-help`
  const errorId = error === undefined ? undefined : `${id}-error`
  const describedBy = [errorId, helpId].filter(Boolean).join(' ')

  return (
    <fieldset aria-describedby={describedBy === '' ? undefined : describedBy}>
      <legend className="mb-1.5 text-sm font-medium text-fg">{legend}</legend>
      <div className="flex flex-col gap-3">
        {help !== undefined && (
          <p id={helpId} className="text-xs text-fg-muted">
            {help}
          </p>
        )}
        <div className="grid grid-cols-3 gap-x-4 gap-y-2">
          {BundeslandSchema.options.map((land) => (
            <Checkbox
              key={land}
              label={t(`bundesland.${land}`)}
              checked={selected.includes(land)}
              disabled={disabled}
              onChange={(event) => onToggle(land, event.target.checked)}
            />
          ))}
        </div>
        {error !== undefined && (
          <p id={errorId} role="alert" className="text-sm text-danger-text">
            {error}
          </p>
        )}
      </div>
    </fieldset>
  )
}
