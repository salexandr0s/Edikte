import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Reads a sanitised page from tests/scraper/fixtures. */
export function readFixture(name: string): string {
  return readFileSync(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url)), 'utf8')
}

/** The error a function throws, for matching its AppError code. */
export function errorOf(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}
