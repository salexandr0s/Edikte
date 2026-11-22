import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Bundesland, EdictSource } from '@shared/enums'
import { Button } from '../../components/ui/button'
import { ChevronLeftIcon, ChevronRightIcon } from '../../components/ui/icons'
import { useToast } from '../../components/ui/toast'
import { useApp } from '../../lib/app-context'
import { errorCode } from '../../lib/bridge'
import { LanguageOptions } from '../settings/language-card'
import { useProviders } from '../settings/providers/use-providers'
import { useSettingsSaver } from '../settings/settings-saver'
import { ProvidersStep } from './providers-step'
import { StepIndicator } from './step-indicator'
import { SyncStep } from './sync-step'

const STEPS = ['language', 'providers', 'sync'] as const

/**
 * Shown until the first run is completed, without the navigation. Every step
 * moves on with "Continue"; the last one saves the sync scope and opens the
 * dashboard. It does not start a sync: main decides that.
 */
export function FirstRunScreen() {
  const { t } = useTranslation()
  const { settings, updateSettings, navigate } = useApp()
  const toast = useToast()
  const headingId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)
  const stepChanged = useRef(false)
  // Detection takes a few seconds; it runs while the user picks a language.
  const providers = useProviders('detect')
  const languageSaver = useSettingsSaver()
  const [stepIndex, setStepIndex] = useState(0)
  const [bundeslaender, setBundeslaender] = useState<Bundesland[]>(settings.syncBundeslaender)
  const [sources, setSources] = useState<EdictSource[]>(settings.syncSources)
  const [autoSync, setAutoSync] = useState(settings.autoSync)
  const [finishing, setFinishing] = useState(false)
  const step = STEPS[stepIndex] ?? 'language'
  const lastStep = stepIndex === STEPS.length - 1

  // Screen reader and keyboard users continue at the new step's heading.
  useEffect(() => {
    if (stepChanged.current) headingRef.current?.focus()
  }, [stepIndex])

  function goTo(index: number) {
    stepChanged.current = true
    setStepIndex(index)
  }

  async function finish() {
    // The sync step shows why it cannot finish without a Bundesland.
    if (bundeslaender.length === 0 || sources.length === 0) return
    setFinishing(true)
    try {
      await updateSettings({
        syncBundeslaender: bundeslaender,
        syncSources: sources,
        autoSync,
        firstRunCompletedAt: new Date().toISOString(),
      })
      navigate({ screen: 'dashboard' })
    } catch (error) {
      setFinishing(false)
      toast({
        kind: 'error',
        title: t('firstRun.saveFailed'),
        description: t(`errors.${errorCode(error)}`),
      })
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">{t('firstRun.title')}</h1>
        <p className="max-w-xl text-base text-fg-muted">{t('firstRun.welcome')}</p>
      </header>

      <StepIndicator
        steps={STEPS.map((id) => ({ id, label: t(`firstRun.${id}.title`) }))}
        current={stepIndex}
      />

      <section
        aria-labelledby={headingId}
        className="flex flex-col gap-6 rounded-lg border border-border bg-surface p-6 shadow-xs"
      >
        <div className="flex flex-col gap-1">
          <p className="sr-only">
            {t('firstRun.stepOf', { current: stepIndex + 1, total: STEPS.length })}
          </p>
          <h2
            id={headingId}
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold tracking-tight outline-none"
          >
            {t(`firstRun.${step}.title`)}
          </h2>
          <p className="text-sm text-fg-muted">{t(`firstRun.${step}.text`)}</p>
        </div>

        {step === 'language' && (
          <LanguageOptions
            value={languageSaver.pending?.language ?? settings.language}
            disabled={languageSaver.saving}
            onChange={(language) => void languageSaver.save({ language })}
          />
        )}
        {step === 'providers' && <ProvidersStep providers={providers} />}
        {step === 'sync' && (
          <SyncStep
            sources={sources}
            bundeslaender={bundeslaender}
            autoSync={autoSync}
            onBundeslaenderChange={setBundeslaender}
            onSourcesChange={setSources}
            onAutoSyncChange={setAutoSync}
          />
        )}
        <footer className="-mx-6 -mb-6 sticky bottom-0 z-(--edk-z-sticky) flex items-center justify-between gap-3 rounded-b-lg border-t border-border bg-surface px-6 py-4">
          {stepIndex > 0 ? (
            <Button variant="ghost" disabled={finishing} onClick={() => goTo(stepIndex - 1)}>
              <ChevronLeftIcon />
              {t('common.back')}
            </Button>
          ) : (
            <span />
          )}
          <Button
            loading={finishing}
            disabled={
              languageSaver.saving ||
              (lastStep && (sources.length === 0 || bundeslaender.length === 0))
            }
            onClick={() => (lastStep ? void finish() : goTo(stepIndex + 1))}
          >
            {t('common.continue')}
            {!lastStep && <ChevronRightIcon />}
          </Button>
        </footer>
      </section>
    </div>
  )
}
