import { readFileSync } from 'node:fs'
import { AppError } from '@shared/errors'
import type { JsonSource, PageSource } from '../../../src/main/scraper/client'

// The Edikte site as the client returns it, in the markup the scraper reads
// (see tests/scraper/sync.test.ts). Courts, streets and cases are made up.

export interface SitePage {
  id: string
  title: string
}

export function idOf(n: number): string {
  return n.toString(16).padStart(32, '0')
}

export function sitePage(n: number, title = `Wohnung Top ${n}`): SitePage {
  return { id: idOf(n), title }
}

function labelRow(label: string, value: string): string {
  return `<div class="row"><span>${label}:</span><p>${value}</p></div>`
}

function listHtml(pages: readonly SitePage[]): string {
  const rows = pages
    .map(
      (page) =>
        `<tr><td></td><td><a href="alldoc/${page.id}!OpenDocument">Versteigerung (01.12.2026)</a></td>` +
        `<td>1030 Wien Musterstraße 1<br>Eigentumswohnung</td><td>${page.title}</td></tr>`,
    )
    .join('')
  return `<input name="Hits" value="${pages.length}"><input name="TotalHits" value="${pages.length}"><table><tbody>${rows}</tbody></table>`
}

function detailHtml(page: SitePage): string {
  return [
    `<div id="druckbereich"><h1><small>Versteigerung - ${page.title}</small></h1>`,
    labelRow('Dienststelle', 'BG Musterstadt (099)'),
    labelRow('Aktenzeichen', `1 E ${page.id.slice(-4)}/26a`),
    labelRow('Versteigerungstermin', 'am 01.12.2026 um 10:00 Uhr'),
    labelRow('PLZ/Ort', '1030 Wien'),
    labelRow('Kategorie(n)', 'Eigentumswohnung'),
    labelRow('Schätzwert', '200.000,00 EUR'),
    labelRow(
      'Langgutachten',
      `<a href="/edikte/ex/exedi3.nsf/0/${page.id}/$file/gutachten.pdf">Langgutachten (pdf) (100 KB)</a>`,
    ),
    '</div>',
  ].join('')
}

function cancelledError(): AppError {
  return new AppError('cancelled', 'Cancelled')
}

export class FakeSite implements PageSource, JsonSource {
  requestCount = 0
  pages: SitePage[] = []
  /** Requests whose URL matches wait until `release()` or until their run is cancelled. */
  hold: ((url: string) => boolean) | null = null
  /** Every request fails with this error, such as `network` for a site out of reach. */
  failWith: AppError | null = null
  sales: number[] = []
  jsonFailWith: AppError | null = null
  readonly #waiting: Array<() => void> = []

  get waiting(): number {
    return this.#waiting.length
  }

  async getText(url: string, signal?: AbortSignal): Promise<string> {
    this.requestCount += 1
    if (signal?.aborted === true) throw cancelledError()
    if (this.failWith !== null) throw this.failWith
    if (this.hold?.(url) === true) await this.#waitForRelease(signal)
    return this.#answer(url)
  }

  async getJson(url: string, signal?: AbortSignal): Promise<unknown> {
    this.requestCount += 1
    if (signal?.aborted === true) throw cancelledError()
    if (this.jsonFailWith !== null) throw this.jsonFailWith
    if (this.hold?.(url) === true) await this.#waitForRelease(signal)
    const parsed = new URL(url)
    if (parsed.search !== '') {
      return {
        page: Number(parsed.searchParams.get('page')),
        pageSize: 100,
        total: this.sales.length,
        incompleteResult: false,
        edikte: this.sales.map((id) => ({
          id,
          publishedAt: '2026-11-02',
          publisherInfo: 'HG Musterstadt',
          aktenzeichen: '099 4 S 12/26 x',
        })),
      }
    }
    if (!parsed.pathname.endsWith('/990001')) throw new AppError('not_found', 'HTTP 404')
    const fixture = readFileSync(
      new URL('../../scraper/insolvency/fixtures/detail-rich.json', import.meta.url),
      'utf8',
    )
    const json: unknown = JSON.parse(fixture.replaceAll('Niederösterreich', 'Wien'))
    return json
  }

  release(): void {
    this.hold = null
    for (const resume of this.#waiting.splice(0)) resume()
  }

  #waitForRelease(signal: AbortSignal | undefined): Promise<void> {
    return new Promise((resolve, reject) => {
      const resume = (): void => {
        signal?.removeEventListener('abort', cancel)
        resolve()
      }
      const cancel = (): void => {
        this.#waiting.splice(this.#waiting.indexOf(resume), 1)
        reject(cancelledError())
      }
      signal?.addEventListener('abort', cancel, { once: true })
      this.#waiting.push(resume)
    })
  }

  #answer(url: string): string {
    if (url.includes('/suchedi?')) return listHtml(this.pages)
    const id = /alldoc\/([0-9a-f]{32})!OpenDocument$/.exec(url)?.[1]
    const page = this.pages.find((candidate) => candidate.id === id)
    if (page === undefined) throw new AppError('not_found', 'HTTP 404 from the site')
    return detailHtml(page)
  }
}
