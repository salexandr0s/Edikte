import { z } from 'zod'

/**
 * Error codes that cross the IPC boundary. The renderer shows a translated
 * text per code (`errors.<code>`) and the message as technical detail, so
 * messages must never contain tokens, keys or document text.
 */
export const AppErrorCodeSchema = z.enum([
  'invalid_request',
  'forbidden',
  'not_found',
  'not_implemented',
  'busy',
  'cancelled',
  'timeout',
  'network',
  'site_unavailable',
  'site_changed',
  'rate_limited',
  'document_too_large',
  'document_unreadable',
  'storage_unavailable',
  'database_newer',
  'consent_required',
  'provider_not_selected',
  'provider_not_connected',
  'provider_auth',
  'provider_billing',
  'provider_rate_limit',
  'provider_refused',
  'provider_incomplete',
  'provider_invalid_output',
  'provider_unavailable',
  'provider_account_changed',
  'cli_not_found',
  'cli_update_required',
  'cli_failed',
  'internal',
])

export type AppErrorCode = z.infer<typeof AppErrorCodeSchema>

export const AppErrorShapeSchema = z.object({
  code: AppErrorCodeSchema,
  message: z.string(),
})

export type AppErrorShape = z.infer<typeof AppErrorShapeSchema>

export class AppError extends Error {
  override readonly name = 'AppError'

  constructor(
    readonly code: AppErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }

  toShape(): AppErrorShape {
    return { code: this.code, message: this.message }
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError
}
