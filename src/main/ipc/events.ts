import type { BrowserWindow } from 'electron'
import { eventContract, type EventPayload } from '@shared/ipc'
import type { EventChannel } from '@shared/ipc-channels'
import { log } from '../log'

/** Sends a main → renderer event. Services take this as a dependency. */
export type EmitEvent = <E extends EventChannel>(event: E, payload: EventPayload<E>) => void

/**
 * Validates each payload against the event contract and sends it to the main
 * window. Events are dropped while no window is open; the renderer reloads its
 * data when a window opens.
 */
export function createEventEmitter(getWindow: () => BrowserWindow | null): EmitEvent {
  return (event, payload) => {
    const window = getWindow()
    if (window === null || window.isDestroyed()) return
    const parsed = eventContract[event].safeParse(payload)
    if (!parsed.success) {
      log.error('ipc', `Dropped an invalid ${event} event`, parsed.error)
      return
    }
    window.webContents.send(event, parsed.data)
  }
}
