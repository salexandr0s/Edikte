import { useTranslation } from 'react-i18next'
import { CheckIcon } from '../../components/ui/icons'
import { cx } from '../../lib/cx'

interface StepIndicatorProps {
  steps: ReadonlyArray<{ id: string; label: string }>
  /** Index of the current step. */
  current: number
}

/** Numbered steps; done steps carry a check mark, the current one is bold. */
export function StepIndicator({ steps, current }: StepIndicatorProps) {
  const { t } = useTranslation()
  return (
    <ol aria-label={t('firstRun.steps')} className="flex flex-wrap items-center gap-3">
      {steps.map(({ id, label }, index) => {
        const done = index < current
        const active = index === current
        return (
          <li
            key={id}
            aria-current={active ? 'step' : undefined}
            className="flex items-center gap-2"
          >
            <span
              aria-hidden
              className={cx(
                'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                done && 'bg-accent-fill text-white',
                active && 'border-2 border-accent-text text-accent-text',
                !done && !active && 'border border-border-strong text-fg-muted',
              )}
            >
              {done ? <CheckIcon className="size-3" /> : index + 1}
            </span>
            <span
              aria-hidden={done}
              className={cx('text-sm', active ? 'font-medium text-fg' : 'text-fg-muted')}
            >
              {label}
            </span>
            {done && <span className="sr-only">{t('firstRun.stepDone', { step: label })}</span>}
            {index < steps.length - 1 && <span aria-hidden className="ml-1 h-px w-8 bg-border" />}
          </li>
        )
      })}
    </ol>
  )
}
