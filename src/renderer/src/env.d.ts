import type { EdikteBridge } from '@shared/ipc'

declare global {
  interface Window {
    /** Set by the preload script; missing when the renderer runs in a plain browser. */
    edikte?: EdikteBridge
  }
}
