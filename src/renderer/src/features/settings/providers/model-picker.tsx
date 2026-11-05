import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppErrorCode } from '@shared/errors'
import type { ModelOption, ProviderId, ProviderStatus } from '@shared/providers'
import { Button } from '../../../components/ui/button'
import { Field, Input, Select } from '../../../components/ui/field'
import { Spinner } from '../../../components/ui/spinner'
import { errorCode, invoke } from '../../../lib/bridge'
import { modelChoice } from './provider-logic'
import type { ProviderAction } from './use-provider-action'

const MODEL_ID_MAX_LENGTH = 200
const CLI_DEFAULT_MODEL = 'default'

type ModelsResult = { attempt: number } & ({ options: ModelOption[] } | { error: AppErrorCode })

interface ModelPickerProps {
  /** Rendered for ready providers only: `providers:models` fails for the others. */
  status: ProviderStatus
  action: ProviderAction
}

export function ModelPicker({ status, action }: ModelPickerProps) {
  const { t } = useTranslation()
  const provider = status.id
  const [attempt, setAttempt] = useState(0)
  const [result, setResult] = useState<ModelsResult | null>(null)
  const [pendingModel, setPendingModel] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    void invoke('providers:models', { provider }).then(
      (options) => {
        if (!ignore) setResult({ attempt, options })
      },
      (caught: unknown) => {
        if (!ignore) setResult({ attempt, error: errorCode(caught) })
      },
    )
    return () => {
      ignore = true
    }
  }, [provider, attempt])

  if (result === null || result.attempt !== attempt) {
    return (
      <p className="flex items-center gap-2 text-sm text-fg-muted">
        <Spinner />
        {t('providers.model.loading')}
      </p>
    )
  }

  if ('error' in result) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-col text-sm">
          <p className="text-danger-text">{t('providers.model.loadFailed')}</p>
          <p className="text-fg-muted">{t(`errors.${result.error}`)}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setAttempt((count) => count + 1)}>
          {t('common.retry')}
        </Button>
      </div>
    )
  }

  const { options } = result
  const choice = modelChoice(options, status.model)

  function optionLabel(option: ModelOption): string {
    // The CLIs' `default` alias runs whatever model the CLI picks by itself.
    if (option.id === CLI_DEFAULT_MODEL) return t('providers.model.cliDefault')
    return option.isDefault
      ? t('providers.model.defaultOption', { label: option.label })
      : option.label
  }
  const busy = action.busy !== null

  async function save(model: string) {
    setPendingModel(model)
    // The default option saves null, so the choice follows the provider's default if it changes.
    const isDefault = options.some((option) => option.id === model && option.isDefault)
    await action.run(
      'model',
      () => invoke('providers:setModel', { provider, model: isDefault ? null : model }),
      { title: t('providers.model.saved') },
    )
    setPendingModel(null)
  }

  return (
    <div className="flex flex-col gap-4">
      {result.options.length === 0 && choice.extra === null ? (
        <p className="text-sm text-fg-muted">{t('providers.model.none')}</p>
      ) : (
        <Field label={t('providers.model.label')} className="max-w-xs">
          {(control) => (
            <Select
              {...control}
              value={pendingModel ?? choice.value}
              disabled={busy}
              onChange={(event) => void save(event.target.value)}
            >
              {result.options.map((option) => (
                <option key={option.id} value={option.id}>
                  {optionLabel(option)}
                </option>
              ))}
              {choice.extra !== null && <option value={choice.extra}>{choice.extra}</option>}
            </Select>
          )}
        </Field>
      )}
      {provider === 'codex-cli' && <CustomModelForm provider={provider} action={action} />}
    </div>
  )
}

/** The Codex CLI takes model IDs that its list does not name. */
function CustomModelForm({ provider, action }: { provider: ProviderId; action: ProviderAction }) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')
  const busy = action.busy !== null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const model = draft.trim()
    if (model === '') return
    const saved = await action.run(
      'model',
      () => invoke('providers:setModel', { provider, model }),
      { title: t('providers.model.saved') },
    )
    if (saved) setDraft('')
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="max-w-md">
      <Field label={t('providers.model.custom')} help={t('providers.model.customHelp')}>
        {(control) => (
          <div className="flex gap-2">
            <Input
              {...control}
              value={draft}
              autoComplete="off"
              spellCheck={false}
              maxLength={MODEL_ID_MAX_LENGTH}
              disabled={busy}
              className="flex-1"
              onChange={(event) => setDraft(event.target.value)}
            />
            <Button type="submit" variant="secondary" disabled={draft.trim() === '' || busy}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </Field>
    </form>
  )
}
