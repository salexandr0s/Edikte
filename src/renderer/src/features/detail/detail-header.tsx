import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListingDetail } from '@shared/domain'
import { bezirkName } from '@shared/wien-bezirke'
import { Button } from '../../components/ui/button'
import {
  AlertIcon,
  ChevronLeftIcon,
  ExternalLinkIcon,
  MapPinIcon,
  StarIcon,
} from '../../components/ui/icons'
import { useToast } from '../../components/ui/toast'
import { errorCode, invoke } from '../../lib/bridge'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'
import { joinPresent } from './detail-helpers'
import { ListingStatusBadge } from './status-badge'
import { useOpenExternal } from './use-detail-actions'

/** The way back to the list, shown above the title and while the listing loads. */
export function BackToListButton({ onBack }: { onBack: () => void }) {
  const { t } = useTranslation()
  return (
    <Button variant="ghost" size="sm" className="-ml-3 text-fg-muted" onClick={onBack}>
      <ChevronLeftIcon />
      {t('detail.backToList')}
    </Button>
  )
}

interface DetailHeaderProps {
  detail: ListingDetail
  onBack: () => void
}

/** Back and the actions on one row, then status, title and address. */
export function DetailHeader({ detail, onBack }: DetailHeaderProps) {
  const { t } = useTranslation()
  const format = useFormat()
  const openExternal = useOpenExternal()

  const address = joinPresent([detail.street, joinPresent([detail.plz, detail.city], ' ')], ', ')
  const district =
    detail.bundesland === 'wien' && detail.bezirk !== null
      ? t('bezirk.full', { number: detail.bezirk, name: bezirkName(detail.bezirk) ?? '' })
      : null
  const location = joinPresent([address, district], ' · ')

  return (
    <header className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackToListButton onBack={onBack} />
        <div className="flex flex-wrap gap-2">
          <StarToggle caseKey={detail.caseKey} starred={detail.starred} />
          <Button variant="outline" size="sm" onClick={() => void openExternal(detail.url)}>
            {t('detail.openOnSite', {
              host:
                detail.source === 'insolvency_sale' ? 'justizonline.gv.at' : 'edikte.justiz.gv.at',
            })}
            <ExternalLinkIcon className="text-fg-muted" />
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
          <ListingStatusBadge status={detail.status} />
          <span>{t(`noticeType.${detail.noticeType}`)}</span>
          <span aria-hidden="true">·</span>
          <span>
            {t(`propertyType.${detail.propertyType}`)}
            {detail.categoryLabel !== null && <span lang="de"> ({detail.categoryLabel})</span>}
          </span>
        </div>
        <h1
          lang="de"
          tabIndex={-1}
          className="text-3xl font-semibold tracking-tight wrap-break-word outline-none"
        >
          {detail.title}
        </h1>
        <p className="flex items-center gap-2 text-base text-fg-muted">
          <MapPinIcon className="shrink-0" />
          <span>{location === '' ? t('common.notStated') : location}</span>
        </p>
        {detail.removedAt !== null && (
          <p className="flex items-center gap-2 rounded-md border border-warning-subtle bg-warning-subtle/40 px-4 py-3 text-sm text-warning-text">
            <AlertIcon />
            {t('detail.removed', { date: format.timestamp(detail.removedAt) })}
          </p>
        )}
      </div>
    </header>
  )
}

/** Stars the case. Shows the new state at once and reverts it when saving fails. */
function StarToggle({ caseKey, starred }: { caseKey: string; starred: boolean }) {
  const { t } = useTranslation()
  const toast = useToast()
  const [optimistic, setOptimistic] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const shown = optimistic ?? starred

  async function toggle() {
    if (saving) return
    const next = !shown
    setOptimistic(next)
    setSaving(true)
    try {
      const state = await invoke('userState:update', { caseKey, starred: next })
      setOptimistic(state.starred)
    } catch (error) {
      setOptimistic(null)
      toast({
        kind: 'error',
        title: t('detail.starFailed'),
        description: t(`errors.${errorCode(error)}`),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      aria-pressed={shown}
      className={cx(shown && 'border-warning-subtle bg-warning-subtle/40')}
      onClick={() => void toggle()}
    >
      <StarIcon filled={shown} className={shown ? 'text-warning-text' : 'text-fg-muted'} />
      {t('detail.star')}
    </Button>
  )
}
