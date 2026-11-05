import type { AppErrorCode } from '@shared/errors'
import type { EdikteBridge, EventPayload, IpcRequestArgs, IpcResponse } from '@shared/ipc'
import type { EventChannel, InvokeChannel } from '@shared/ipc-channels'
import { createMockBridge } from '../dev/mock-bridge'

/** An error answer from main, with a code the UI translates (`errors.<code>`). */
export class BridgeError extends Error {
  override readonly name = 'BridgeError'

  constructor(
    readonly code: AppErrorCode,
    message: string,
  ) {
    super(message)
  }
}

// In a plain browser (`npm run dev:renderer`) the mock answers instead of main.
// Production builds drop the mock: import.meta.env.DEV is false there.
const bridge: EdikteBridge =
  window.edikte ?? (import.meta.env.DEV ? createMockBridge() : missingBridge())

/** True when the UI shows made-up data from the mock bridge. */
export const usingMockBridge = import.meta.env.DEV && window.edikte === undefined

/** Calls main and returns the data, or throws a BridgeError. */
export async function invoke<C extends InvokeChannel>(
  channel: C,
  ...request: IpcRequestArgs<C>
): Promise<IpcResponse<C>> {
  const result = await bridge.invoke(channel, ...request)
  if (result.ok) return result.data
  throw new BridgeError(result.error.code, result.error.message)
}

/** Listens to an event from main and returns the function that stops listening. */
export function subscribe<E extends EventChannel>(
  event: E,
  listener: (payload: EventPayload<E>) => void,
): () => void {
  return bridge.on(event, listener)
}

export function errorCode(error: unknown): AppErrorCode {
  return error instanceof BridgeError ? error.code : 'internal'
}

function missingBridge(): EdikteBridge {
  const error = { code: 'internal', message: 'The preload bridge is missing' } as const
  return {
    invoke: () => Promise.resolve({ ok: false, error }),
    on: () => () => undefined,
  }
}
