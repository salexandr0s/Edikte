/**
 * Readers for the plain-text output of the CLIs: version lines, the option
 * lists in `--help` (checked before the app relies on a flag) and error text
 * that may be shown as technical detail.
 */

const VERSION_TOKEN = /^v?(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)$/
const ESC = String.fromCharCode(27)

/** "2.1.226 (Claude Code)" gives 2.1.226, "codex-cli 0.154.0" gives 0.154.0. */
export function parseCliVersion(output: string): string | null {
  for (const token of output.trim().split(/\s+/).slice(0, 8)) {
    const version = VERSION_TOKEN.exec(token)?.[1]
    if (version && version.length <= 64) return version
  }
  return null
}

/**
 * Flags defined in the option column of a commander (claude) or clap (codex)
 * help text. Description lines are skipped, so a flag that is only mentioned
 * in another flag's description does not count as present.
 */
export function parseHelpFlags(help: string): Set<string> {
  const flags = new Set<string>()
  for (const line of help.split(/\r?\n/)) {
    const definition = /^ {1,8}(-[^ ].*?)(?: {2,}|$)/.exec(line)?.[1]
    if (!definition) continue
    for (const match of definition.matchAll(/(?<![\w-])(--?[A-Za-z0-9][A-Za-z0-9-]*)/g)) {
      if (match[1]) flags.add(match[1])
    }
  }
  return flags
}

export function findMissingFlags(help: string, required: readonly string[]): string[] {
  const flags = parseHelpFlags(help)
  return required.filter((flag) => !flags.has(flag))
}

/** CLI text reduced to one bounded line without escape or control characters. */
export function safeDetail(text: string, maxLength = 300): string {
  const withoutEscapes = text
    .split(ESC)
    .map((part, index) => (index === 0 ? part : part.replace(/^\[[0-9;?]*[A-Za-z]/, '')))
    .join('')
  let printable = ''
  for (const char of withoutEscapes) {
    const code = char.codePointAt(0) ?? 0
    printable += code < 0x20 || code === 0x7f ? ' ' : char
  }
  const clean = printable.replace(/\s+/g, ' ').trim()
  return clean.length > maxLength ? `${clean.slice(0, maxLength - 1)}…` : clean
}

/** Last non-empty line, usually the error a CLI printed just before it exited. */
export function lastLine(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  return lines.at(-1) ?? null
}

export function describeExit(exitCode: number | null): string {
  return exitCode === null ? 'was stopped by a signal' : `exited with code ${exitCode}`
}

/**
 * The last line a failed sign-in printed, for the status detail. Links and
 * long tokens are cut out: the output may carry the sign-in URL with its
 * state, a device code or a file path with the user name.
 */
export function signInFailureReason(stdout: string, stderr: string): string | null {
  const line = lastLine(stderr) ?? lastLine(stdout)
  if (!line) return null
  const reason = safeDetail(
    line.replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[link]').replace(/[\w~+/=.-]{24,}/g, '[…]'),
    160,
  )
  return reason === '' ? null : reason
}
