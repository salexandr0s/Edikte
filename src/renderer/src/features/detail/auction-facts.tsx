import { useId, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { priceForBasis, pricePerSqm } from '@shared/area'
import type { ListingDetail } from '@shared/domain'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'
import { joinPresent, knownZubehoer } from './detail-helpers'
import { Fact, FactList } from './fact-list'

/** The facts from the edict page that the key figures leave out. */
export function AuctionFacts({ detail }: { detail: ListingDetail }) {
  const { t } = useTranslation()
  const format = useFormat()
  const notStated = t('common.notStated')

  const landRegister = joinPresent(
    [
      detail.grundbuch === null ? null : t('detail.facts.kg', { value: detail.grundbuch }),
      detail.ez === null ? null : t('detail.facts.ez', { value: detail.ez }),
    ],
    ', ',
  )
  // The key figures show the chosen price basis; the other one sits here.
  const otherBasis = detail.priceBasis === 'schaetzwert' ? 'geringstes_gebot' : 'schaetzwert'
  const otherPerSqm = pricePerSqm(priceForBasis(otherBasis, detail), detail.area?.sqm ?? null)
  const perLand = detail.area?.kind === 'grundflaeche'
  const approximate = detail.approximate.length > 0
  const zubehoer = detail.zubehoer === null ? null : knownZubehoer(detail.zubehoer)

  return (
    <Card title={t('detail.facts.title')}>
      <FactList columns={2}>
        <Fact label={t('detail.facts.auction')}>
          {detail.auctionAt === null ? notStated : format.localDateTime(detail.auctionAt)}
        </Fact>
        <Fact
          label={t('detail.facts.place')}
          lang={detail.auctionPlace === null ? undefined : 'de'}
        >
          {detail.auctionPlace ?? notStated}
        </Fact>
        <Fact
          label={t('detail.facts.viewing')}
          lang={detail.viewing === null ? undefined : 'de'}
          className="col-span-full"
        >
          {detail.viewing ?? notStated}
        </Fact>
        <Fact label={t('detail.facts.court')} lang={detail.court === null ? undefined : 'de'}>
          {detail.court ?? notStated}
        </Fact>
        <Fact label={t('detail.facts.caseNumber')}>{detail.caseNumber ?? notStated}</Fact>
        <Fact label={t('detail.facts.published')}>
          {detail.publishedAt === null ? notStated : format.localDate(detail.publishedAt)}
        </Fact>
        <Fact label={t('detail.facts.landRegister')}>
          {landRegister === '' ? notStated : landRegister}
        </Fact>
        {detail.plotSqm !== null && (
          <Fact label={t('detail.numbers.plot')}>{format.sqm(detail.plotSqm)}</Fact>
        )}
        {otherPerSqm !== null && (
          <Fact
            label={
              perLand
                ? t(`detail.numbers.perSqmLand.${otherBasis}`)
                : t(`detail.numbers.perSqm.${otherBasis}`)
            }
          >
            {`${approximate ? '≈ ' : ''}${format.eurPerSqm(otherPerSqm)}`}
          </Fact>
        )}
        {detail.zubehoer !== null &&
          (zubehoer === null ? (
            <Fact label={t('detail.numbers.zubehoer')} lang="de" className="col-span-full">
              {detail.zubehoer}
            </Fact>
          ) : (
            <Fact label={t('detail.numbers.zubehoer')} className="col-span-full">
              {t(`detail.numbers.zubehoerValue.${zubehoer}`)}
            </Fact>
          ))}
        {detail.remarks !== null && (
          <Fact label={t('detail.facts.remarks')} className="col-span-full">
            <ClampedText text={detail.remarks} />
          </Fact>
        )}
      </FactList>
    </Card>
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
