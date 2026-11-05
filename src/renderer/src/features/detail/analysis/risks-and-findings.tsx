import { useTranslation } from 'react-i18next'
import type { AnalysisResult } from '@shared/analysis-schema'
import type { RiskLevel } from '@shared/enums'
import { Badge, type BadgeVariant } from '../../../components/ui/badge'
import { useFormat } from '../../../lib/format'
import { risksBySeverity } from '../detail-helpers'
import { ResultSection, SourceLine, type ResultSource } from './result-section'

const SEVERITY_VARIANTS: Readonly<Record<RiskLevel, BadgeVariant>> = {
  high: 'danger',
  medium: 'warning',
  low: 'default',
}

interface ListProps {
  result: AnalysisResult
  source: ResultSource
  /** Show the German texts of the result instead of the English ones. */
  german: boolean
}

export function RiskList({ result, source, german }: ListProps) {
  const { t } = useTranslation()
  const risks = risksBySeverity(result.risks)
  return (
    <ResultSection title={t('analysis.risks')}>
      {risks.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('analysis.noRisks')}</p>
      ) : (
        <ul className="flex flex-col gap-5">
          {risks.map(({ risk, index }) => (
            <li key={index} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Badge variant={SEVERITY_VARIANTS[risk.severity]}>
                  {t(`analysis.severity.${risk.severity}`)}
                </Badge>
                <p className="text-sm font-medium">{german ? risk.title_de : risk.title_en}</p>
              </div>
              <p className="text-sm">{german ? risk.detail_de : risk.detail_en}</p>
              <SourceLine
                source={source}
                path={`risks.${index}`}
                page={risk.page}
                quote={risk.quote}
              />
            </li>
          ))}
        </ul>
      )}
    </ResultSection>
  )
}

type FindingKind = 'encumbrances' | 'arrears' | 'defects'

/** Encumbrances, arrears or defects, with amount and source. */
export function FindingList({ kind, result, source, german }: ListProps & { kind: FindingKind }) {
  const { t } = useTranslation()
  const format = useFormat()
  const findings = result[kind]
  return (
    <ResultSection title={t(`analysis.findings.${kind}`)}>
      {findings.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('analysis.findings.none')}</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {findings.map((finding, index) => (
            <li key={index} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <p className="text-sm">{german ? finding.text_de : finding.text_en}</p>
                {finding.amount_eur !== null && (
                  <p className="text-sm font-medium tabular-nums">
                    {format.eur(finding.amount_eur)}
                  </p>
                )}
              </div>
              <SourceLine
                source={source}
                path={`${kind}.${index}`}
                page={finding.page}
                quote={finding.quote}
              />
            </li>
          ))}
        </ul>
      )}
    </ResultSection>
  )
}
