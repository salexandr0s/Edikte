import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SavedFilter } from '@shared/domain'
import type { AppErrorCode } from '@shared/errors'
import { AlertConfigSchema, type AlertConfig, type AlertRule } from '@shared/notifications'
import { Button } from '../../components/ui/button'
import { Dialog } from '../../components/ui/dialog'
import { Field, Input } from '../../components/ui/field'
import { Select } from '../../components/ui/select'
import { Spinner } from '../../components/ui/spinner'
import { SwitchRow } from '../../components/ui/switch'
import { useToast } from '../../components/ui/toast'
import { useApp } from '../../lib/app-context'
import { errorCode, invoke } from '../../lib/bridge'
import { SearchCriteriaSummary } from './search-criteria-summary'

const WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const

interface AlertDialogProps {
  filter: SavedFilter
  onClose: () => void
  onSaved?: () => void
  returnFocus?: () => HTMLElement | null
}

function configOf(rule: AlertRule): AlertConfig {
  return {
    filterId: rule.filterId,
    enabled: rule.enabled,
    cadence: rule.cadence,
    time: rule.time,
    weekday: rule.weekday,
    desktopEnabled: rule.desktopEnabled,
  }
}

export function AlertDialog({ filter, onClose, onSaved, returnFocus }: AlertDialogProps) {
  const { t } = useTranslation()
  const { settings, navigate } = useApp()
  const toast = useToast()
  const formId = useId()
  const [config, setConfig] = useState<AlertConfig | null>(null)
  const [failure, setFailure] = useState<AppErrorCode | null>(null)
  const [reload, setReload] = useState(0)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const name = filter.presetKey === null ? filter.name : t(`filters.presets.${filter.presetKey}`)
  const selectedSources =
    filter.query.sources.length === 0 ? settings.syncSources : filter.query.sources
  const disabledSources = selectedSources.filter((source) => !settings.syncSources.includes(source))
  const outsideRegions =
    filter.query.bundeslaender.length > 0 &&
    filter.query.bundeslaender.every((region) => !settings.syncBundeslaender.includes(region))
  const invalidTime = config !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(config.time)

  useEffect(() => {
    let ignore = false
    invoke('alerts:get', { filterId: filter.id }).then(
      (rule) => {
        if (ignore) return
        setConfig(configOf(rule))
        setFailure(null)
      },
      (error: unknown) => {
        if (!ignore) setFailure(errorCode(error))
      },
    )
    return () => {
      ignore = true
    }
  }, [filter.id, reload])

  function patch(value: Partial<AlertConfig>) {
    setConfig((current) => (current === null ? null : { ...current, ...value }))
  }

  async function save() {
    setSubmitted(true)
    const candidate =
      config !== null && invalidTime && (!config.enabled || config.cadence === 'after_sync')
        ? { ...config, time: '09:00' }
        : config
    const parsed = AlertConfigSchema.safeParse(candidate)
    if (!parsed.success) return
    setSaving(true)
    setFailure(null)
    try {
      await invoke('alerts:update', parsed.data)
      toast({ kind: 'success', title: t('alerts.saved') })
      onSaved?.()
      onClose()
    } catch (error) {
      setFailure(errorCode(error))
      setSaving(false)
    }
  }

  return (
    <Dialog
      open
      returnFocus={returnFocus}
      onOpenChange={(open) => {
        if (!open && !saving) onClose()
      }}
      title={t('alerts.title')}
      description={name}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form={formId} loading={saving} disabled={config === null}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <SearchCriteriaSummary query={filter.query} />
        {(disabledSources.length > 0 || outsideRegions) && (
          <div className="flex flex-col gap-2 rounded-md border border-warning-subtle bg-warning-subtle/40 p-3 text-sm">
            <p>
              {disabledSources.length > 0
                ? t('alerts.disabledSources', {
                    sources: disabledSources.map((source) => t(`edictSource.${source}`)).join(', '),
                  })
                : t('alerts.outsideRegions')}
            </p>
            <Button
              variant="link"
              className="self-start"
              onClick={() => {
                onClose()
                navigate({ screen: 'settings' })
              }}
            >
              {t('alerts.openSettings')}
            </Button>
          </div>
        )}
        {config === null ? (
          failure === null ? (
            <div className="flex justify-center py-4">
              <Spinner label={t('common.loading')} />
            </div>
          ) : (
            <div role="alert" className="flex flex-col items-start gap-2">
              <p className="text-danger-text">
                {t('alerts.loadFailed')} {t(`errors.${failure}`)}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setFailure(null)
                  setReload((value) => value + 1)
                }}
              >
                {t('common.retry')}
              </Button>
            </div>
          )
        ) : (
          <form
            id={formId}
            noValidate
            className="flex flex-col gap-5"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            <SwitchRow
              label={t('alerts.enabled')}
              description={t('alerts.enabledHelp')}
              checked={config.enabled}
              onCheckedChange={(enabled) => patch({ enabled })}
              disabled={saving}
            />
            <Field label={t('alerts.frequency')}>
              {(control) => (
                <Select
                  {...control}
                  value={config.cadence}
                  onValueChange={(cadence) => patch({ cadence })}
                  disabled={!config.enabled || saving}
                  options={[
                    { value: 'after_sync', label: t('alerts.cadence.after_sync') },
                    { value: 'daily', label: t('alerts.cadence.daily') },
                    { value: 'weekly', label: t('alerts.cadence.weekly') },
                  ]}
                />
              )}
            </Field>
            {config.cadence !== 'after_sync' && (
              <div className="grid grid-cols-2 items-start gap-3">
                {config.cadence === 'weekly' && (
                  <Field label={t('alerts.weekday')}>
                    {(control) => (
                      <Select
                        {...control}
                        value={String(config.weekday)}
                        onValueChange={(weekday) => patch({ weekday: Number(weekday) })}
                        disabled={!config.enabled || saving}
                        options={WEEKDAYS.map((day, index) => ({
                          value: String(index + 1),
                          label: t(`alerts.weekdays.${day}`),
                        }))}
                      />
                    )}
                  </Field>
                )}
                <Field
                  label={t('alerts.time')}
                  help={t('alerts.timezone')}
                  error={submitted && invalidTime ? t('alerts.invalidTime') : undefined}
                >
                  {(control) => (
                    <Input
                      {...control}
                      type="time"
                      required
                      value={config.time}
                      onChange={(event) => patch({ time: event.target.value })}
                      disabled={!config.enabled || saving}
                    />
                  )}
                </Field>
              </div>
            )}
            <SwitchRow
              label={t('alerts.desktop')}
              description={t('alerts.desktopHelp')}
              checked={config.desktopEnabled}
              onCheckedChange={(desktopEnabled) => patch({ desktopEnabled })}
              disabled={!config.enabled || saving}
            />
            <p className="rounded-md bg-bg-muted p-3 text-xs leading-relaxed text-fg-muted">
              {t('alerts.discoveryHelp')}
            </p>
            <p className="text-xs text-fg-muted">{t('alerts.lifecycleHelp')}</p>
            {failure !== null && (
              <p role="alert" className="text-sm text-danger-text">
                {t('alerts.saveFailed')} {t(`errors.${failure}`)}
              </p>
            )}
          </form>
        )}
      </div>
    </Dialog>
  )
}
