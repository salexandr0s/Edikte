import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { EVENT_CHANNELS, INVOKE_CHANNELS } from '@shared/ipc-channels'

// Typed on the renderer side as EdikteBridge (src/shared/ipc.ts). This script
// only passes calls through allowlisted channels; main validates everything.

const invokeChannels = new Set<string>(INVOKE_CHANNELS)
const eventChannels = new Set<string>(EVENT_CHANNELS)

const bridge = {
  invoke(channel: string, request?: unknown): Promise<unknown> {
    if (!invokeChannels.has(channel)) {
      return Promise.reject(new Error(`Unknown IPC channel: ${channel}`))
    }
    return ipcRenderer.invoke(channel, request)
  },
  on(event: string, listener: (payload: unknown) => void): () => void {
    if (!eventChannels.has(event)) throw new Error(`Unknown event channel: ${event}`)
    const forward = (_event: IpcRendererEvent, payload: unknown) => listener(payload)
    ipcRenderer.on(event, forward)
    return () => {
      ipcRenderer.removeListener(event, forward)
    }
  },
}

contextBridge.exposeInMainWorld('edikte', bridge)
