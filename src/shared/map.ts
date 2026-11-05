// Map tiles: the renderer asks main for them through an app scheme, main
// fetches them from basemap.at and keeps a copy on disk.

/** Scheme through which main serves map tiles to the renderer. */
export const TILE_SCHEME = 'edikte-tile'
/** Host part of a tile address; one layer for now. */
export const TILE_LAYER = 'basemap'
/** Leaflet template for the tile layer served by main. */
export const TILE_URL_TEMPLATE = `${TILE_SCHEME}://${TILE_LAYER}/{z}/{x}/{y}.png`
/**
 * The grey basemap.at layer (CC BY 4.0), with y before x. Main fetches tiles
 * from here; the renderer uses it only against the mock bridge in a browser.
 */
export const BASEMAP_TILE_TEMPLATE =
  'https://mapsneu.wien.gv.at/basemap/bmapgrau/normal/google3857/{z}/{y}/{x}.png'
/** Deepest zoom the layer serves. */
export const TILE_MAX_ZOOM = 19
