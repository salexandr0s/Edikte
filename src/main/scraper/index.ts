export { PARSER_VERSION } from './parser-version'
export {
  CLIENT_DEFAULTS,
  EdikteClient,
  userAgent,
  type EdikteClientOptions,
  type PageSource,
} from './client'
export {
  SEARCH_MAX,
  SearchFilterSchema,
  SearchRowSchema,
  buildSearchQuery,
  buildSearchUrl,
  parseSearchResults,
  splitPlace,
  type Place,
  type SearchFilter,
  type SearchResult,
  type SearchRow,
} from './search'
export {
  DetailFieldsSchema,
  DocumentLinkSchema,
  parseDetailPage,
  type ChainEntry,
  type ChangeLogEntry,
  type DetailFields,
  type DocumentLink,
  type ParsedDetail,
} from './detail'
export { parseKurzgutachten } from './kurzgutachten'
export { buildCaseKey, type CaseKeyParts } from './case-key'
export { buildEdictRecord, type EdictRecord, type EdictRecordInput } from './edict-record'
export {
  HEALTH_MIN_PAGES,
  HEALTH_MISSING_LIMIT,
  assessRunHealth,
  type HealthSample,
  type RunHealth,
} from './health'
export { computeContentHash } from './content-hash'
export { detailUrl } from './site-text'
export {
  FAILED_PAGE_LIMIT,
  FULL_SYNC_INTERVAL_MS,
  REFRESH_AFTER_MS,
  runSync,
  type EdictWrite,
  type KnownEdict,
  type SyncCommit,
  type SyncOptions,
  type SyncRunStart,
  type SyncStore,
  type SyncStoreState,
} from './sync'
