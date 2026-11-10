import { AUCTION_EDICT_ID_PATTERN, insolvencyRecordNumber } from '@shared/edict-id'
import { EDIKTE_HOST, JUSTIZONLINE_API_PATH, JUSTIZONLINE_HOST } from '@shared/edikte-codes'
import { insolvencyFileUrl } from '../scraper/insolvency/api'

// Download URL guard ported from immoradar's outbound-url-policy.ts and narrowed
// to the two hosts that publish documents. Its private-address checks are left
// out: they cannot apply to fixed public hosts.

/**
 * Where each host keeps its documents. A download stays under the document
 * path of the host it started on.
 */
const DOCUMENT_PATHS: ReadonlyMap<string, string> = new Map([
  [EDIKTE_HOST, '/edikte/'],
  [JUSTIZONLINE_HOST, JUSTIZONLINE_API_PATH],
])

/**
 * Returns the parsed URL when the download of a document of this edict may
 * start there, and null otherwise. For a court auction (32 hex characters):
 * https on the default port, host exactly edikte.justiz.gv.at, no credentials,
 * path under /edikte/. For a sale in insolvency proceedings
 * (`mv-<record number>`): a file of that record on justizonline.gv.at, written
 * exactly as `insolvencyFileUrl` returns it. A URL of one site never passes
 * for an edict of the other.
 */
export function parseDownloadUrl(raw: string, edictId: string): URL | null {
  if (AUCTION_EDICT_ID_PATTERN.test(edictId)) return parseOnHost(raw, EDIKTE_HOST)
  const recordNumber = insolvencyRecordNumber(edictId)
  if (recordNumber === null) return null
  // `insolvencyFileUrl` decides which files belong to the record. The host rule
  // runs as well, so every URL this module returns has passed it.
  return insolvencyFileUrl(raw, recordNumber) === raw ? parseOnHost(raw, JUSTIZONLINE_HOST) : null
}

/**
 * Returns the parsed URL when a download may follow a redirect from `from` to
 * it: https on the default port, the host of `from`, no credentials, path under
 * that host's document path. `from` is a URL this module returned, so a
 * download stays on the host it started on and never crosses to the other one.
 */
export function parseRedirectUrl(raw: string, from: URL): URL | null {
  return parseOnHost(raw, from.hostname)
}

/**
 * The host rule: https on the default port, exactly this host, no credentials,
 * path under the host's document path. A host without a document path fails.
 */
function parseOnHost(raw: string, host: string): URL | null {
  const documentPath = DOCUMENT_PATHS.get(host)
  if (documentPath === undefined) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== host ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    !url.pathname.startsWith(documentPath)
  ) {
    return null
  }
  return url
}
