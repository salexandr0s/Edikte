import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { z } from 'zod'
import { ZodError } from 'zod'
import { isAppError, type AppErrorShape } from '@shared/errors'
import {
  ipcContract,
  type IpcHandlerRequest,
  type IpcHandlerResponse,
  type IpcResult,
} from '@shared/ipc'
import type { InvokeChannel } from '@shared/ipc-channels'
import { log } from '../log'

export type IpcHandler<C extends InvokeChannel> = (
  request: IpcHandlerRequest<C>,
  event: IpcMainInvokeEvent,
) => IpcHandlerResponse<C> | Promise<IpcHandlerResponse<C>>

export interface IpcRouter {
  handle<C extends InvokeChannel>(channel: C, handler: IpcHandler<C>): void
  has(channel: InvokeChannel): boolean
}

/**
 * Registers handlers that check the sender, validate the request, and validate
 * the response before it leaves main. Errors become `{ ok: false, error }`.
 */
export function createIpcRouter(
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean,
): IpcRouter {
  const registered = new Set<InvokeChannel>()
  return {
    handle(channel, handler) {
      if (registered.has(channel)) throw new Error(`IPC channel ${channel} is already handled`)
      const schemas: { request: z.ZodType; response: z.ZodType } = ipcContract[channel]
      ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<unknown>> => {
        if (!isTrustedSender(event)) {
          log.warn('ipc', `Rejected ${channel} from an untrusted sender`)
          return { ok: false, error: { code: 'forbidden', message: 'Untrusted sender' } }
        }
        let stage: 'request' | 'handler' | 'response' = 'request'
        try {
          const request = schemas.request.parse(raw) as IpcHandlerRequest<typeof channel>
          stage = 'handler'
          const response = await handler(request, event)
          stage = 'response'
          return { ok: true, data: schemas.response.parse(response) }
        } catch (error) {
          return { ok: false, error: toErrorShape(channel, stage, error) }
        }
      })
      registered.add(channel)
    },
    has(channel) {
      return registered.has(channel)
    },
  }
}

function toErrorShape(
  channel: InvokeChannel,
  stage: 'request' | 'handler' | 'response',
  error: unknown,
): AppErrorShape {
  if (isAppError(error)) return error.toShape()
  if (error instanceof ZodError && stage === 'request') {
    return { code: 'invalid_request', message: error.issues[0]?.message ?? 'Invalid request' }
  }
  log.error('ipc', `${channel} failed at ${stage}`, error)
  const message = error instanceof Error ? error.message : 'Unexpected error'
  return { code: 'internal', message: message.slice(0, 300) }
}
