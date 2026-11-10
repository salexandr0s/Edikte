import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import { renderer } from './electron.vite.config'

// `npm run dev:renderer`: the renderer alone in a browser, where the mock bridge
// answers instead of main. electron-vite's --rendererOnly would still start
// Electron, and with it the app on the real data folder.
export default defineConfig({
  ...renderer,
  root: resolve(import.meta.dirname, 'src/renderer'),
  // Keep the browser's optimized dependencies separate from Electron and test servers.
  cacheDir: resolve(import.meta.dirname, 'node_modules/.vite-renderer'),
})
