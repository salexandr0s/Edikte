import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { AnalysisEstimate } from '@shared/domain'
import type { ProviderStatus } from '@shared/providers'
import { useApp } from '../lib/app-context'
import { errorCode, invoke } from '../lib/bridge'
import { useFormat } from '../lib/format'
import { Button } from './ui/button'
import { Dialog } from './ui/dialog'
import { useToast } from './ui/toast'

/**
 * Every analysis starts here, for one listing or a filtered batch: a ready
 * provider, the one-time consent that Gutachten text goes to that provider,
 * then the estimate (downloads, tokens, cost) before anything is queued.
 */
interface AnalysisGateValue {
  /** Resolves to the number of queued analyses, or null when nothing was queued. */
  requestAnalysis: (edictIds: string[]) => Promise<number | null>
}

type Question =
  | { kind: 'provider'; provider: ProviderStatus | null }
  | { kind: 'consent'; provider: ProviderStatus }
  | { kind: 'confirm'; provider: ProviderStatus; estimate: AnalysisEstimate }
  | { kind: 'nothing' }

interface Pending {
  question: Question
  answer: (accepted: boolean) => void
}

const AnalysisGateContext = createContext<AnalysisGateValue | null>(null)

export function AnalysisGateProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const { settings, updateSettings, navigate } = useApp()
  const toast = useToast()
  const [pending, setPending] = useState<Pending | null>(null)

  const ask = useCallback(
    (question: Question) =>
      new Promise<boolean>((resolve) => {
        setPending({
          question,
          answer: (accepted) => {
            setPending(null)
            resolve(accepted)
          },
        })
      }),
    [],
  )

  const requestAnalysis = useCallback(
    async (edictIds: string[]): Promise<number | null> => {
      try {
        const providers = await invoke('providers:list')
        const provider = providers.find((candidate) => candidate.selected) ?? null
        if (provider?.state !== 'ready') {
          if (await ask({ kind: 'provider', provider })) navigate({ screen: 'settings' })
          return null
        }
        if (settings.analysisConsentAt === null) {
          if (!(await ask({ kind: 'consent', provider }))) return null
          await updateSettings({ analysisConsentAt: new Date().toISOString() })
        }
        const estimate = await invoke('analysis:estimate', { edictIds })
        if (estimate.listings - estimate.withoutDocument <= 0) {
          await ask({ kind: 'nothing' })
          return null
        }
        if (!(await ask({ kind: 'confirm', provider, estimate }))) return null
        const { queued } = await invoke('analysis:start', { edictIds })
        toast({ kind: 'success', title: t('analysisGate.queued', { count: queued }) })
        return queued
      } catch (error) {
        const code = errorCode(error)
        const fixInSettings = code.startsWith('provider_') || code.startsWith('cli_')
        toast({
          kind: 'error',
          title: t('analysisGate.failed'),
          description: t(`errors.${code}`),
          action: fixInSettings
            ? {
                label: t('analysisGate.openSettings'),
                onClick: () => navigate({ screen: 'settings' }),
              }
            : undefined,
        })
        return null
      }
    },
    [ask, navigate, settings.analysisConsentAt, t, toast, updateSettings],
  )

  return (
    <AnalysisGateContext.Provider value={{ requestAnalysis }}>
      {children}
      {pending !== null && <GateDialog question={pending.question} answer={pending.answer} />}
    </AnalysisGateContext.Provider>
  )
}

export function useAnalysisGate(): AnalysisGateValue {
  const value = useContext(AnalysisGateContext)
  if (value === null) throw new Error('useAnalysisGate must be used inside AnalysisGateProvider')
  return value
}

function GateDialog({ question, answer }: Pending) {
  const { t } = useTranslation()
  const format = useFormat()
  const close = (open: boolean) => {
    if (!open) answer(false)
  }
  const cancel = (
    <Button variant="outline" onClick={() => answer(false)}>
      {t('common.cancel')}
    </Button>
  )

  switch (question.kind) {
    case 'provider': {
      const { provider } = question
      return (
        <Dialog
          open
          onOpenChange={close}
          size="sm"
          title={
            provider === null
              ? t('analysisGate.provider.noneTitle')
              : t('analysisGate.provider.notReadyTitle', {
                  provider: t(`providerName.${provider.id}`),
                })
          }
          description={
            provider === null
              ? t('analysisGate.provider.noneText')
              : t('analysisGate.provider.notReadyText')
          }
          footer={
            <>
              {cancel}
              <Button onClick={() => answer(true)}>{t('analysisGate.openSettings')}</Button>
            </>
          }
        />
      )
    }
    case 'consent': {
      const provider = t(`providerName.${question.provider.id}`)
      return (
        <Dialog
          open
          onOpenChange={close}
          dismissible={false}
          title={t('analysisGate.consent.title', { provider })}
          footer={
            <>
              {cancel}
              <Button onClick={() => answer(true)}>{t('analysisGate.consent.accept')}</Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-fg">
            <p>{t('analysisGate.consent.text', { provider })}</p>
            <p>{t('analysisGate.consent.terms', { provider })}</p>
            <p className="text-fg-muted">{t('analysisGate.consent.once')}</p>
          </div>
        </Dialog>
      )
    }
    case 'confirm': {
      const { estimate } = question
      const provider = t(`providerName.${question.provider.id}`)
      const analyzable = estimate.listings - estimate.withoutDocument
      return (
        <Dialog
          open
          onOpenChange={close}
          title={t('analysisGate.confirm.title', { count: analyzable })}
          footer={
            <>
              {cancel}
              <Button onClick={() => answer(true)}>{t('analysisGate.confirm.start')}</Button>
            </>
          }
        >
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
            <dt className="text-fg-muted">{t('analysisGate.confirm.provider')}</dt>
            <dd>{provider}</dd>
            <dt className="text-fg-muted">{t('analysisGate.confirm.model')}</dt>
            <dd>{estimate.model ?? t('analysisGate.confirm.defaultModel')}</dd>
            {estimate.downloadKb > 0 && (
              <>
                <dt className="text-fg-muted">{t('analysisGate.confirm.download')}</dt>
                <dd>{format.fileSize(estimate.downloadKb)}</dd>
              </>
            )}
            <dt className="text-fg-muted">{t('analysisGate.confirm.tokens')}</dt>
            <dd>
              {t('analysisGate.confirm.tokenCounts', {
                input: format.number(estimate.inputTokens),
                output: format.number(estimate.outputTokens),
              })}
            </dd>
            <dt className="text-fg-muted">{t('analysisGate.confirm.cost')}</dt>
            <dd>
              {estimate.costUsd === null
                ? t('analysisGate.confirm.planCost', { provider })
                : t('analysisGate.confirm.estimatedCost', { cost: format.usd(estimate.costUsd) })}
            </dd>
          </dl>
          {(estimate.withoutDocument > 0 || estimate.alreadyAnalyzed > 0) && (
            <ul className="mt-4 flex list-disc flex-col gap-1 pl-5 text-fg-muted">
              {estimate.withoutDocument > 0 && (
                <li>{t('analysisGate.confirm.skipped', { count: estimate.withoutDocument })}</li>
              )}
              {estimate.alreadyAnalyzed > 0 && (
                <li>{t('analysisGate.confirm.again', { count: estimate.alreadyAnalyzed })}</li>
              )}
            </ul>
          )}
        </Dialog>
      )
    }
    case 'nothing':
      return (
        <Dialog
          open
          onOpenChange={close}
          size="sm"
          title={t('analysisGate.nothing.title')}
          description={t('analysisGate.nothing.text')}
          footer={<Button onClick={() => answer(false)}>{t('common.close')}</Button>}
        />
      )
  }
}
