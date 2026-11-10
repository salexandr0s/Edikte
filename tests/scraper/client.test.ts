import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EdikteClient, type EdikteClientOptions } from '../../src/main/scraper/client'

const PAGE =
  'https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/alldoc/0123456789abcdef0123456789abcdef!OpenDocument'

function page(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=UTF-8' },
  })
}

function status(code: number, headers: Record<string, string> = {}): Response {
  return new Response('', { status: code, headers })
}

const API = 'https://justizonline.gv.at/jop/service/edi/v1/edikte/990001'
/** A file of an API record, as a download address. */
const FILE = `${API}/resources/TVZfOTk5MDAwMQ`

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** A fetch that answers only when its request is aborted, like a server that never replies. */
function hangingFetch(_input: string | URL | Request, init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

function setup(options: Partial<EdikteClientOptions> = {}) {
  const fetchMock = vi.fn<typeof fetch>()
  // A jitter source of 0.5 makes the backoff exactly 2 s, 4 s, 8 s.
  const client = new EdikteClient({
    appVersion: '1.2.3',
    fetch: fetchMock,
    random: () => 0.5,
    ...options,
  })
  return { client, fetchMock }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('EdikteClient', () => {
  it('sends one request per second with its User-Agent and decodes UTF-8', async () => {
    const { client, fetchMock } = setup()
    fetchMock.mockImplementation(() => Promise.resolve(page('Schätzwert')))
    const first = client.getText(PAGE)
    const second = client.getText(PAGE)
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(first).resolves.toBe('Schätzwert')
    await expect(second).resolves.toBe('Schätzwert')
    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers)
    expect(headers.get('user-agent')).toBe('Edikte/1.2.3 (desktop app for personal use)')
    expect(client.requestCount).toBe(2)
  })

  it('backs off on 503 and succeeds on a later attempt', async () => {
    const { client, fetchMock } = setup()
    fetchMock
      .mockResolvedValueOnce(status(503))
      .mockResolvedValueOnce(status(503))
      .mockResolvedValueOnce(page('ok'))
    const result = client.getText(PAGE)
    await vi.advanceTimersByTimeAsync(1999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(4000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await expect(result).resolves.toBe('ok')
  })

  it('waits as long as Retry-After asks', async () => {
    const { client, fetchMock } = setup()
    fetchMock
      .mockResolvedValueOnce(status(429, { 'retry-after': '7' }))
      .mockResolvedValueOnce(page('ok'))
    const result = client.getText(PAGE)
    await vi.advanceTimersByTimeAsync(6999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(result).resolves.toBe('ok')
  })

  it('gives up after the last attempt', async () => {
    const { client, fetchMock } = setup({ maxAttempts: 3 })
    fetchMock.mockImplementation(() => Promise.resolve(status(403)))
    const assertion = expect(client.getText(PAGE)).rejects.toMatchObject({ code: 'rate_limited' })
    await vi.advanceTimersByTimeAsync(60_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not wait for a Retry-After beyond its limit', async () => {
    const { client, fetchMock } = setup()
    fetchMock.mockResolvedValueOnce(status(503, { 'retry-after': '3600' }))
    await expect(client.getText(PAGE)).rejects.toMatchObject({ code: 'site_unavailable' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('pauses after five failed requests and tries again after the cooldown', async () => {
    const { client, fetchMock } = setup({ maxAttempts: 1 })
    fetchMock.mockImplementation(() => Promise.resolve(status(500)))
    for (let request = 0; request < 5; request += 1) {
      const assertion = expect(client.getText(PAGE)).rejects.toMatchObject({
        code: 'site_unavailable',
      })
      await vi.advanceTimersByTimeAsync(1000)
      await assertion
    }
    await expect(client.getText(PAGE)).rejects.toMatchObject({ code: 'site_unavailable' })
    expect(fetchMock).toHaveBeenCalledTimes(5)
    fetchMock.mockImplementation(() => Promise.resolve(page('back')))
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    await expect(client.getText(PAGE)).resolves.toBe('back')
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('does not count a missing page as a failure and does not retry it', async () => {
    const { client, fetchMock } = setup()
    fetchMock.mockResolvedValueOnce(status(404))
    await expect(client.getText(PAGE)).rejects.toMatchObject({ code: 'not_found' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries network errors', async () => {
    const { client, fetchMock } = setup({ maxAttempts: 2 })
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    const assertion = expect(client.getText(PAGE)).rejects.toMatchObject({ code: 'network' })
    await vi.advanceTimersByTimeAsync(2000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('times out a request that does not answer', async () => {
    const { client, fetchMock } = setup({ maxAttempts: 1, timeoutMs: 30_000 })
    fetchMock.mockImplementation(hangingFetch)
    const assertion = expect(client.getText(PAGE)).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
  })

  it('refuses responses over the size limit and links to other hosts', async () => {
    const { client, fetchMock } = setup({ maxBytes: 10 })
    fetchMock.mockResolvedValueOnce(page('x'.repeat(20)))
    await expect(client.getText(PAGE)).rejects.toMatchObject({ code: 'site_changed' })
    await expect(client.getText('https://example.com/page')).rejects.toMatchObject({
      code: 'site_changed',
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('stops at once when cancelled before the request', async () => {
    const { client, fetchMock } = setup()
    const controller = new AbortController()
    controller.abort()
    await expect(client.getText(PAGE, controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('stops while waiting to retry', async () => {
    const { client, fetchMock } = setup()
    fetchMock.mockResolvedValueOnce(status(503))
    const controller = new AbortController()
    const assertion = expect(client.getText(PAGE, controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    })
    await vi.advanceTimersByTimeAsync(500)
    controller.abort()
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('pauses with the code of the failures that opened the breaker', async () => {
    const { client, fetchMock } = setup({ maxAttempts: 1 })
    fetchMock.mockRejectedValue(new TypeError('fetch failed'))
    for (let request = 0; request < 5; request += 1) {
      const assertion = expect(client.getText(PAGE)).rejects.toMatchObject({ code: 'network' })
      await vi.advanceTimersByTimeAsync(1000)
      await assertion
    }
    await expect(client.getText(PAGE)).rejects.toMatchObject({
      code: 'network',
      message: 'Requests paused after repeated failures',
    })
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })

  it('follows redirects only to https pages of the site', async () => {
    const { client, fetchMock } = setup()
    const moved =
      'https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/alldoc/fedcba9876543210fedcba9876543210!OpenDocument'
    fetchMock
      .mockResolvedValueOnce(status(302, { location: moved }))
      .mockResolvedValueOnce(page('moved'))
    const result = client.getText(PAGE)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(result).resolves.toBe('moved')
    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.redirect])).toEqual([
      [PAGE, 'manual'],
      [moved, 'manual'],
    ])
    for (const location of ['https://example.com/', 'http://edikte.justiz.gv.at/edikte/']) {
      fetchMock.mockResolvedValueOnce(status(301, { location }))
      const refused = expect(client.getText(PAGE)).rejects.toMatchObject({ code: 'site_changed' })
      await vi.advanceTimersByTimeAsync(1000)
      await refused
    }
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('holds back downloads after a 429 for as long as Retry-After asks', async () => {
    const { client, fetchMock } = setup()
    fetchMock
      .mockResolvedValueOnce(status(429, { 'retry-after': '5' }))
      .mockResolvedValueOnce(page('pdf'))
    const refused = await client.limitedFetch(PAGE)
    await refused.body?.cancel()
    const next = client.limitedFetch(PAGE)
    await vi.advanceTimersByTimeAsync(4999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(next.then((response) => response.text())).resolves.toBe('pdf')
  })

  it('times out a download that gets no answer once it leaves the queue', async () => {
    const { client, fetchMock } = setup({ timeoutMs: 30_000, downloadAttempts: 1 })
    fetchMock.mockImplementationOnce(hangingFetch).mockResolvedValueOnce(page('next'))
    const assertion = expect(client.limitedFetch(PAGE)).rejects.toMatchObject({ code: 'timeout' })
    await vi.advanceTimersByTimeAsync(30_000)
    await assertion
    // The queue moves on after the backoff.
    const next = client.limitedFetch(PAGE)
    await vi.advanceTimersByTimeAsync(10_000)
    await expect(next.then((response) => response.text())).resolves.toBe('next')
  })

  it('frees the queue when a download is cancelled as its answer arrives', async () => {
    const { client, fetchMock } = setup()
    const controller = new AbortController()
    fetchMock
      .mockImplementationOnce(() => {
        controller.abort()
        return Promise.resolve(page('pdf'))
      })
      .mockResolvedValueOnce(page('next'))
    await client.limitedFetch(PAGE, { signal: controller.signal })
    const next = client.limitedFetch(PAGE)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(next.then((response) => response.text())).resolves.toBe('next')
  })

  it('stops a request in flight', async () => {
    const { client, fetchMock } = setup()
    fetchMock.mockImplementation(hangingFetch)
    const controller = new AbortController()
    const assertion = expect(client.getText(PAGE, controller.signal)).rejects.toMatchObject({
      code: 'cancelled',
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    controller.abort()
    await assertion
  })

  it('reads JSON from the API with its own Accept header and the same User-Agent', async () => {
    const { client, fetchMock } = setup()
    fetchMock.mockResolvedValueOnce(json({ total: 1, edikte: [{ id: 990001 }] }))
    await expect(client.getJson(API)).resolves.toEqual({ total: 1, edikte: [{ id: 990001 }] })
    const call = fetchMock.mock.calls[0]
    expect(call?.[0]).toBe(API)
    const headers = new Headers(call?.[1]?.headers)
    expect(headers.get('accept')).toBe('application/json')
    expect(headers.get('user-agent')).toBe('Edikte/1.2.3 (desktop app for personal use)')
    expect(client.requestCount).toBe(1)
  })

  it('keeps one pace across both hosts', async () => {
    const { client, fetchMock } = setup()
    fetchMock.mockResolvedValueOnce(page('Seite')).mockResolvedValueOnce(json({ total: 0 }))
    const first = client.getText(PAGE)
    const second = client.getJson(API)
    await vi.advanceTimersByTimeAsync(999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(first).resolves.toBe('Seite')
    await expect(second).resolves.toEqual({ total: 0 })
  })

  it('refuses addresses outside the JustizOnline API without sending a request', async () => {
    const { client, fetchMock } = setup()
    for (const url of [
      'https://example.com/jop/service/edi/v1/edikte/990001',
      'https://justizonline.gv.at/jop/web/ediktsdatei/suche/990001',
      'https://justizonline.gv.at/jop/service/edi/v1/../../web/ediktsdatei/suche',
      'http://justizonline.gv.at/jop/service/edi/v1/edikte/990001',
      'https://justizonline.gv.at:8443/jop/service/edi/v1/edikte/990001',
      'https://someone@justizonline.gv.at/jop/service/edi/v1/edikte/990001',
    ]) {
      await expect(client.getJson(url)).rejects.toMatchObject({ code: 'site_changed' })
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refuses an API answer that is not JSON', async () => {
    const { client, fetchMock } = setup()
    fetchMock
      // The text would parse; only its content type says it is a page.
      .mockResolvedValueOnce(page('{"total":0}'))
      .mockResolvedValueOnce(
        new Response('{"edikte":', { headers: { 'content-type': 'application/json' } }),
      )
    await expect(client.getJson(API)).rejects.toMatchObject({ code: 'site_changed' })
    const invalid = expect(client.getJson(API)).rejects.toMatchObject({ code: 'site_changed' })
    await vi.advanceTimersByTimeAsync(1000)
    await invalid
    // Neither answer is asked for again.
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('refuses API redirects to another host or away from the API path', async () => {
    const { client, fetchMock } = setup()
    for (const location of [
      'https://example.com/jop/service/edi/v1/edikte/990001',
      'https://justizonline.gv.at/jop/web/ediktsdatei/suche',
    ]) {
      fetchMock.mockResolvedValueOnce(status(302, { location }))
      const refused = expect(client.getJson(API)).rejects.toMatchObject({ code: 'site_changed' })
      await vi.advanceTimersByTimeAsync(1000)
      await refused
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('pauses only the host that keeps failing', async () => {
    const { client, fetchMock } = setup({ maxAttempts: 1 })
    fetchMock.mockImplementation((input) =>
      Promise.resolve(input === PAGE ? status(500) : json({ total: 0 })),
    )
    for (let request = 0; request < 5; request += 1) {
      const assertion = expect(client.getText(PAGE)).rejects.toMatchObject({
        code: 'site_unavailable',
      })
      await vi.advanceTimersByTimeAsync(1000)
      await assertion
    }
    const paused = { code: 'site_unavailable', message: 'Requests paused after repeated failures' }
    await expect(client.getText(PAGE)).rejects.toMatchObject(paused)
    // A download counts against the host of its address.
    await expect(client.limitedFetch(PAGE)).rejects.toMatchObject(paused)
    const other = client.getJson(API)
    await vi.advanceTimersByTimeAsync(1000)
    await expect(other).resolves.toEqual({ total: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(6)
  })

  it('gives the API a shorter timeout and retries a request that gets no answer', async () => {
    const { client, fetchMock } = setup()
    fetchMock.mockImplementationOnce(hangingFetch).mockResolvedValueOnce(json({ total: 0 }))
    const result = client.getJson(API)
    // The 10 s timeout, then all but the last millisecond of the 2 s backoff.
    await vi.advanceTimersByTimeAsync(10_000 + 1_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(result).resolves.toEqual({ total: 0 })
  })

  it('tries a download again when the first try gets no answer', async () => {
    const { client, fetchMock } = setup()
    fetchMock.mockImplementationOnce(hangingFetch).mockResolvedValueOnce(page('pdf'))
    const download = client.limitedFetch(FILE)
    // The header timeout of the file's host, then the 2 s backoff.
    await vi.advanceTimersByTimeAsync(10_000 + 1_999)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await expect(download.then((response) => response.text())).resolves.toBe('pdf')
  })

  it('gives up on a download that never answers after three tries', async () => {
    const { client, fetchMock } = setup()
    fetchMock.mockImplementation(hangingFetch)
    const assertion = expect(client.limitedFetch(FILE)).rejects.toMatchObject({ code: 'timeout' })
    // Three timeouts of 10 s with backoffs of 2 s and 4 s between them.
    await vi.advanceTimersByTimeAsync(10_000 + 2_000 + 10_000 + 4_000 + 10_000)
    await assertion
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
