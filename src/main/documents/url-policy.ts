import { EDIKTE_HOST } from '@shared/edikte-codes'

// Download URL guard ported from immoradar's outbound-url-policy.ts and narrowed
// to one host. Its private-address checks are left out: they cannot apply to a
// fixed public host.

const DOCUMENT_PATH_PREFIX = '/edikte/'

/**
 * Returns the parsed URL when a document may be downloaded from it: https on
 * the default port, host exactly edikte.justiz.gv.at, no credentials, path
 * under /edikte/. Applies to the first URL and to every redirect target.
 */
export function parseDownloadUrl(raw: string): URL | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== EDIKTE_HOST ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== '' ||
    !url.pathname.startsWith(DOCUMENT_PATH_PREFIX)
  ) {
    return null
  }
  return url
}
