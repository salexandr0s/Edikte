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
})
