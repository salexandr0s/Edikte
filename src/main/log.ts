/**
 * Minimal scoped logger. Never pass tokens, API keys, prompts or document
 * text: log codes, counts, IDs and durations instead.
 */
type Level = 'info' | 'warn' | 'error'

function write(level: Level, scope: string, message: string, details?: unknown): void {
  const line = `[${new Date().toISOString()}] ${level.toUpperCase()} ${scope}: ${message}`
  const sink = level === 'error' ? console.error : level === 'warn' ? console.warn : console.info
  if (details === undefined) sink(line)
  else sink(line, details)
}

export const log = {
  info: (scope: string, message: string, details?: unknown) =>
    write('info', scope, message, details),
  warn: (scope: string, message: string, details?: unknown) =>
    write('warn', scope, message, details),
  error: (scope: string, message: string, details?: unknown) =>
    write('error', scope, message, details),
}
