import { ToggleGroup } from 'radix-ui'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LocalDateSchema } from '@shared/domain'
import { Field, Input, Legend } from '../../components/ui/field'
import { CheckIcon } from '../../components/ui/icons'
import { cx } from '../../lib/cx'
import { parseWholeNumber } from './query-helpers'

export interface ChipOption<T extends string | number> {
  value: T
  label: string
  /** Accessible name and hover text when the label is abbreviated. */
  fullLabel?: string
}

interface ChipGroupProps<T extends string | number> {
  label: string
  /** Keeps the label for screen readers only, when a section title already names the group. */
  hideLabel?: boolean
  options: readonly ChipOption<T>[]
  selected: readonly T[]
  onChange: (selected: T[]) => void
}

// The check mark shows the state without relying on colour.
const CHIP = cx(
  'inline-flex h-8 items-center gap-1 rounded-full border border-border bg-surface px-3 text-sm text-fg shadow-xs transition-[background-color,border-color,color,box-shadow] duration-120 select-none',
  'hover:border-border-strong hover:bg-surface-hover',
  'aria-pressed:border-accent-fill aria-pressed:bg-accent-soft aria-pressed:text-accent-text aria-pressed:shadow-none',
  'focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring-soft',
)

/** Multiple choice as toggle chips: Tab enters, arrow keys move, Space toggles. */
export function ChipGroup<T extends string | number>({
  label,
  hideLabel = false,
  options,
  selected,
  onChange,
}: ChipGroupProps<T>) {
  const labelId = useId()
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span id={labelId} className={cx('text-sm font-medium text-fg', hideLabel && 'sr-only')}>
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
        {options.map((option) => {
          const on = selected.includes(option.value)
          return (
            <ToggleGroup.Item
              key={option.value}
              value={String(option.value)}
              aria-label={option.fullLabel}
              title={option.fullLabel}
              className={cx(CHIP, on && 'pl-2.5')}
            >
              {on && <CheckIcon className="size-3.5 animate-check-in" strokeWidth={2} />}
              {option.label}
            </ToggleGroup.Item>
          )
        })}
      </ToggleGroup.Root>
    </div>
  )
}

interface NumberFilterProps {
  label: string
  /** Keeps the label for screen readers only; the placeholder shows it instead. */
  hideLabel?: boolean
  value: number | null
  onChange: (value: number | null) => void
  /** Maximums must be above zero (ListingQuerySchema). */
  positive?: boolean
  className?: string
}

/**
 * A whole number in German or English notation. The query only receives
 * valid numbers; anything else stays in the field with an error message.
 */
export function NumberFilter({
  label,
  hideLabel = false,
  value,
  onChange,
  positive = false,
  className,
}: NumberFilterProps) {
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
    <Field label={label} hideLabel={hideLabel} error={error} className={className}>
      {(control) => (
        <Input
          {...control}
          size="sm"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          placeholder={hideLabel ? label : undefined}
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
  className?: string
  onChange: (range: Range<number>) => void
}

/** Two number fields side by side, "From" and "To" as placeholders. */
export function RangeFilter({ label, help, className, min, max, onChange }: RangeFilterProps) {
  const { t } = useTranslation()
  return (
    <fieldset className={cx('flex min-w-0 flex-col gap-2', className)}>
      <Legend>{label}</Legend>
      <div className="grid grid-cols-2 gap-2">
        <NumberFilter
          label={t('filters.from')}
          hideLabel
          value={min}
          onChange={(value) => onChange({ min: value, max })}
        />
        <NumberFilter
          label={t('filters.to')}
          hideLabel
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
  className?: string
  onChange: (range: Range<string>) => void
}

/** Dates as `YYYY-MM-DD`; a date input reports an incomplete date as "". */
export function DateRangeFilter({ label, className, min, max, onChange }: DateRangeFilterProps) {
  const { t } = useTranslation()
  const read = (value: string) => (LocalDateSchema.safeParse(value).success ? value : null)
  return (
    <fieldset className={cx('flex min-w-0 flex-col gap-2', className)}>
      <Legend>{label}</Legend>
      <div className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2">
        <DateBound
          label={t('filters.from')}
          value={min}
          max={max}
          onChange={(value) => onChange({ min: value, max })}
          read={read}
        />
        <DateBound
          label={t('filters.to')}
          value={max}
          min={min}
          onChange={(value) => onChange({ min, max: value })}
          read={read}
        />
      </div>
      {min !== null && max !== null && min > max && (
        <p role="alert" className="text-sm text-danger-text">
          {t('filters.errors.dateRange')}
        </p>
      )}
    </fieldset>
  )
}

function DateBound({
  label,
  value,
  min,
  max,
  onChange,
  read,
}: {
  label: string
  value: string | null
  min?: string | null
  max?: string | null
  onChange: (value: string | null) => void
  read: (value: string) => string | null
}) {
  const id = useId()
  return (
    <>
      <label htmlFor={id} className="text-xs text-fg-muted">
        {label}
      </label>
      <Input
        id={id}
        type="date"
        size="sm"
        value={value ?? ''}
        min={min ?? undefined}
        max={max ?? undefined}
        onChange={(event) => onChange(read(event.target.value))}
      />
    </>
  )
}
