import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppErrorCode } from '@shared/errors'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Textarea } from '../../components/ui/field'
import { CheckIcon } from '../../components/ui/icons'
import { errorCode, invoke } from '../../lib/bridge'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'

/** The limit of userState:update. */
const MAX_NOTES = 10_000

type SaveState =
  { kind: 'idle' } | { kind: 'saving' } | { kind: 'saved' } | { kind: 'failed'; code: AppErrorCode }

interface NotesCardProps {
  caseKey: string
  /** Notes as loaded. Later reloads do not replace what the user is typing. */
  initialNotes: string
}

/** Personal notes for the case, saved on blur and with the Save button. */
export function NotesCard({ caseKey, initialNotes }: NotesCardProps) {
  const { t } = useTranslation()
  const format = useFormat()
  const id = useId()
  const [draft, setDraft] = useState(initialNotes)
  const [saved, setSaved] = useState(initialNotes)
  const [save, setSave] = useState<SaveState>({ kind: 'idle' })
  const dirty = draft !== saved

  async function store() {
    if (!dirty || save.kind === 'saving') return
    setSave({ kind: 'saving' })
    try {
      const state = await invoke('userState:update', { caseKey, notes: draft })
      setSaved(state.notes)
      setSave({ kind: 'saved' })
    } catch (error) {
      setSave({ kind: 'failed', code: errorCode(error) })
    }
  }

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
          onBlur={() => void store()}
        />
        <p id={`${id}-help`} className="text-xs text-fg-muted">
          {t('detail.notes.help')}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3">
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
              onClick={() => void store()}
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
