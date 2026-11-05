import { useTranslation } from 'react-i18next'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/empty-state'
import { AlertCircleIcon, SearchIcon } from '../../components/ui/icons'
import { Skeleton } from '../../components/ui/skeleton'
import { useApp } from '../../lib/app-context'
import { AnalysisCard } from './analysis/analysis-card'
import { AreaCandidatesCard } from './area-candidates-card'
import { AuctionFacts } from './auction-facts'
import { BackToListButton, DetailHeader } from './detail-header'
import { DocumentsCard } from './documents-card'
import { EdictLabelsCard } from './edict-labels-card'
import { KeyFigures } from './key-figures'
import { KurzgutachtenCard } from './kurzgutachten-card'
import { NotesCard } from './notes-card'
import { RelatedCard } from './related-card'
import { useListingDetail } from './use-listing-detail'

const PAGE = 'mx-auto flex w-full max-w-7xl flex-col gap-6 px-6 py-6'
// The reading column and a fixed side column from 1024 px; narrower windows stack them.
const COLUMNS = 'grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]'

/**
 * One listing: title and key figures on top, then the AI analysis with the
 * Kurzgutachten and area values as the reading column, and the documents,
 * edict facts, notes and related edicts beside it.
 */
export function DetailScreen({ id }: { id: string }) {
  const { t } = useTranslation()
  const { navigate } = useApp()
  const { state, reload, retry } = useListingDetail(id)
  const back = () => navigate({ screen: 'listings' })

  if (state.status !== 'ready') {
    return (
      <div className={PAGE}>
        <div className="self-start">
          <BackToListButton onBack={back} />
        </div>
        {state.status === 'loading' ? (
          <DetailSkeleton label={t('common.loading')} />
        ) : state.code === 'not_found' ? (
          <EmptyState
            icon={<SearchIcon />}
            title={t('detail.notFoundTitle')}
            description={t('errors.not_found')}
            action={<Button onClick={back}>{t('detail.backToList')}</Button>}
          />
        ) : (
          <EmptyState
            icon={<AlertCircleIcon />}
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
      <KeyFigures detail={detail} />
      <div className={COLUMNS}>
        <div className="flex min-w-0 flex-col gap-6">
          <AnalysisCard detail={detail} reload={reload} reloadError={reloadError} />
          {detail.kurzgutachten !== null && <KurzgutachtenCard facts={detail.kurzgutachten} />}
          <AreaCandidatesCard detail={detail} />
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <DocumentsCard documents={detail.documents} />
          <AuctionFacts detail={detail} />
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

const FRAME = 'rounded-lg border border-border bg-surface'

/** The page's outline while the listing loads, so nothing jumps when it arrives. */
function DetailSkeleton({ label }: { label: string }) {
  return (
    <div role="status" className="flex flex-col gap-6">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <Skeleton className="h-6 w-48 rounded-full" />
        <Skeleton className="h-9 w-2/3" />
        <Skeleton className="h-5 w-1/2" />
      </div>
      <div aria-hidden="true" className={`${FRAME} grid grid-cols-4 divide-x divide-border`}>
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="flex flex-col gap-2 px-5 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-28" />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className={COLUMNS}>
        <div className={`${FRAME} flex h-96 flex-col gap-4 p-6`}>
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <div className="flex flex-col gap-6">
          <div className={`${FRAME} flex h-48 flex-col gap-4 p-6`}>
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <div className={`${FRAME} h-64`} />
        </div>
      </div>
    </div>
  )
}
