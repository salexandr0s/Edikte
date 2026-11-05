import { useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiKeyProviderId, ProviderStatus } from '@shared/providers'
import { Button } from '../../../components/ui/button'
import { Dialog } from '../../../components/ui/dialog'
import { Field, Input } from '../../../components/ui/field'
import { invoke } from '../../../lib/bridge'
import type { ProviderAction } from './use-provider-action'

/** The request schema of `providers:setApiKey` rejects shorter keys. */
const API_KEY_MIN_LENGTH = 20
const API_KEY_MAX_LENGTH = 500

interface ApiKeyActionsProps {
  provider: ApiKeyProviderId
  status: ProviderStatus
  action: ProviderAction
}

/** A key goes from the field straight to main; the renderer keeps no copy. */
export function ApiKeyActions({ provider, status, action }: ApiKeyActionsProps) {
  if (status.state === 'ready') return <RemoveKey provider={provider} action={action} />
  return <ApiKeyForm provider={provider} action={action} />
}

function ApiKeyForm({ provider, action }: { provider: ApiKeyProviderId; action: ProviderAction }) {
  const { t } = useTranslation()
  // Uncontrolled on purpose: the key lives only in the input until it is submitted.
  const inputRef = useRef<HTMLInputElement>(null)
  const [hasValue, setHasValue] = useState(false)
  const [tooShort, setTooShort] = useState(false)
  const failure = action.error?.action === 'apiKey' ? action.error.code : null
  const busy = action.busy !== null

  let error: string | undefined
  if (tooShort) error = t('providers.apiKey.tooShort')
  else if (failure !== null) error = t(`errors.${failure}`)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const input = inputRef.current
    if (input === null) return
    const key = input.value.trim()
    input.value = ''
    setHasValue(false)
    setTooShort(key.length < API_KEY_MIN_LENGTH)
    if (key.length < API_KEY_MIN_LENGTH) return
    await action.run('apiKey', () => invoke('providers:setApiKey', { provider, key }), {
      title: t('providers.apiKey.saved'),
    })
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="max-w-xl">
      <Field label={t('providers.apiKey.label')} help={t('providers.apiKey.help')} error={error}>
        {(control) => (
          <div className="flex gap-2">
            <Input
              {...control}
              ref={inputRef}
              type="password"
              autoComplete="off"
              spellCheck={false}
              maxLength={API_KEY_MAX_LENGTH}
              disabled={busy}
              className="flex-1"
              onChange={(event) => {
                setHasValue(event.target.value.trim() !== '')
                setTooShort(false)
                if (failure !== null) action.clearError()
              }}
            />
            <Button
              type="submit"
              variant="secondary"
              disabled={!hasValue || busy}
              loading={action.busy === 'apiKey'}
            >
              {t('providers.apiKey.save')}
            </Button>
          </div>
        )}
      </Field>
    </form>
  )
}

function RemoveKey({ provider, action }: { provider: ApiKeyProviderId; action: ProviderAction }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const vendor = t(`providers.vendor.${provider}`)
  const busy = action.busy !== null

  async function remove() {
    await action.run('disconnect', () => invoke('providers:disconnect', { provider }), {
      title: t('providers.apiKey.removed'),
    })
    setOpen(false)
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" size="sm" disabled={busy} onClick={() => setOpen(true)}>
        {t('providers.apiKey.remove')}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next)
        }}
        size="sm"
        title={t('providers.apiKey.removeTitle', { vendor })}
        description={t('providers.apiKey.removeText', { vendor })}
        footer={
          <>
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="destructive"
              loading={action.busy === 'disconnect'}
              onClick={() => void remove()}
            >
              {t('providers.apiKey.remove')}
            </Button>
          </>
        }
      />
    </div>
  )
}
