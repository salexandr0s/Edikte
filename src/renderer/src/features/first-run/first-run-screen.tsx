import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Bundesland } from '@shared/enums'
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
 * listings. It does not start a sync: main decides that.
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
    if (bundeslaender.length === 0) return
    setFinishing(true)
    try {
      await updateSettings({
        syncBundeslaender: bundeslaender,
        autoSync,
        firstRunCompletedAt: new Date().toISOString(),
      })
      navigate({ screen: 'listings' })
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
    <div className="mx-auto flex min-h-full max-w-3xl flex-col px-6 pt-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t('firstRun.title')}</h1>
        <p className="text-base text-fg-muted">{t('firstRun.welcome')}</p>
      </header>

      <div className="mt-8">
        <StepIndicator
          steps={STEPS.map((id) => ({ id, label: t(`firstRun.${id}.title`) }))}
          current={stepIndex}
        />
      </div>

      <section
        aria-labelledby={headingId}
        className="mt-6 mb-6 flex flex-col gap-6 rounded-lg border border-border bg-surface p-6 shadow-xs"
      >
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium text-fg-muted">
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
            bundeslaender={bundeslaender}
            autoSync={autoSync}
            onBundeslaenderChange={setBundeslaender}
            onAutoSyncChange={setAutoSync}
          />
        )}
      </section>

      <div className="sticky bottom-0 z-(--edk-z-sticky) mt-auto flex items-center justify-between gap-3 border-t border-border bg-bg py-4">
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
          onClick={() => (lastStep ? void finish() : goTo(stepIndex + 1))}
        >
          {t('common.continue')}
          {!lastStep && <ChevronRightIcon />}
        </Button>
      </div>
    </div>
  )
}
