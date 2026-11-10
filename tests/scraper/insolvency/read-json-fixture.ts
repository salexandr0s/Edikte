import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** Reads a hand-written API answer from tests/scraper/insolvency/fixtures. Every value in it is made up. */
export function readJsonFixture(name: string): unknown {
  const text = readFileSync(fileURLToPath(new URL(`fixtures/${name}`, import.meta.url)), 'utf8')
  const parsed: unknown = JSON.parse(text)
  return parsed
}
