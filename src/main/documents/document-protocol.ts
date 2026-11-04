import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { EDICT_ID_PATTERN } from './file-names'

// Paths behind the custom scheme of the PDF window. Electron-free, so the
// containment rules can be tested in Node.

export const DOCUMENT_SCHEME = 'edikte-doc'
const DOCUMENT_HOST = 'files'

/** Address of a downloaded file for the PDF window, opened at a page when given. */
export function documentUrl(localPath: string, page?: number): string {
  const segments = splitLocalPath(localPath)
  if (segments === null) throw new Error('Invalid document path')
  const url = `${DOCUMENT_SCHEME}://${DOCUMENT_HOST}/${segments.map(encodeURIComponent).join('/')}`
  return page !== undefined && Number.isInteger(page) && page > 0 ? `${url}#page=${page}` : url
}

/**
 * The documents.localPath a request URL points to (`<edictId>/<file>.pdf`),
 * or null for any other shape, including encoded separators and dot segments.
 */
export function localPathFromUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (
    url.protocol !== `${DOCUMENT_SCHEME}:` ||
    url.hostname !== DOCUMENT_HOST ||
    url.port !== '' ||
    url.username !== '' ||
    url.password !== ''
  ) {
    return null
  }
  const segments: string[] = []
  for (const part of url.pathname.split('/').slice(1)) {
    try {
      segments.push(decodeURIComponent(part))
    } catch {
      return null
    }
  }
  return splitLocalPath(segments.join('/')) === null ? null : segments.join('/')
}

/**
 * The real path of a document inside the documents folder, or null when it is
 * missing, not a regular file, or resolves outside the folder (symlinks included).
 */
export async function resolveDocumentFile(
  documentsDir: string,
  localPath: string,
): Promise<string | null> {
  const segments = splitLocalPath(localPath)
  if (segments === null) return null
  try {
    const root = await realpath(documentsDir)
    const file = await realpath(path.join(root, ...segments))
    if (!isInside(root, file)) return null
    return (await stat(file)).isFile() ? file : null
  } catch {
    return null
  }
}

/** True when `candidate` lies strictly inside `root`; both must be resolved paths. */
export function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative !== '' &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

/** `<edictId>/<name>.pdf` split into its two segments, or null. */
export function splitLocalPath(localPath: string): [string, string] | null {
  const segments = localPath.split('/')
  if (segments.length !== 2) return null
  const [edictId, name] = segments
  if (edictId === undefined || name === undefined || !EDICT_ID_PATTERN.test(edictId)) return null
  if (!isPlainSegment(name) || !name.toLowerCase().endsWith('.pdf')) return null
  return [edictId, name]
}

function isPlainSegment(segment: string): boolean {
  if (segment === '' || segment.startsWith('.') || /[/\\:]/.test(segment)) return false
  for (const char of segment) {
    const code = char.codePointAt(0) ?? 0
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false
  }
  return true
}
