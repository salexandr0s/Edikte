import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ListingDetail } from '@shared/domain'
import { bezirkName } from '@shared/wien-bezirke'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { AlertIcon, ChevronLeftIcon, ExternalLinkIcon, StarIcon } from '../../components/ui/icons'
import { useToast } from '../../components/ui/toast'
import { errorCode, invoke } from '../../lib/bridge'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'
import { joinPresent } from './detail-helpers'
import { Fact, FactList } from './fact-list'
import { ListingStatusBadge } from './status-badge'
import { useOpenExternal } from './use-detail-actions'

interface DetailHeaderProps {
  detail: ListingDetail
  onBack: () => void
}

/** Back button, title, status and actions, then the facts from the edict page. */
export function DetailHeader({ detail, onBack }: DetailHeaderProps) {
  const { t } = useTranslation()
  const format = useFormat()
  const openExternal = useOpenExternal()
  const notStated = t('common.notStated')

  const address = joinPresent([detail.street, joinPresent([detail.plz, detail.city], ' ')], ', ')
  const district =
    detail.bundesland === 'wien' && detail.bezirk !== null
      ? t('bezirk.full', { number: detail.bezirk, name: bezirkName(detail.bezirk) ?? '' })
      : null
  const location = joinPresent([address, district], ' · ')
  const landRegister = joinPresent(
    [
      detail.grundbuch === null ? null : t('detail.facts.kg', { value: detail.grundbuch }),
      detail.ez === null ? null : t('detail.facts.ez', { value: detail.ez }),
    ],
    ', ',
  )

  return (
    <header className="flex flex-col gap-5">
      <Button variant="ghost" size="sm" className="-ml-3 self-start" onClick={onBack}>
        <ChevronLeftIcon />
        {t('common.back')}
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ListingStatusBadge status={detail.status} />
            <span className="text-sm text-fg-muted">{t(`noticeType.${detail.noticeType}`)}</span>
          </div>
          <h1
            lang="de"
            tabIndex={-1}
            className="text-2xl font-semibold tracking-tight wrap-break-word outline-none"
          >
            {detail.title}
          </h1>
          <p className="text-sm text-fg-muted">{location === '' ? notStated : location}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <StarToggle caseKey={detail.caseKey} starred={detail.starred} />
          <Button variant="outline" onClick={() => void openExternal(detail.url)}>
            {t('common.openOnSite')}
            <ExternalLinkIcon />
          </Button>
        </div>
      </div>

      {detail.removedAt !== null && (
        <p className="flex items-center gap-2 text-sm text-warning-text">
          <AlertIcon />
          {t('detail.removed', { date: format.timestamp(detail.removedAt) })}
        </p>
      )}

      <Card>
        <FactList columns={4}>
          <Fact label={t('detail.facts.auction')}>
            {detail.auctionAt === null ? notStated : format.localDateTime(detail.auctionAt)}
          </Fact>
          <Fact
            label={t('detail.facts.place')}
            lang={detail.auctionPlace === null ? undefined : 'de'}
          >
            {detail.auctionPlace ?? notStated}
          </Fact>
          <Fact label={t('detail.facts.viewing')} lang={detail.viewing === null ? undefined : 'de'}>
            {detail.viewing ?? notStated}
          </Fact>
          <Fact label={t('detail.facts.published')}>
            {detail.publishedAt === null ? notStated : format.localDate(detail.publishedAt)}
          </Fact>
          <Fact label={t('detail.facts.court')} lang={detail.court === null ? undefined : 'de'}>
            {detail.court ?? notStated}
          </Fact>
          <Fact label={t('detail.facts.caseNumber')}>{detail.caseNumber ?? notStated}</Fact>
          <Fact label={t('detail.facts.propertyType')}>
            {t(`propertyType.${detail.propertyType}`)}
            {detail.categoryLabel !== null && (
              <span lang="de" className="text-fg-muted">
                {' '}
                ({detail.categoryLabel})
              </span>
            )}
          </Fact>
          <Fact label={t('detail.facts.landRegister')}>
            {landRegister === '' ? notStated : landRegister}
          </Fact>
          {detail.remarks !== null && (
            <Fact label={t('detail.facts.remarks')} className="col-span-full">
              <ClampedText text={detail.remarks} />
            </Fact>
          )}
        </FactList>
      </Card>
    </header>
  )
}

/**
 * Site text that can run to a page, such as the remarks, cut to three lines
 * with a button that shows the rest. The button appears only when lines were cut.
 */
function ClampedText({ text }: { text: string }) {
  const { t } = useTranslation()
  const id = useId()
  const ref = useRef<HTMLSpanElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [cut, setCut] = useState(false)
  useLayoutEffect(() => {
    const element = ref.current
    if (element !== null && !expanded) setCut(element.scrollHeight > element.clientHeight)
  }, [text, expanded])
  return (
    <span className="flex flex-col items-start gap-1">
      <span id={id} ref={ref} lang="de" className={cx(!expanded && 'line-clamp-3')}>
        {text}
      </span>
      {(cut || expanded) && (
        <Button
          variant="link"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? t('detail.facts.showLess') : t('detail.facts.showMore')}
        </Button>
      )}
    </span>
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
      aria-pressed={shown}
      className={cx(shown && 'bg-bg-muted')}
      onClick={() => void toggle()}
    >
      <StarIcon filled={shown} className={cx(shown && 'text-accent-text')} />
      {t('detail.star')}
    </Button>
  )
}
