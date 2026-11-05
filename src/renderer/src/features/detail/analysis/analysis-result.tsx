import { useTranslation } from 'react-i18next'
import type { AnalysisRecord } from '@shared/analysis-schema'
import type { RiskLevel } from '@shared/enums'
import { Badge, type BadgeVariant } from '../../../components/ui/badge'
import { CrossChecks, ReadingGaps, RunDetails } from './checks'
import {
  AreasSection,
  OwnershipSection,
  PropertySection,
  TenancySection,
  ValuationSection,
} from './result-facts'
import { ResultSection, type ResultSource } from './result-section'
import { FindingList, RiskList } from './risks-and-findings'

const CONFIDENCE_VARIANTS: Readonly<Record<RiskLevel, BadgeVariant>> = {
  high: 'success',
  medium: 'warning',
  low: 'danger',
}

interface AnalysisResultProps {
  record: AnalysisRecord
  /** The Langgutachten that page links open. */
  documentId: number | null
}

/**
 * A finished run: summary, risks and checks first, then the facts. AI output
 * is untrusted, so every value renders as plain text.
 */
export function AnalysisResult({ record, documentId }: AnalysisResultProps) {
  const { t, i18n } = useTranslation()
  const { result } = record
  if (result === null) return <p className="text-sm text-fg-muted">{t('analysis.noResult')}</p>
  const german = i18n.language === 'de'
  const source: ResultSource = { record, documentId }

  return (
    <div className="flex flex-col gap-8">
      <ResultSection title={t('analysis.summary')}>
        <p className="text-base leading-relaxed">
          {german ? result.summary_de : result.summary_en}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Badge variant={CONFIDENCE_VARIANTS[result.confidence]}>
            {t('analysis.confidence', { level: t(`riskLevel.${result.confidence}`) })}
          </Badge>
          <span className="text-xs text-fg-muted">{t('analysis.confidenceHint')}</span>
        </div>
        <ReadingGaps result={result} record={record} />
      </ResultSection>
      <RiskList result={result} source={source} german={german} />
      <CrossChecks checks={record.crossChecks} />
      <ValuationSection result={result} source={source} />
      <AreasSection result={result} source={source} />
      <PropertySection result={result} />
      <OwnershipSection result={result} />
      <TenancySection result={result} source={source} />
      <FindingList kind="encumbrances" result={result} source={source} german={german} />
      <FindingList kind="arrears" result={result} source={source} german={german} />
      <FindingList kind="defects" result={result} source={source} german={german} />
      <RunDetails record={record} />
    </div>
  )
}
