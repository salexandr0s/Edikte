import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseDetailPage } from '../../src/main/scraper/detail'

// Saved edict pages name the owners, so they stay outside the repository. Set
// EDIKTE_HTML_CORPUS to a folder of saved pages (.html or .html.gz) to run this.
const corpusDir = process.env.EDIKTE_HTML_CORPUS ?? ''
const files =
  corpusDir !== '' && existsSync(corpusDir)
    ? readdirSync(corpusDir, { recursive: true, encoding: 'utf8' }).filter((name) =>
        /\.html(?:\.gz)?$/.test(name),
      )
    : []

describe.skipIf(files.length === 0)('edict parser on a local corpus', () => {
  it('reads every saved edict page', () => {
    const failures: string[] = []
    let auctions = 0
    let missingCaseNumber = 0
    let missingSchaetzwert = 0
    for (const name of files) {
      const raw = readFileSync(join(corpusDir, name))
      const html = name.endsWith('.gz') ? gunzipSync(raw).toString('utf8') : raw.toString('utf8')
      if (!html.includes('id="druckbereich"')) continue
      try {
        const detail = parseDetailPage(html)
        if (detail.noticeType !== 'versteigerung') continue
        auctions += 1
        if (detail.fields.caseNumber === null) missingCaseNumber += 1
        if (detail.fields.schaetzwertEur === null) missingSchaetzwert += 1
      } catch (error) {
        failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    expect(failures.slice(0, 10), `${failures.length} pages failed`).toEqual([])
    expect(auctions).toBeGreaterThan(0)
    expect(missingCaseNumber).toBe(0)
    expect(missingSchaetzwert / auctions).toBeLessThan(0.02)
  }, 300_000)
})
