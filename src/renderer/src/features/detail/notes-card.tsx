import { useEffect, useEffectEvent, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppErrorCode } from '@shared/errors'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Textarea } from '../../components/ui/field'
import { CheckIcon } from '../../components/ui/icons'
import { useToast } from '../../components/ui/toast'
import { errorCode, invoke } from '../../lib/bridge'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'
import { createSaveQueue } from '../../lib/save-queue'

/** The limit of userState:update. */
const MAX_NOTES = 10_000

type SaveState =
  { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; code: AppErrorCode }

interface NotesCardProps {
  caseKey: string
  /** Notes as loaded. Later reloads do not replace what the user is typing. */
  initialNotes: string
}

/**
 * Personal notes for the case, saved on blur, with the Save button and when
 * the card closes. Saves run one at a time and end with the latest text.
 */
export function NotesCard({ caseKey, initialNotes }: NotesCardProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const format = useFormat()
  const id = useId()
  const [draft, setDraft] = useState(initialNotes)
  const [saved, setSaved] = useState(initialNotes)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  // The queue outlives the card, so a save still runs after the user goes Back.
  const [queue] = useState(() =>
    createSaveQueue({
      send: (notes: string) => invoke('userState:update', { caseKey, notes }),
      onSaved: (state) => {
        setSaved(state.notes)
        setSave({ kind: 'saved' })
      },
      onFailed: (error) => {
        const code = errorCode(error)
        setSave({ kind: 'failed', code })
        // The card may be closed by now, so a toast reports the failure as well.
        toast({
          kind: 'error',
          title: t('detail.notes.saveFailed'),
          description: t(`errors.${code}`),
        })
      },
    }),
  )
  const dirty = draft !== saved

  function store() {
    // During a save the queue decides whether the text needs another one.
    if (!dirty && save.kind !== 'saving') return
    setSave({ kind: 'saving' })
    queue(draft)
  }

  // Leaving the screen without a blur, or during a save, still stores the last text.
  const storeOnClose = useEffectEvent(store)
  useEffect(() => () => storeOnClose(), [])

  return (
    <Card title={t('detail.notes.title')}>
      <div className="flex flex-col gap-2">
        <label htmlFor={id} className="sr-only">
          {t('detail.notes.label')}
        </label>
        <Textarea
          id={id}
          rows={6}
          value={draft}
          maxLength={MAX_NOTES}
          aria-describedby={`${id}-help ${id}-status`}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={store}
        />
        <p id={`${id}-help`} className="text-xs text-fg-muted">
          {t('detail.notes.help')}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p
            id={`${id}-status`}
            aria-live="polite"
            className={cx(
              'flex items-center gap-1.5 text-xs',
              save.kind === 'failed' ? 'text-danger-text' : 'text-fg-muted',
            )}
          >
            <SaveStatus state={save} dirty={dirty} />
          </p>
          <div className="flex items-center gap-3">
            <span className="text-xs text-fg-muted tabular-nums">
              {t('detail.notes.length', {
                used: format.number(draft.length),
                max: format.number(MAX_NOTES),
              })}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={!dirty}
              loading={save.kind === 'saving'}
              onClick={store}
            >
              {t('common.save')}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}

function SaveStatus({ state, dirty }: { state: SaveState; dirty: boolean }) {
  const { t } = useTranslation()
  switch (state.kind) {
    case 'saving':
      return t('detail.notes.saving')
    case 'failed':
      return `${t('detail.notes.saveFailed')} ${t(`errors.${state.code}`)}`
    case 'saved':
    case 'idle':
      if (dirty) return t('detail.notes.unsaved')
      if (state.kind === 'idle') return null
      return (
        <>
          <CheckIcon className="text-success-text" />
          {t('detail.notes.saved')}
        </>
      )
  }
}
