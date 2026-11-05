import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: { '@shared': resolve(import.meta.dirname, 'src/shared') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
    // The cache key ignores the files behind import.meta.glob, so a new
    // migration stayed invisible to src/main/db/migrate.ts until the cache was cleared.
    fsModuleCache: false,
  },
})
