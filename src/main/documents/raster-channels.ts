// Contract between the main process, the raster preload and the raster page.
// It imports nothing, so the sandboxed preload and the page can bundle it.

export const RASTER_CHANNELS = {
  job: 'pdf-raster:job',
  page: 'pdf-raster:page',
  done: 'pdf-raster:done',
} as const

export interface RasterJob {
  pdf: Uint8Array
  /** 1-based PDF page numbers, in the order to render. */
  pages: number[]
  /** Long side of each image in pixels. */
  maxSide: number
  /** JPEG quality between 0 and 1. */
  quality: number
}

export interface RasterPageResult {
  page: number
  jpeg: Uint8Array
  width: number
  height: number
}

export interface RasterFailure {
  page: number
  reason: string
}

export interface RasterDone {
  failed: RasterFailure[]
  /** Set when the document could not be opened at all. */
  error: string | null
}

/** Exposed by src/preload/pdf-raster.ts as `window.pdfRaster`. */
export interface PdfRasterApi {
  getJob(): Promise<unknown>
  sendPage(result: RasterPageResult): Promise<void>
  finish(result: RasterDone): Promise<void>
}
