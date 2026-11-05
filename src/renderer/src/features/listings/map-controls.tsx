import type * as Leaflet from 'leaflet'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GeocodeProgress } from '@shared/domain'
import { Button } from '../../components/ui/button'
import { AlertCircleIcon, InfoIcon, MinusIcon, PlusIcon } from '../../components/ui/icons'
import { Spinner } from '../../components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '../../components/ui/tooltip'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'

// The chrome the app draws over the map. Leaflet's own zoom, scale and
// attribution controls stay off, so every control uses the app's tokens,
// icons and focus rings.

const CHIP =
  'inline-flex h-7 max-w-full items-center gap-2 rounded-full border border-border bg-surface-elevated px-3 text-xs font-medium text-fg shadow-md'

interface MapStatusProps {
  geocode: GeocodeProgress
  /** Shown auctions without a pin. */
  withoutLocation: number
  className?: string
}

/** Lookups in progress, or how many of the shown auctions have no pin, with the reason on hover. */
export function MapStatus({ geocode, withoutLocation, className }: MapStatusProps) {
  const { t } = useTranslation()
  if (geocode.running) {
    return (
      <p role="status" className={cx(CHIP, 'animate-fade-in', className)}>
        <Spinner className="size-3.5 text-accent-text" />
        <span className="truncate">{t('map.lookingUp', { count: geocode.pending })}</span>
      </p>
    )
  }
  if (withoutLocation === 0) return null
  return (
    <div role="status" className={cx('max-w-full animate-fade-in', className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className={cx(
              CHIP,
              'transition-colors duration-120 hover:border-border-strong hover:bg-surface-hover',
            )}
          >
            <span className="truncate">{t('map.missing', { count: withoutLocation })}</span>
            <InfoIcon className="size-3.5 shrink-0 text-fg-muted" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-64">
          {t('map.missingHint')}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

const ZOOM_BUTTON =
  'inline-flex size-8 items-center justify-center text-fg transition-colors duration-120 select-none hover:bg-surface-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none disabled:cursor-not-allowed disabled:text-fg-muted/50 disabled:hover:bg-transparent'

/** Zoom in and out, each disabled at its end of the tile layer's range. */
export function ZoomButtons({ map }: { map: Leaflet.Map }) {
  const { t } = useTranslation()
  const [zoom, setZoom] = useState(() => map.getZoom())
  useEffect(() => {
    const update = () => setZoom(map.getZoom())
    update()
    map.on('zoomend', update)
    return () => {
      map.off('zoomend', update)
    }
  }, [map])
  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-border bg-surface-elevated shadow-md">
      <button
        type="button"
        aria-label={t('map.zoomIn')}
        title={t('map.zoomIn')}
        disabled={zoom >= map.getMaxZoom()}
        className={ZOOM_BUTTON}
        onClick={() => map.zoomIn()}
      >
        <PlusIcon />
      </button>
      <button
        type="button"
        aria-label={t('map.zoomOut')}
        title={t('map.zoomOut')}
        disabled={zoom <= map.getMinZoom()}
        className={cx(ZOOM_BUTTON, 'border-t border-border')}
        onClick={() => map.zoomOut()}
      >
        <MinusIcon />
      </button>
    </div>
  )
}

/** The longest the bar gets; the distance shown is rounded down to 1, 2, 3 or 5 × 10ⁿ metres. */
const SCALE_MAX_WIDTH = 96
/** Keeps the number and its unit on one line. */
const NBSP = String.fromCharCode(0xa0)

interface Scale {
  meters: number
  width: number
}

/** A metric scale bar for the latitude in the middle of the view. */
export function ScaleBar({ map }: { map: Leaflet.Map }) {
  const format = useFormat()
  const [scale, setScale] = useState<Scale | null>(() => measureScale(map))
  useEffect(() => {
    const update = () => setScale(measureScale(map))
    update()
    map.on('moveend zoomend', update)
    return () => {
      map.off('moveend zoomend', update)
    }
  }, [map])
  if (scale === null) return null
  const label =
    scale.meters < 1000
      ? `${format.number(scale.meters)}${NBSP}m`
      : `${format.number(scale.meters / 1000, 1)}${NBSP}km`
  return (
    <div aria-hidden="true" className="flex flex-col items-end gap-0.5 text-xs text-fg-muted">
      <span className="rounded-full bg-surface/85 px-1.5 py-0.5 leading-none tabular-nums">
        {label}
      </span>
      <span
        className="h-1.5 border-x border-b border-border-strong"
        style={{ width: scale.width }}
      />
    </div>
  )
}

function measureScale(map: Leaflet.Map): Scale | null {
  const size = map.getSize()
  if (size.x === 0 || size.y === 0) return null
  const y = size.y / 2
  const maxMeters = map.distance(
    map.containerPointToLatLng([0, y]),
    map.containerPointToLatLng([SCALE_MAX_WIDTH, y]),
  )
  if (!(maxMeters > 0)) return null
  const meters = roundDownScale(maxMeters)
  return { meters, width: Math.round((SCALE_MAX_WIDTH * meters) / maxMeters) }
}

/** 1, 2, 3 or 5 times a power of ten, no more than the given distance. */
function roundDownScale(meters: number): number {
  const pow10 = 10 ** (Math.floor(meters).toString().length - 1)
  const d = meters / pow10
  return pow10 * (d >= 10 ? 10 : d >= 5 ? 5 : d >= 3 ? 3 : d >= 2 ? 2 : 1)
}

/** Where the map and the positions come from; basemap.at (CC BY 4.0) and OpenStreetMap (ODbL) ask for this line. */
export function Attribution() {
  const { t } = useTranslation()
  const text = t('map.attribution')
  return (
    <div className="edk-map-overlay right-12 bottom-3 left-3 flex pointer-events-none">
      <p
        title={text}
        className="pointer-events-auto max-w-full truncate rounded-full bg-surface/85 px-2.5 py-0.5 text-xs text-fg-muted"
      >
        {text}
      </p>
    </div>
  )
}

/** Shown when no tile came through: offline, or basemap.at is down. */
export function TilesFailedNotice({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="edk-map-overlay bottom-16 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-md border border-border bg-surface-elevated py-2 pr-2 pl-4 text-sm whitespace-nowrap shadow-lg animate-pop-in"
    >
      <AlertCircleIcon className="shrink-0 text-warning-text" />
      <span>{t('map.tilesFailed')}</span>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('map.retryTiles')}
      </Button>
    </div>
  )
}
