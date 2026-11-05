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
    <ol aria-label={t('firstRun.steps')} className="flex flex-wrap items-center gap-2">
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
              className={cx(
                'flex h-8 items-center gap-2 rounded-full py-0.5 pr-3 pl-1 text-sm transition-colors duration-160',
                active ? 'bg-accent-soft font-medium text-accent-text' : 'text-fg-muted',
              )}
            >
              <span
                aria-hidden
                className={cx(
                  'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-160',
                  done && 'bg-accent-fill text-white shadow-raised',
                  active && 'bg-surface text-accent-text shadow-sm',
                  !done && !active && 'bg-fill-muted text-fg-muted',
                )}
              >
                {done ? <CheckIcon className="size-3" strokeWidth={2.25} /> : index + 1}
              </span>
              <span aria-hidden={done}>{label}</span>
              {done && <span className="sr-only">{t('firstRun.stepDone', { step: label })}</span>}
            </span>
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={cx('h-px w-6 transition-colors', done ? 'bg-accent-fill' : 'bg-border')}
              />
            )}
          </li>
        )
      })}
    </ol>
  )
}
