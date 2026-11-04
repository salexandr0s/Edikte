// Public API of the documents module for the main process. extract.ts is not
// re-exported: it loads pdf.js and runs only in the utility process.

export {
  DEFAULT_MAX_DOCUMENT_BYTES,
  downloadDocument,
  type DownloadedFile,
  type DownloadOptions,
  type DownloadProgress,
} from './download'
export { parseDownloadUrl } from './url-policy'
export { safePdfFileName } from './file-names'
export type { ExtractedDocument, ExtractedPage } from './extract'
export { extractInUtilityProcess } from './extract-host'
export { estimateArea, type EstimatePage, type LocalAreaEstimate } from './estimate'
export {
  rasterPageLocation,
  renderPdfPages,
  type RasterOptions,
  type RasterPageLocation,
} from './raster'
export { MAX_RASTER_PAGES, type RasterImage, type RasterResult } from './raster-protocol'
export {
  DOCUMENT_SCHEME_PRIVILEGES,
  installDocumentProtocol,
  openPdfWindow,
  registerDocumentScheme,
  type OpenPdfOptions,
} from './pdf-window'
export { DOCUMENT_SCHEME, resolveDocumentFile } from './document-protocol'
export {
  processDocument,
  type AreaEstimateRow,
  type DocumentPageRow,
  type DocumentStore,
  type PipelineDeps,
  type PipelineDocument,
  type PipelineOptions,
  type PipelineResult,
} from './pipeline'
export {
  createFillRunner,
  planFill,
  runFill,
  type FillCandidate,
  type FillOutcome,
  type FillRunner,
} from './fill'
export {
  deleteDocumentFiles,
  selectExpiredDocuments,
  type DeleteOutcome,
  type RetentionCandidate,
} from './retention'
