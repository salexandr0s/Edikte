import http from 'node:http'
import { describe, expect, it } from 'vitest'
import { startLoopbackListener } from '../../../src/main/ai/chatgpt/loopback-listener'

interface Reply {
  status: number
  headers: http.IncomingHttpHeaders
  body: string
}

function get(port: number, target: string, host = `127.0.0.1:${port}`): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const request = http.request(
      { host: '127.0.0.1', port, path: target, method: 'GET', headers: { host } },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      },
    )
    request.on('error', reject)
    request.end()
  })
}

function settledWithin(promise: Promise<unknown>, ms: number): Promise<boolean> {
  return Promise.race([
    promise.then(
      () => true,
      () => true,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms)),
  ])
}

describe('loopback listener', () => {
  it('rejects a callback with another state, keeps waiting, then accepts the right one', async () => {
    const listener = await startLoopbackListener({ state: 'expected-state' })
    const port = Number(new URL(listener.redirectUri).port)

    const wrong = await get(port, '/auth/callback?code=abc&state=other-state')
    expect(wrong.status).toBe(400)
    expect(wrong.body).toContain('Link nicht erkannt')
    expect(wrong.headers['content-security-policy']).toContain("default-src 'none'")
    expect(wrong.headers['cache-control']).toBe('no-store')
    expect(await settledWithin(listener.callback, 30)).toBe(false)

    const right = await get(port, '/auth/callback?code=abc&state=expected-state')
    expect(right.status).toBe(200)
    expect(right.body).toContain('Sign-in received')
    const url = await listener.callback
    expect(url.searchParams.get('code')).toBe('abc')
  })

  it('ignores a request with the wrong Host header', async () => {
    const listener = await startLoopbackListener({ state: 'expected-state' })
    const port = Number(new URL(listener.redirectUri).port)

    const reply = await get(
      port,
      '/auth/callback?code=abc&state=expected-state',
      `localhost:${port}`,
    )
    expect(reply.status).toBe(400)
    expect(await settledWithin(listener.callback, 30)).toBe(false)
    listener.close()
    await expect(listener.callback).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('gives up after the time limit and stops listening', async () => {
    const listener = await startLoopbackListener({ state: 'expected-state', timeoutMs: 20 })
    const port = Number(new URL(listener.redirectUri).port)

    await expect(listener.callback).rejects.toMatchObject({ code: 'timeout' })
    await expect(get(port, '/auth/callback?state=expected-state')).rejects.toThrow()
  })

  it('stops when the sign-in is cancelled', async () => {
    const controller = new AbortController()
    const listener = await startLoopbackListener({
      state: 'expected-state',
      signal: controller.signal,
    })
    controller.abort()
    await expect(listener.callback).rejects.toMatchObject({ code: 'cancelled' })
  })
})
