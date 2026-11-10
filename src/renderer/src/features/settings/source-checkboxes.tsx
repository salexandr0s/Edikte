import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { EdictSourceSchema, type EdictSource } from '@shared/enums'
import { Checkbox } from '../../components/ui/checkbox'
import { Legend } from '../../components/ui/field'

interface SourceCheckboxesProps {
  selected: readonly EdictSource[]
  disabled?: boolean
  error?: string
  onToggle: (source: EdictSource, checked: boolean) => void
}

/** Source scope, shared by settings and first-run setup. */
export function SourceCheckboxes({ selected, disabled, error, onToggle }: SourceCheckboxesProps) {
  const { t } = useTranslation()
  const id = useId()
  const errorId = error === undefined ? undefined : `${id}-error`
  return (
    <fieldset aria-describedby={errorId}>
      <Legend className="mb-1.5">{t('settings.data.sources')}</Legend>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {EdictSourceSchema.options.map((source) => (
            <Checkbox
              key={source}
              label={t(`edictSource.${source}`)}
              checked={selected.includes(source)}
              disabled={disabled}
              onCheckedChange={(checked) => onToggle(source, checked)}
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
