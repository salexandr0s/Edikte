import { ToggleGroup } from 'radix-ui'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LocalDateSchema } from '@shared/domain'
import { Field, Input } from '../../components/ui/field'
import { CheckIcon } from '../../components/ui/icons'
import { cx } from '../../lib/cx'
import { parseWholeNumber } from './query-helpers'

const LABEL = 'text-sm font-medium text-fg'
const LEGEND = cx(LABEL, 'mb-2')

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
  'inline-flex h-8 items-center gap-1 rounded-full border border-border bg-surface px-3 text-sm text-fg transition-colors hover:bg-bg-muted',
  'aria-pressed:border-accent-text aria-pressed:bg-bg-muted aria-pressed:text-accent-text',
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
      <span id={labelId} className={cx(LABEL, hideLabel && 'sr-only')}>
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

interface SegmentedChoiceProps<T extends string> {
  label: string
  options: readonly { value: T; label: string }[]
  value: T
  onChange: (value: T) => void
}

// Like the shell's navigation: the chosen segment stands out as a raised surface.
const SEGMENT =
  'inline-flex h-8 items-center rounded-sm px-3 text-sm text-fg-muted transition-colors hover:text-fg data-[state=on]:bg-surface-elevated data-[state=on]:font-medium data-[state=on]:text-fg data-[state=on]:shadow-xs'

/** Single choice as a segmented control: arrow keys move, Space or Enter chooses. */
export function SegmentedChoice<T extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentedChoiceProps<T>) {
  const labelId = useId()
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span id={labelId} className={LABEL}>
        {label}
      </span>
      <ToggleGroup.Root
        type="single"
        aria-labelledby={labelId}
        value={value}
        // Pressing the chosen segment again reports ""; one option stays chosen.
        onValueChange={(next) => {
          const option = options.find((candidate) => candidate.value === next)
          if (option !== undefined) onChange(option.value)
        }}
        className="inline-flex gap-0.5 self-start rounded-md border border-border bg-bg-muted p-0.5"
      >
        {options.map((option) => (
          <ToggleGroup.Item key={option.value} value={option.value} className={SEGMENT}>
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
  className?: string
}

/**
 * A whole number in German or English notation. The query only receives
 * valid numbers; anything else stays in the field with an error message.
 */
export function NumberFilter({
  label,
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
    <Field label={label} error={error} className={className}>
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
  className?: string
  onChange: (range: Range<number>) => void
}

export function RangeFilter({ label, help, className, min, max, onChange }: RangeFilterProps) {
  const { t } = useTranslation()
  return (
    <fieldset className={cx('flex min-w-0 flex-col gap-2', className)}>
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
  className?: string
  onChange: (range: Range<string>) => void
}

/** Dates as `YYYY-MM-DD`; a date input reports an incomplete date as "". */
export function DateRangeFilter({ label, className, min, max, onChange }: DateRangeFilterProps) {
  const { t } = useTranslation()
  const read = (value: string) => (LocalDateSchema.safeParse(value).success ? value : null)
  return (
    <fieldset className={cx('flex min-w-0 flex-col gap-2', className)}>
      <legend className={LEGEND}>{label}</legend>
      <div className="grid grid-cols-2 gap-3">
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
