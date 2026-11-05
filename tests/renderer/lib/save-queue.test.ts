import { describe, expect, it, vi } from 'vitest'
import { createSaveQueue } from '../../../src/renderer/src/lib/save-queue'

/** A send whose answers the test releases one at a time. */
function controlledSend() {
  const calls: Array<{ value: string; resolve: () => void; reject: () => void }> = []
  const send = (value: string) =>
    new Promise<string>((resolve, reject) => {
      calls.push({
        value,
        resolve: () => resolve(value),
        reject: () => reject(new Error('offline')),
      })
    })
  return { calls, send }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createSaveQueue', () => {
  it('sends the latest value after the save in flight and skips the ones between', async () => {
    const { calls, send } = controlledSend()
    const onSaved = vi.fn()
    const push = createSaveQueue({ send, onSaved, onFailed: vi.fn() })
    push('a')
    push('ab')
    push('abc')
    expect(calls.map((call) => call.value)).toEqual(['a'])

    calls[0]?.resolve()
    await settle()
    expect(calls.map((call) => call.value)).toEqual(['a', 'abc'])
    expect(onSaved).not.toHaveBeenCalled()

    calls[1]?.resolve()
    await settle()
    expect(onSaved).toHaveBeenCalledExactlyOnceWith('abc')
  })

  it('reports a failure only when no newer value follows it', async () => {
    const { calls, send } = controlledSend()
    const onFailed = vi.fn()
    const push = createSaveQueue({ send, onSaved: vi.fn(), onFailed })
    push('a')
    push('ab')
    calls[0]?.reject()
    await settle()
    expect(onFailed).not.toHaveBeenCalled()

    calls[1]?.reject()
    await settle()
    expect(onFailed).toHaveBeenCalledOnce()
    // Once idle, the next value goes out at once.
    push('ab')
    expect(calls).toHaveLength(3)
  })

  it('drops a waiting value when the latest one equals the value in flight', async () => {
    const { calls, send } = controlledSend()
    const onSaved = vi.fn()
    const push = createSaveQueue({ send, onSaved, onFailed: vi.fn() })
    push('a')
    push('ab')
    push('a')
    calls[0]?.resolve()
    await settle()
    expect(calls).toHaveLength(1)
    expect(onSaved).toHaveBeenCalledExactlyOnceWith('a')
  })
})
