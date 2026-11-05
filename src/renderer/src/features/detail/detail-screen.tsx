import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/empty-state'
import { ChevronLeftIcon } from '../../components/ui/icons'
import { Spinner } from '../../components/ui/spinner'
import { useApp } from '../../lib/app-context'
import { AnalysisCard } from './analysis/analysis-card'
import { AreaCandidatesCard } from './area-candidates-card'
import { DetailHeader } from './detail-header'
import { DocumentsCard } from './documents-card'
import { EdictLabelsCard } from './edict-labels-card'
import { KeyNumbers } from './key-numbers'
import { KurzgutachtenCard } from './kurzgutachten-card'
import { NotesCard } from './notes-card'
import { RelatedCard } from './related-card'
import { useListingDetail } from './use-listing-detail'

const PAGE = 'mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6'

/**
 * One listing: edict facts and key numbers on top, then the AI analysis with
 * the Kurzgutachten and area values, and documents, notes and related edicts
 * beside them from 1280 px. Below that width the columns stack in this order.
 */
export function DetailScreen({ id }: { id: string }) {
  const { t } = useTranslation()
  const { navigate } = useApp()
  const { state, reload, retry } = useListingDetail(id)
  const back = () => navigate({ screen: 'listings' })

  if (state.status !== 'ready') {
    return (
      <div className={PAGE}>
        <Button variant="ghost" size="sm" className="-ml-3 self-start" onClick={back}>
          <ChevronLeftIcon />
          {t('common.back')}
        </Button>
        {state.status === 'loading' ? (
          <p
            role="status"
            className="flex items-center justify-center gap-2 py-16 text-sm text-fg-muted"
          >
            <Spinner />
            {t('common.loading')}
          </p>
        ) : state.code === 'not_found' ? (
          <EmptyState
            title={t('detail.notFoundTitle')}
            description={t('errors.not_found')}
            action={<Button onClick={back}>{t('detail.backToList')}</Button>}
          />
        ) : (
          <EmptyState
            title={t('detail.loadFailed')}
            description={t(`errors.${state.code}`)}
            action={<Button onClick={retry}>{t('common.retry')}</Button>}
          />
        )}
      </div>
    )
  }

  const { detail, reloadError } = state
  return (
    <div className={PAGE}>
      <DetailHeader detail={detail} onBack={back} />
      <KeyNumbers detail={detail} />
      <div className="grid items-start gap-6 xl:grid-cols-5">
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-3">
          <AnalysisCard detail={detail} reload={reload} reloadError={reloadError} />
          {detail.kurzgutachten !== null && <KurzgutachtenCard facts={detail.kurzgutachten} />}
          <AreaCandidatesCard detail={detail} />
        </div>
        <div className="flex min-w-0 flex-col gap-6 xl:col-span-2">
          <DocumentsCard documents={detail.documents} />
          {/* A new case gets a new card; the old one still saves its last text. */}
          <NotesCard key={detail.caseKey} caseKey={detail.caseKey} initialNotes={detail.notes} />
          {detail.related.length > 0 && <RelatedCard related={detail.related} />}
          {Object.keys(detail.rawLabels).length > 0 && (
            <EdictLabelsCard labels={detail.rawLabels} />
          )}
        </div>
      </div>
    </div>
  )
}
