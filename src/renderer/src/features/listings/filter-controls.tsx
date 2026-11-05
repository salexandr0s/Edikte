import { ToggleGroup } from 'radix-ui'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LocalDateSchema } from '@shared/domain'
import { Field, Input } from '../../components/ui/field'
import { CheckIcon } from '../../components/ui/icons'
import { cx } from '../../lib/cx'
import { parseWholeNumber } from './query-helpers'

const LEGEND = 'mb-2 text-sm font-medium text-fg'

export interface ChipOption<T extends string | number> {
  value: T
  label: string
  /** Accessible name and hover text when the label is abbreviated. */
  fullLabel?: string
}

interface ChipGroupProps<T extends string | number> {
  label: string
  options: readonly ChipOption<T>[]
  selected: readonly T[]
  onChange: (selected: T[]) => void
}

// The check mark shows the state without relying on colour.
const CHIP = cx(
  'inline-flex h-8 items-center gap-1 rounded-full border border-border bg-surface px-3 text-sm text-fg transition-colors hover:bg-bg-muted',
  'aria-pressed:border-accent-text aria-pressed:bg-bg-muted aria-pressed:text-accent-text',
)

/** Multiple choice as toggle chips: Tab enters, arrow keys move, Space toggles. */
export function ChipGroup<T extends string | number>({
  label,
  options,
  selected,
  onChange,
}: ChipGroupProps<T>) {
  const labelId = useId()
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span id={labelId} className="text-sm font-medium text-fg">
        {label}
      </span>
      <ToggleGroup.Root
        type="multiple"
        aria-labelledby={labelId}
        value={selected.map(String)}
        // Keeps the options' order, so equal selections give equal queries.
        onValueChange={(values) =>
          onChange(
            options
              .filter((option) => values.includes(String(option.value)))
              .map((option) => option.value),
          )
        }
        className="flex flex-wrap gap-1.5"
      >
        {options.map((option) => (
          <ToggleGroup.Item
            key={option.value}
            value={String(option.value)}
            aria-label={option.fullLabel}
            title={option.fullLabel}
            className={CHIP}
          >
            {selected.includes(option.value) && <CheckIcon />}
            {option.label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
    </div>
  )
}

interface NumberFilterProps {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  /** Maximums must be above zero (ListingQuerySchema). */
  positive?: boolean
}

/**
 * A whole number in German or English notation. The query only receives
 * valid numbers; anything else stays in the field with an error message.
 */
export function NumberFilter({ label, value, onChange, positive = false }: NumberFilterProps) {
  const { t, i18n } = useTranslation()
  const [text, setText] = useState(() => (value === null ? '' : String(value)))
  const [shown, setShown] = useState(value)
  if (value !== shown) {
    // The query changed elsewhere, through "Reset filters" or a saved filter.
    setShown(value)
    const typed = parseWholeNumber(text, i18n.language)
    if (typed.status !== 'valid' || typed.value !== value) {
      setText(value === null ? '' : String(value))
    }
  }

  const parsed = parseWholeNumber(text, i18n.language)
  const zero = positive && parsed.status === 'valid' && parsed.value === 0
  const error =
    parsed.status === 'invalid'
      ? t('filters.errors.wholeNumber')
      : zero
        ? t('filters.errors.aboveZero')
        : undefined

  function change(next: string) {
    setText(next)
    const result = parseWholeNumber(next, i18n.language)
    const committed =
      result.status === 'empty'
        ? null
        : result.status === 'valid' && !(positive && result.value === 0)
          ? result.value
          : undefined
    if (committed !== undefined && committed !== value) onChange(committed)
  }

  return (
    <Field label={label} error={error}>
      {(control) => (
        <Input
          {...control}
          size="sm"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(event) => change(event.target.value)}
        />
      )}
    </Field>
  )
}

interface Range<T> {
  min: T | null
  max: T | null
}

interface RangeFilterProps extends Range<number> {
  label: string
  help?: string
  onChange: (range: Range<number>) => void
}

export function RangeFilter({ label, help, min, max, onChange }: RangeFilterProps) {
  const { t } = useTranslation()
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className={LEGEND}>{label}</legend>
      <div className="grid grid-cols-2 gap-3">
        <NumberFilter
          label={t('filters.from')}
          value={min}
          onChange={(value) => onChange({ min: value, max })}
        />
        <NumberFilter
          label={t('filters.to')}
          value={max}
          positive
          onChange={(value) => onChange({ min, max: value })}
        />
      </div>
      {min !== null && max !== null && min > max && (
        <p role="alert" className="text-sm text-danger-text">
          {t('filters.errors.range')}
        </p>
      )}
      {help !== undefined && <p className="text-xs text-fg-muted">{help}</p>}
    </fieldset>
  )
}

interface DateRangeFilterProps extends Range<string> {
  label: string
  onChange: (range: Range<string>) => void
}

/** Dates as `YYYY-MM-DD`; a date input reports an incomplete date as "". */
export function DateRangeFilter({ label, min, max, onChange }: DateRangeFilterProps) {
  const { t } = useTranslation()
  const read = (value: string) => (LocalDateSchema.safeParse(value).success ? value : null)
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className={LEGEND}>{label}</legend>
      <div className="grid grid-cols-1 gap-3">
        <Field label={t('filters.from')}>
          {(control) => (
            <Input
              {...control}
              type="date"
              size="sm"
              value={min ?? ''}
              max={max ?? undefined}
              onChange={(event) => onChange({ min: read(event.target.value), max })}
            />
          )}
        </Field>
        <Field label={t('filters.to')}>
          {(control) => (
            <Input
              {...control}
              type="date"
              size="sm"
              value={max ?? ''}
              min={min ?? undefined}
              onChange={(event) => onChange({ min, max: read(event.target.value) })}
            />
          )}
        </Field>
      </div>
      {min !== null && max !== null && min > max && (
        <p role="alert" className="text-sm text-danger-text">
          {t('filters.errors.dateRange')}
        </p>
      )}
    </fieldset>
  )
}

interface RadioChoiceProps<T extends string> {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}

export function RadioChoice<T extends string>({
  label,
  options,
  value,
  onChange,
}: RadioChoiceProps<T>) {
  const name = useId()
  return (
    <fieldset className="flex min-w-0 flex-col">
      <legend className={LEGEND}>{label}</legend>
      <div className="flex flex-col gap-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-sm text-fg">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="mt-0.5 size-4 shrink-0 accent-accent-fill"
            />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
