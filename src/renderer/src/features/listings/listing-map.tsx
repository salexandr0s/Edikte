import type * as Leaflet from 'leaflet'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { priceForBasis } from '@shared/area'
import type { GeocodeProgress, ListingRow } from '@shared/domain'
import { BASEMAP_TILE_TEMPLATE, TILE_MAX_ZOOM, TILE_URL_TEMPLATE } from '@shared/map'
import { Button } from '../../components/ui/button'
import { EmptyState } from '../../components/ui/empty-state'
import { AlertCircleIcon, FitIcon } from '../../components/ui/icons'
import { Spinner } from '../../components/ui/spinner'
import { useApp } from '../../lib/app-context'
import { usingMockBridge } from '../../lib/bridge'
import { cx } from '../../lib/cx'
import { useFormat } from '../../lib/format'
import { PinCard } from './map-card'
import { Attribution, MapStatus, ScaleBar, TilesFailedNotice, ZoomButtons } from './map-controls'
import { clusterPins, groupPins, pinsSignature, type Pin, type Place } from './map-pins'
import 'leaflet/dist/leaflet.css'
import './listing-map.css'

// The map view: one pin per address, one for several that would overlap at
// the zoom, and a card for the chosen pin. Leaflet draws the tiles and the
// pins; the controls over the map are the app's own. Tiles come from main
// (the app scheme); in a browser against the mock bridge they come from
// basemap.at.

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
/**
 * What the overlays cover, in pixels from each edge: the card column on the
 * left, the chip and the button along the top, the controls at the bottom
 * right. A chosen pin is panned out from under them.
 */
const COVERED = { left: 12 + 320 + 16, top: 56, right: 56, bottom: 56 }
/** Seconds; the contract's slow step. */
const PAN_DURATION = 0.22

interface ListingMapProps {
  rows: ListingRow[]
  geocode: GeocodeProgress
  onOpen: (row: ListingRow) => void
}

export function ListingMap({ rows, geocode, onOpen }: ListingMapProps) {
  const { t } = useTranslation()
  const format = useFormat()
  const { settings } = useApp()
  const element = useRef<HTMLDivElement>(null)
  const leaflet = useRef<typeof Leaflet | null>(null)
  const tilesRef = useRef<Leaflet.TileLayer | null>(null)
  const markers = useRef<Leaflet.LayerGroup | null>(null)
  const markerByKey = useRef(new Map<string, Leaflet.Marker>())
  /** The user panned or zoomed since the last fit; new pins then leave the view alone. */
  const touched = useRef(false)
  const fitting = useRef(false)
  const fittedPins = useRef<string | null>(null)
  /** The pin the map was last panned for, so a refresh of the rows does not pan again. */
  const pannedFor = useRef<string | null>(null)
  /** The map once Leaflet has built it; the controls render against it. */
  const [map, setMap] = useState<Leaflet.Map | null>(null)
  const [failed, setFailed] = useState(false)
  const [tilesFailed, setTilesFailed] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  /** The zoom the pins are grouped for; Leaflet reports each change. */
  const [zoom, setZoom] = useState<number | null>(null)

  const places = useMemo(() => groupPins(rows), [rows])
  // What the zoom shows: places whose labels would overlap become one pin.
  const pins = useMemo(
    () =>
      map === null || zoom === null
        ? []
        : clusterPins(places, (place) => map.project([place.lat, place.lng], zoom)),
    [map, zoom, places],
  )
  const selected = pins.find((pin) => pin.key === selectedKey) ?? null
  const withoutLocation = rows.length - places.reduce((sum, place) => sum + place.rows.length, 0)
  const homeBounds = settings.syncBundeslaender.every((land) => land === 'wien')
    ? VIENNA_BOUNDS
    : AUSTRIA_BOUNDS

  useEffect(() => {
    let cancelled = false
    let created: Leaflet.Map | null = null
    const container = element.current
    const byKey = markerByKey.current
    if (container === null) return
    import('leaflet')
      .then((L) => {
        if (cancelled) return
        leaflet.current = L
        const instance = L.map(container, {
          zoomControl: false,
          attributionControl: false,
          minZoom: MIN_ZOOM,
          maxZoom: TILE_MAX_ZOOM,
          maxBounds: MAX_BOUNDS,
          maxBoundsViscosity: 1,
          zoomSnap: 0.5,
        })
        created = instance
        // A view from the start, so the controls can measure the map before the pins are fitted.
        instance.fitBounds(homeBounds, { padding: FIT_PADDING, animate: false })
        let errors = 0
        let loaded = 0
        tilesRef.current = L.tileLayer(
          usingMockBridge ? BASEMAP_TILE_TEMPLATE : TILE_URL_TEMPLATE,
          {
            maxZoom: TILE_MAX_ZOOM,
            noWrap: true,
            // basemap.at serves the tiles that touch Austria; any other would come back 404.
            bounds: AUSTRIA_BOUNDS,
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
          .addTo(instance)
        markers.current = L.layerGroup().addTo(instance)
        instance.on('zoomstart dragstart', () => {
          if (!fitting.current) touched.current = true
        })
        instance.on('click', () => setSelectedKey(null))
        instance.on('zoomend', () => setZoom(instance.getZoom()))
        setZoom(instance.getZoom())
        setMap(instance)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      setMap(null)
      setZoom(null)
      fittedPins.current = null
      pannedFor.current = null
      byKey.clear()
      created?.remove()
      markers.current = null
      tilesRef.current = null
    }
  }, [homeBounds])

  /** Shows every place, or the home region when there is none. */
  const fit = useCallback(
    (target: Place[]) => {
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
          const bounds = L.latLngBounds(target.map((place): LatLngTuple => [place.lat, place.lng]))
          map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM, animate: false })
        }
      } finally {
        fitting.current = false
      }
      touched.current = false
      fittedPins.current = pinsSignature(target)
    },
    [map, homeBounds],
  )

  // The pins follow the rows and the zoom; the view follows the places until the user moves it.
  useEffect(() => {
    const L = leaflet.current
    const group = markers.current
    if (map === null || L === null || group === null) return
    /** Zooms in on a pin's places when that tells them apart; false when it would not. */
    const zoomApart = (pin: Pin): boolean => {
      const bounds = L.latLngBounds(pin.places.map((place): LatLngTuple => [place.lat, place.lng]))
      const target = Math.min(map.getBoundsZoom(bounds, false, L.point(FIT_PADDING)), TILE_MAX_ZOOM)
      if (target <= map.getZoom()) return false
      const apart = clusterPins(pin.places, (place) => map.project([place.lat, place.lng], target))
      if (apart.length === 1) return false
      map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: TILE_MAX_ZOOM })
      return true
    }
    // The pins are rebuilt; one that had the focus hands it back, or on to the map.
    const focused =
      [...markerByKey.current].find(
        ([, marker]) => marker.getElement() === document.activeElement,
      )?.[0] ?? null
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
      const content = document.createElement('span')
      content.className = 'edk-pin__text'
      content.textContent = text
      label.append(content)
      if (pin.rows.length > 1) {
        const count = document.createElement('span')
        count.className = 'edk-pin__count'
        count.textContent = format.number(pin.rows.length)
        label.append(count)
      }
      const marker = L.marker([pin.lat, pin.lng], {
        icon: L.divIcon({
          className: cx(
            'edk-pin',
            pin.approximate && 'edk-pin--approximate',
            pin.places.length > 1 && 'edk-pin--cluster',
          ),
          html: label,
          iconSize: [0, 0],
        }),
        keyboard: true,
        title: name,
        // The map's own click clears the choice; a pin's click must not reach it.
        bubblingMouseEvents: false,
      })
      marker.on('click', () => {
        if (pin.places.length > 1 && zoomApart(pin)) return
        setSelectedKey(pin.key)
      })
      group.addLayer(marker)
      marker.getElement()?.setAttribute('aria-label', name)
      markerByKey.current.set(pin.key, marker)
    }
    if (focused !== null) {
      const next = markerByKey.current.get(focused)?.getElement() ?? map.getContainer()
      next.focus()
    }
    const signature = pinsSignature(places)
    if (signature !== fittedPins.current && !touched.current) fit(places)
  }, [map, pins, places, fit, format, t])

  // The chosen pin is marked, and panned into the open when an overlay covers it.
  useEffect(() => {
    for (const [key, marker] of markerByKey.current) {
      const chosen = selected !== null && key === selected.key
      marker.getElement()?.classList.toggle('is-selected', chosen)
      marker.setZIndexOffset(chosen ? 1000 : 0)
    }
    if (map === null || selected === null || pannedFor.current === selected.key) return
    pannedFor.current = selected.key
    const point = map.latLngToContainerPoint([selected.lat, selected.lng])
    const size = map.getSize()
    const dx =
      point.x < COVERED.left
        ? point.x - COVERED.left
        : Math.max(0, point.x - (size.x - COVERED.right))
    const dy =
      point.y < COVERED.top
        ? point.y - COVERED.top
        : Math.max(0, point.y - (size.y - COVERED.bottom))
    if (dx !== 0 || dy !== 0) map.panBy([dx, dy], { duration: PAN_DURATION })
  }, [map, selected])

  // The map fills what the screen leaves it; a new size needs new tiles.
  useEffect(() => {
    const container = element.current
    if (map === null || container === null) return
    let frame = 0
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (touched.current) map.invalidateSize({ pan: false })
        else fit(places)
      })
    })
    observer.observe(container)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }, [map, fit, places])

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

      {map === null && (
        <div className="absolute inset-0 flex items-center justify-center">
          {failed ? (
            <EmptyState icon={<AlertCircleIcon />} title={t('map.loadFailed')} />
          ) : (
            <div role="status" className="flex flex-col items-center gap-3 text-sm text-fg-muted">
              <Spinner className="size-5" />
              {t('map.loading')}
            </div>
          )}
        </div>
      )}

      {map !== null && (
        <>
          {/* The chip and the card share the left column; the card takes what the chip leaves. */}
          <div className="edk-map-overlay top-3 bottom-10 left-3 flex w-80 flex-col items-start gap-2 pointer-events-none">
            <MapStatus
              geocode={geocode}
              withoutLocation={withoutLocation}
              className="pointer-events-auto"
            />
            {selected !== null && (
              <PinCard
                pin={selected}
                onOpen={onOpen}
                onClose={() => {
                  setSelectedKey(null)
                  markerByKey.current.get(selected.key)?.getElement()?.focus()
                }}
                className="pointer-events-auto w-full"
              />
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="edk-map-overlay top-3 right-3 shadow-md"
            onClick={() => fit(places)}
          >
            <FitIcon className="text-fg-muted" />
            {t('map.showAll')}
          </Button>
          <div className="edk-map-overlay right-3 bottom-3 flex flex-col items-end gap-2">
            <ScaleBar map={map} />
            <ZoomButtons map={map} />
          </div>
          <Attribution />
          {tilesFailed && (
            <TilesFailedNotice
              onRetry={() => {
                setTilesFailed(false)
                tilesRef.current?.redraw()
              }}
            />
          )}
        </>
      )}
    </div>
  )
}
