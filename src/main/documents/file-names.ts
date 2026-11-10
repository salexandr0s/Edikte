import path from 'node:path'

const MAX_NAME_BYTES = 150
const FALLBACK_NAME = 'document'
const FORBIDDEN_CHARACTERS = /[<>:"/\\|?*]/g
// Bidirectional controls can make a name read differently from what it is.
const BIDI_CONTROLS = /[‎‏‪-‮⁦-⁩]/g
const WINDOWS_DEVICE_NAMES = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])$/i

/**
 * Turns a published file name into a single safe path segment for macOS and
 * Windows: percent-decoded, last path segment only, no control or reserved
 * characters, no leading or trailing dots, no device names, at most 150 bytes
 * in UTF-8, ending in ".pdf" (downloads are checked to be PDFs).
 */
export function safePdfFileName(raw: string): string {
  let name = raw
  try {
    name = decodeURIComponent(raw)
  } catch {
    // Not valid percent-encoding: use the text as it is.
  }
  name = (name.split(/[/\\]/).pop() ?? '').normalize('NFC')
  name = withoutControlCharacters(name)
    .replace(BIDI_CONTROLS, '')
    .replace(FORBIDDEN_CHARACTERS, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')

  let base = path.extname(name).toLowerCase() === '.pdf' ? name.slice(0, -4) : name
  if (WINDOWS_DEVICE_NAMES.test(base.split('.')[0] ?? '')) base = `_${base}`
  base = truncateUtf8(base, MAX_NAME_BYTES - 4).replace(/[.\s]+$/, '')
  return `${base === '' ? FALLBACK_NAME : base}.pdf`
}

function withoutControlCharacters(text: string): string {
  let result = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (code >= 0x20 && (code < 0x7f || code > 0x9f)) result += char
  }
  return result
}

function truncateUtf8(text: string, maxBytes: number): string {
  let result = ''
  let bytes = 0
  for (const char of text) {
    bytes += Buffer.byteLength(char)
    if (bytes > maxBytes) break
    result += char
  }
  return result
}
