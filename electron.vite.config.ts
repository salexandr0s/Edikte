import { resolve } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'electron-vite'
import type { Plugin } from 'vite'

const root = import.meta.dirname
const sharedAlias = { '@shared': resolve(root, 'src/shared') }

// The policy is injected at build time only: the dev server needs an inline
// React refresh preamble that a strict script-src would block. frame-ancestors
// is left out because Chromium ignores it in a <meta> policy and logs an error.
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // Radix injects <style> elements for scroll locking.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

// pdf.js runs its parser in a blob: worker inside the hidden raster window.
const RASTER_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self' blob:",
  "img-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ')

function contentSecurityPolicy(): Plugin {
  return {
    name: 'edikte:content-security-policy',
    apply: 'build',
    transformIndexHtml(_html, context) {
      const policy = context.filename.endsWith('pdf-raster.html') ? RASTER_CSP : APP_CSP
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
          injectTo: 'head-prepend',
        },
      ]
    },
  }
}

export default defineConfig({
  main: {
    resolve: { alias: sharedAlias },
    build: { externalizeDeps: true },
  },
  preload: {
    resolve: { alias: sharedAlias },
    build: {
      // Sandboxed preloads can only require electron, so everything else is bundled.
      externalizeDeps: false,
      rolldownOptions: {
        input: {
          index: resolve(root, 'src/preload/index.ts'),
          'pdf-raster': resolve(root, 'src/preload/pdf-raster.ts'),
        },
        // Sandboxed preloads must be CommonJS; the package itself is ESM.
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    resolve: {
      alias: { ...sharedAlias, '@renderer': resolve(root, 'src/renderer/src') },
    },
    plugins: [react(), tailwindcss(), contentSecurityPolicy()],
    build: {
      rolldownOptions: {
        input: {
          index: resolve(root, 'src/renderer/index.html'),
          'pdf-raster': resolve(root, 'src/renderer/pdf-raster.html'),
        },
      },
    },
  },
})
