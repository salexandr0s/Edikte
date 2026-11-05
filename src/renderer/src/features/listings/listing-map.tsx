import type * as Leaflet from 'leaflet'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { priceForBasis } from '@shared/area'
import type { GeocodeProgress, ListingRow } from '@shared/domain'
import { bezirkName } from '@shared/wien-bezirke'
import { BASEMAP_TILE_TEMPLATE, TILE_MAX_ZOOM, TILE_URL_TEMPLATE } from '@shared/map'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { CloseIcon } from '../../components/ui/icons'
import { Spinner } from '../../components/ui/spinner'
import { useApp } from '../../lib/app-context'
import { usingMockBridge } from '../../lib/bridge'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'
import { STATUS_VARIANT, addressLine } from './listing-row'
import 'leaflet/dist/leaflet.css'
import './listing-map.css'

// The map view: one pin per address, grouped where several auctions share
// one, and a card for the chosen pin. Tiles come from main (the app scheme);
// in a browser against the mock bridge they come from basemap.at directly.

type LatLngTuple = [number, number]
type BoundsTuple = [LatLngTuple, LatLngTuple]

/** Where the map starts before any pin is known: the synced scope. */
const VIENNA_BOUNDS: BoundsTuple = [
  [48.118, 16.182],
  [48.323, 16.577],
]
const AUSTRIA_BOUNDS: BoundsTuple = [
  [46.372, 9.531],
  [49.021, 17.161],
]
/** Austria with a margin; the layer covers no more than that. */
const MAX_BOUNDS: BoundsTuple = [
  [45.5, 8.3],
  [49.9, 18.4],
]
const MIN_ZOOM = 6
/** How close "show all" zooms in on a single pin. */
const FIT_MAX_ZOOM = 16
const FIT_PADDING: LatLngTuple = [48, 48]

interface Pin {
  key: string
  lat: number
  lng: number
  /** Only the town is known for every auction at this pin. */
  approximate: boolean
  /** Cheapest first. */
  rows: ListingRow[]
}

interface ListingMapProps {
  rows: ListingRow[]
  geocode: GeocodeProgress
  onOpen: (row: ListingRow) => void
}

export function ListingMap({ rows, geocode, onOpen }: ListingMapProps) {
  const { t, i18n } = useTranslation()
  const format = useFormat()
  const { settings } = useApp()
  const element = useRef<HTMLDivElement>(null)
  const leaflet = useRef<typeof Leaflet | null>(null)
  const mapRef = useRef<Leaflet.Map | null>(null)
  const tilesRef = useRef<Leaflet.TileLayer | null>(null)
  const markers = useRef<Leaflet.LayerGroup | null>(null)
  const markerByKey = useRef(new Map<string, Leaflet.Marker>())
  /** The user panned or zoomed since the last fit; new pins then leave the view alone. */
  const touched = useRef(false)
  const fitting = useRef(false)
  const fittedPins = useRef<string | null>(null)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [tilesFailed, setTilesFailed] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const pins = groupPins(rows)
  const selected = pins.find((pin) => pin.key === selectedKey) ?? null
  const withoutLocation = rows.length - pins.reduce((sum, pin) => sum + pin.rows.length, 0)
  const language = i18n.resolvedLanguage ?? i18n.language
  const homeBounds = settings.syncBundeslaender.every((land) => land === 'wien')
    ? VIENNA_BOUNDS
    : AUSTRIA_BOUNDS

  useEffect(() => {
    let cancelled = false
    const container = element.current
    const byKey = markerByKey.current
    if (container === null) return
    import('leaflet')
      .then((L) => {
        if (cancelled) return
        leaflet.current = L
        const map = L.map(container, {
          zoomControl: false,
          minZoom: MIN_ZOOM,
          maxZoom: TILE_MAX_ZOOM,
          maxBounds: MAX_BOUNDS,
          maxBoundsViscosity: 1,
          zoomSnap: 0.5,
          attributionControl: true,
        })
        mapRef.current = map
        map.attributionControl.setPrefix(false).setPosition('bottomleft')
        L.control
          .zoom({
            position: 'bottomright',
            zoomInTitle: t('map.zoomIn'),
            zoomOutTitle: t('map.zoomOut'),
          })
          .addTo(map)
        L.control.scale({ position: 'bottomright', imperial: false }).addTo(map)
        let errors = 0
        let loaded = 0
        tilesRef.current = L.tileLayer(
          usingMockBridge ? BASEMAP_TILE_TEMPLATE : TILE_URL_TEMPLATE,
          {
            attribution: t('map.attribution'),
            maxZoom: TILE_MAX_ZOOM,
            noWrap: true,
            updateWhenIdle: true,
            keepBuffer: 2,
          },
        )
          .on('loading', () => {
            errors = 0
            loaded = 0
          })
          .on('tileerror', () => {
            errors += 1
          })
          .on('tileload', () => {
            loaded += 1
          })
          // Nothing came through at all: offline, or the tile server is down.
          .on('load', () => setTilesFailed(errors > 0 && loaded === 0))
          .addTo(map)
        markers.current = L.layerGroup().addTo(map)
        map.on('zoomstart dragstart', () => {
          if (!fitting.current) touched.current = true
        })
        map.on('click', () => setSelectedKey(null))
        setReady(true)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      setReady(false)
      fittedPins.current = null
      byKey.clear()
      mapRef.current?.remove()
      mapRef.current = null
      markers.current = null
      tilesRef.current = null
    }
    // The controls carry translated titles, so a new language builds the map again.
  }, [language, t])

  /** Shows every pin, or the home region when there is none. */
  const fit = useCallback(
    (target: Pin[]) => {
      const map = mapRef.current
      const L = leaflet.current
      if (map === null || L === null) return
      map.stop()
      map.invalidateSize({ pan: false })
      const size = map.getSize()
      if (size.x === 0 || size.y === 0) return
      fitting.current = true
      try {
        if (target.length === 0) {
          map.fitBounds(homeBounds, { padding: FIT_PADDING, animate: false })
        } else {
          const bounds = L.latLngBounds(target.map((pin): LatLngTuple => [pin.lat, pin.lng]))
          map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, animate: false })
        }
      } finally {
        fitting.current = false
      }
      touched.current = false
      fittedPins.current = pinsSignature(target)
    },
    [homeBounds],
  )

  // The pins follow the rows; the view follows the pins until the user moves it.
  useEffect(() => {
    const L = leaflet.current
    const group = markers.current
    if (!ready || L === null || group === null) return
    group.clearLayers()
    markerByKey.current.clear()
    for (const pin of pins) {
      const cheapest = pin.rows[0]
      if (cheapest === undefined) continue
      const price = priceForBasis(cheapest.priceBasis, cheapest)
      const priceText =
        price === null ? t(`propertyType.${cheapest.propertyType}`) : format.eur(price)
      const text = pin.rows.length > 1 ? t('map.from', { value: priceText }) : priceText
      const name = t('map.pin', { price: text, count: pin.rows.length })
      const label = document.createElement('span')
      label.className = 'edk-pin__label'
      label.textContent = text
      if (pin.rows.length > 1) {
        const count = document.createElement('span')
        count.className = 'edk-pin__count'
        count.textContent = format.number(pin.rows.length)
        label.append(count)
      }
      const marker = L.marker([pin.lat, pin.lng], {
        icon: L.divIcon({
          className: cx('edk-pin', pin.approximate && 'edk-pin--approximate'),
          html: label,
          iconSize: [0, 0],
        }),
        keyboard: true,
        title: name,
        alt: name,
        // The map's own click clears the choice; a pin's click must not reach it.
        bubblingMouseEvents: false,
      })
      marker.on('click', () => setSelectedKey(pin.key))
      group.addLayer(marker)
      marker.getElement()?.setAttribute('aria-label', name)
      markerByKey.current.set(pin.key, marker)
    }
    const signature = pinsSignature(pins)
    if (signature !== fittedPins.current && !touched.current) fit(pins)
  }, [ready, pins, fit, format, t])

  useEffect(() => {
    for (const [key, marker] of markerByKey.current) {
      const chosen = key === selectedKey
      marker.getElement()?.classList.toggle('is-selected', chosen)
      marker.setZIndexOffset(chosen ? 1000 : 0)
    }
  }, [selectedKey, pins])

  // The map fills what the screen leaves it; a new size needs new tiles.
  useEffect(() => {
    const container = element.current
    if (!ready || container === null) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (touched.current) mapRef.current?.invalidateSize({ pan: false })
        else fit(pins)
      })
    })
    observer.observe(container)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [ready, fit, pins])

  return (
    <div
      className="edk-map relative isolate min-h-90 flex-1 overflow-hidden rounded-lg border border-border bg-bg-muted shadow-xs"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && selectedKey !== null) {
          event.stopPropagation()
          setSelectedKey(null)
        }
      }}
    >
      <div ref={element} role="region" aria-label={t('map.region')} className="absolute inset-0" />

      {!ready && (
        <div className="absolute inset-0 flex items-center justify-center">
          {failed ? (
            <p className="text-sm text-fg-muted">{t('map.loadFailed')}</p>
          ) : (
            <Spinner label={t('map.loading')} />
          )}
        </div>
      )}

      {ready && (
        <>
          <MapStatus geocode={geocode} withoutLocation={withoutLocation} />
          <Button
            variant="outline"
            size="sm"
            className="edk-map-overlay top-3 right-3 shadow-md"
            onClick={() => fit(pins)}
          >
            {t('map.showAll')}
          </Button>
        </>
      )}

      {selected !== null && (
        <PinCard
          pin={selected}
          onOpen={onOpen}
          onClose={() => {
            setSelectedKey(null)
            markerByKey.current.get(selected.key)?.getElement()?.focus()
          }}
        />
      )}

      {tilesFailed && (
        <p
          role="status"
          className="edk-map-overlay bottom-12 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-md border border-border bg-surface-elevated px-4 py-2 text-sm shadow-md"
        >
          {t('map.tilesFailed')}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setTilesFailed(false)
              tilesRef.current?.redraw()
            }}
          >
            {t('map.retryTiles')}
          </Button>
        </p>
      )}
    </div>
  )
}

/** Lookups in progress, or how many of the shown auctions have no pin. */
function MapStatus({
  geocode,
  withoutLocation,
}: {
  geocode: GeocodeProgress
  withoutLocation: number
}) {
  const { t } = useTranslation()
  if (!geocode.running && withoutLocation === 0) return null
  return (
    <p
      role="status"
      title={geocode.running ? undefined : t('map.missingHint')}
      className="edk-map-overlay top-3 left-3 flex items-center gap-2 rounded-md border border-border bg-surface-elevated px-3 py-1.5 text-xs text-fg-muted shadow-md"
    >
      {geocode.running ? (
        <>
          <Spinner className="size-3.5" />
          {t('map.lookingUp', { count: geocode.pending })}
        </>
      ) : (
        t('map.missing', { count: withoutLocation })
      )}
    </p>
  )
}

/** The auctions at the chosen pin, each a link to its page. */
function PinCard({
  pin,
  onOpen,
  onClose,
}: {
  pin: Pin
  onOpen: (row: ListingRow) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const format = useFormat()
  const first = pin.rows[0]
  if (first === undefined) return null
  const districtName = first.bezirk === null ? null : bezirkName(first.bezirk)
  const district =
    first.bezirk !== null && districtName !== null
      ? t('bezirk.full', { number: first.bezirk, name: districtName })
      : null
  const address = addressLine(first, district) ?? t('common.notStated')
  return (
    <section
      aria-label={address}
      // Ends above the attribution line in the corner.
      className="edk-map-overlay top-14 bottom-8 left-3 flex w-80 flex-col overflow-hidden rounded-lg border border-border bg-surface-elevated shadow-lg"
    >
      <header className="flex items-start gap-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{address}</p>
          <p className="text-xs text-fg-muted">
            {t('map.atLocation', { count: pin.rows.length })}
            {pin.approximate && ` · ${t('map.approximate')}`}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('common.close')}
          className="-mt-1 -mr-2"
          onClick={onClose}
        >
          <CloseIcon />
        </Button>
      </header>
      <ul className="min-h-0 overflow-y-auto">
        {pin.rows.map((row) => {
          const price = priceForBasis(row.priceBasis, row)
          const facts = [
            price === null ? null : format.eur(price),
            row.area === null ? null : format.sqm(row.area.sqm),
            row.pricePerSqm === null ? null : format.eurPerSqm(row.pricePerSqm),
          ].filter((fact): fact is string => fact !== null)
          return (
            <li key={row.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                data-listing-link={row.id}
                aria-label={t('map.open', { title: row.title })}
                onClick={() => onOpen(row)}
                className="flex w-full flex-col gap-1 px-4 py-3 text-left transition-colors duration-120 hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
              >
                <span className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.title}</span>
                  {row.status !== 'upcoming' && (
                    <Badge size="sm" variant={STATUS_VARIANT[row.status]}>
                      {t(`listingStatus.${row.status}`)}
                    </Badge>
                  )}
                </span>
                <span className="text-xs text-fg-muted">
                  {t(`propertyType.${row.propertyType}`)}
                  {row.auctionAt !== null && ` · ${format.localDateTime(row.auctionAt)}`}
                </span>
                {facts.length > 0 && (
                  <span className="text-sm text-fg tabular-nums">{facts.join(' · ')}</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** One pin per position; auctions whose address resolved to the same point share it. */
function groupPins(rows: ListingRow[]): Pin[] {
  const byKey = new Map<string, Pin>()
  for (const row of rows) {
    const location = row.location
    if (location === null) continue
    const key = `${location.lat.toFixed(5)},${location.lng.toFixed(5)}`
    const pin = byKey.get(key)
    if (pin === undefined) {
      byKey.set(key, {
        key,
        lat: location.lat,
        lng: location.lng,
        approximate: location.precision === 'place',
        rows: [row],
      })
    } else {
      pin.rows.push(row)
      if (location.precision !== 'place') pin.approximate = false
    }
  }
  for (const pin of byKey.values()) {
    pin.rows.sort((a, b) => {
      const priceA = priceForBasis(a.priceBasis, a) ?? Number.POSITIVE_INFINITY
      const priceB = priceForBasis(b.priceBasis, b) ?? Number.POSITIVE_INFINITY
      return priceA - priceB
    })
  }
  return [...byKey.values()]
}

function pinsSignature(pins: Pin[]): string {
  return pins
    .map((pin) => pin.key)
    .sort()
    .join(';')
}
