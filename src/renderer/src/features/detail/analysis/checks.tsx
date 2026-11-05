import { useTranslation } from 'react-i18next'
import type { AnalysisRecord, AnalysisResult, CrossCheck } from '@shared/analysis-schema'
import { Badge } from '../../../components/ui/badge'
import { AlertIcon } from '../../../components/ui/icons'
import { useFormat } from '../../../lib/format'
import { pageRanges } from '../detail-helpers'
import { Fact, FactList } from '../fact-list'
import { usePercent } from '../use-detail-actions'
import { ResultSection } from './result-section'

/** The app's comparison of the result with the edict, in plain words. */
export function CrossChecks({ checks }: { checks: readonly CrossCheck[] }) {
  const { t } = useTranslation()
  const format = useFormat()
  const percent = usePercent()
  if (checks.length === 0) return null
  const notStated = t('common.notStated')
  return (
    <ResultSection title={t('analysis.checks.title')}>
      <ul className="flex flex-col gap-4">
        {checks.map((check, index) => {
          const value = (amount: number | null) =>
            amount === null
              ? notStated
              : check.kind === 'verkehrswert_vs_schaetzwert'
                ? format.eur(amount)
                : format.sqm(amount)
          const warning = check.severity === 'warning'
          return (
            <li key={index} className="flex items-start gap-3">
              <Badge variant={warning ? 'warning' : 'success'}>
                {warning ? t('analysis.checks.warning') : t('analysis.checks.ok')}
              </Badge>
              <div className="flex min-w-0 flex-col gap-0.5">
                <p className="text-sm">
                  {t(`analysis.checks.${check.kind}`, {
                    listing: value(check.listingValue),
                    analysis: value(check.analysisValue),
                  })}
                </p>
                {check.deltaPercent !== null && check.kind !== 'cellar_in_objektgroesse' && (
                  <p className="text-xs text-fg-muted">
                    {t('analysis.checks.gap', { percent: percent(check.deltaPercent, true) })}
                  </p>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </ResultSection>
  )
}

/** Pages the model could not read and pages left out for length. */
export function ReadingGaps({
  result,
  record,
}: {
  result: AnalysisResult
  record: AnalysisRecord
}) {
  const { t } = useTranslation()
  const unread = result.unread_pages
  const dropped = record.droppedPages
  if (unread.length === 0 && dropped.length === 0) return null
  return (
    <div className="flex items-start gap-2 rounded-md border border-warning-subtle bg-warning-subtle/40 p-4 text-sm">
      <AlertIcon className="mt-0.5 text-warning-text" />
      <div className="flex flex-col gap-1">
        {unread.length > 0 && <p>{t('analysis.pages.unread', { pages: pageRanges(unread) })}</p>}
        {dropped.length > 0 && <p>{t('analysis.pages.dropped', { pages: pageRanges(dropped) })}</p>}
        <p className="text-xs text-fg-muted">{t('analysis.pages.hint')}</p>
      </div>
    </div>
  )
}

export function RunDetails({ record }: { record: AnalysisRecord }) {
  const { t } = useTranslation()
  const format = useFormat()
  const { inputTokens, outputTokens, costUsd, finishedAt } = record
  return (
    <ResultSection title={t('analysis.run.title')}>
      <FactList columns={3} className="rounded-md bg-bg-muted p-4">
        <Fact label={t('analysis.run.provider')}>{t(`providerName.${record.provider}`)}</Fact>
        <Fact label={t('analysis.run.model')}>{record.model}</Fact>
        <Fact label={t('analysis.run.finished')}>
          {finishedAt === null ? t('common.notStated') : format.timestamp(finishedAt)}
        </Fact>
        {inputTokens !== null && outputTokens !== null && (
          <Fact label={t('analysis.run.tokens')}>
            {t('analysis.run.tokenCounts', {
              input: format.number(inputTokens),
              output: format.number(outputTokens),
            })}
          </Fact>
        )}
        {costUsd !== null && <Fact label={t('analysis.run.cost')}>{format.usd(costUsd)}</Fact>}
      </FactList>
    </ResultSection>
  )
}
