import { useTranslation } from 'react-i18next'
import type { AnalysisResult } from '@shared/analysis-schema'
import { Badge } from '../../../components/ui/badge'
import { AlertIcon } from '../../../components/ui/icons'
import { useFormat } from '../../../lib/format'
import { Fact, FactList } from '../fact-list'
import { ResultSection, SourceLine, type ResultSource } from './result-section'

interface FactsProps {
  result: AnalysisResult
  source: ResultSource
}

export function ValuationSection({ result, source }: FactsProps) {
  const { t } = useTranslation()
  const format = useFormat()
  const notStated = t('common.notStated')
  const { verkehrswert } = result
  const stichtag = verkehrswert?.stichtag ?? null
  return (
    <ResultSection title={t('analysis.valuation')}>
      <FactList columns={3}>
        <Fact label={t('analysis.verkehrswert')}>
          {verkehrswert === null ? notStated : format.eur(verkehrswert.eur)}
        </Fact>
        <Fact label={t('analysis.valuationDate')}>
          {stichtag === null ? notStated : format.localDate(stichtag)}
        </Fact>
        <Fact label={t('analysis.zubehoer')}>
          {result.zubehoer_eur === null ? notStated : format.eur(result.zubehoer_eur)}
        </Fact>
      </FactList>
      {verkehrswert !== null && (
        <SourceLine
          source={source}
          path="verkehrswert"
          page={verkehrswert.page}
          quote={verkehrswert.quote}
        />
      )}
    </ResultSection>
  )
}

export function AreasSection({ result, source }: FactsProps) {
  const { t } = useTranslation()
  const format = useFormat()
  return (
    <ResultSection title={t('analysis.areas')}>
      {result.areas.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('analysis.noAreas')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {result.areas.map((area, index) => (
            <li key={index} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="text-sm font-semibold tabular-nums">{format.sqm(area.sqm)}</span>
                <span lang="de" className="text-sm">
                  {area.label}
                </span>
                <span className="text-xs text-fg-muted">{t(`areaKind.${area.kind}`)}</span>
                {index === result.primary_area_index && (
                  <Badge size="sm" variant="primary">
                    {t('analysis.primaryArea')}
                  </Badge>
                )}
              </div>
              <SourceLine
                source={source}
                path={`areas.${index}`}
                page={area.page}
                quote={area.quote}
              />
            </li>
          ))}
        </ul>
      )}
    </ResultSection>
  )
}

export function PropertySection({ result }: { result: AnalysisResult }) {
  const { t } = useTranslation()
  const format = useFormat()
  const notStated = t('common.notStated')
  const { property } = result
  return (
    <ResultSection title={t('analysis.property.title')}>
      <FactList columns={3}>
        <Fact label={t('analysis.inspection.title')} className="col-span-2">
          <Inspection inspected={result.interior_inspected} />
        </Fact>
        <Fact label={t('analysis.property.rooms')}>
          {property.rooms === null ? notStated : format.number(property.rooms, 1)}
        </Fact>
        <Fact label={t('analysis.property.floor')}>{property.floor ?? notStated}</Fact>
        <Fact label={t('analysis.property.buildingYear')}>
          {property.building_year === null ? notStated : String(property.building_year)}
        </Fact>
        <Fact label={t('analysis.property.condition')}>{property.condition ?? notStated}</Fact>
        <Fact label={t('analysis.property.heating')}>{property.heating ?? notStated}</Fact>
        <Fact label={t('analysis.property.hwb')}>
          {property.hwb_kwh_m2a === null
            ? notStated
            : t('analysis.property.hwbValue', { value: format.number(property.hwb_kwh_m2a) })}
        </Fact>
        <Fact label={t('analysis.property.energyClass')}>{property.energy_class ?? notStated}</Fact>
      </FactList>
    </ResultSection>
  )
}

function Inspection({ inspected }: { inspected: boolean | null }) {
  const { t } = useTranslation()
  if (inspected === null) return t('analysis.inspection.unknown')
  if (inspected) return t('analysis.inspection.yes')
  return (
    <span className="flex items-start gap-1.5 text-warning-text">
      <AlertIcon className="mt-0.5" />
      {t('analysis.inspection.no')}
    </span>
  )
}

export function OwnershipSection({ result }: { result: AnalysisResult }) {
  const { t } = useTranslation()
  const format = useFormat()
  const notStated = t('common.notStated')
  const { ownership } = result
  const yesNo = (value: boolean | null) =>
    value === null ? notStated : value ? t('common.yes') : t('common.no')
  return (
    <ResultSection title={t('analysis.ownership.title')}>
      <FactList columns={2}>
        <Fact label={t('analysis.ownership.share')}>{ownership.share ?? notStated}</Fact>
        <Fact label={t('analysis.ownership.wohnungseigentum')}>
          {yesNo(ownership.wohnungseigentum)}
        </Fact>
        <Fact label={t('analysis.ownership.units')}>
          {ownership.unit_count === null ? notStated : format.number(ownership.unit_count)}
        </Fact>
        <Fact label={t('analysis.ownership.parking')}>{yesNo(ownership.bundled_parking)}</Fact>
      </FactList>
    </ResultSection>
  )
}

export function TenancySection({ result, source }: FactsProps) {
  const { t } = useTranslation()
  const format = useFormat()
  const { tenancy } = result
  return (
    <ResultSection title={t('analysis.tenancy.title')}>
      <FactList columns={3}>
        <Fact label={t('analysis.tenancy.status')}>
          {t(`analysis.tenancy.statuses.${tenancy.status}`)}
        </Fact>
        <Fact label={t('analysis.tenancy.mrg')}>
          {t(`analysis.tenancy.mrgScopes.${tenancy.mrg_scope}`)}
        </Fact>
        <Fact label={t('analysis.tenancy.rent')}>
          {tenancy.monthly_rent_eur === null
            ? t('common.notStated')
            : format.eur(tenancy.monthly_rent_eur)}
        </Fact>
      </FactList>
      <SourceLine source={source} path="tenancy" page={tenancy.page} quote={tenancy.quote} />
    </ResultSection>
  )
}
