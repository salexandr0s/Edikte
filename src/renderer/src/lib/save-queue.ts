// No React and no DOM, so the unit tests can import this module in Node.

export interface SaveQueueOptions<T, R> {
  send: (value: T) => Promise<R>
  /** The latest value was stored. */
  onSaved: (result: R) => void
  /** The latest value failed. Failures of older values are not reported. */
  onFailed: (error: unknown) => void
}

/**
 * Sends one save at a time and always ends with the latest value. A value
 * pushed while a save is in flight waits for it and replaces any value that
 * was waiting before, so only the in-flight save and the latest value go out.
 * The queue does not depend on a component, so a save started before the user
 * leaves a screen still runs to the end.
 */
export function createSaveQueue<T, R>({
  send,
  onSaved,
  onFailed,
}: SaveQueueOptions<T, R>): (value: T) => void {
  // Boxed, so that any value, undefined included, can be queued.
  let sending: { value: T } | null = null
  let waiting: { value: T } | null = null

  async function drain(current: { value: T }): Promise<void> {
    let outcome: { ok: true; result: R } | { ok: false; error: unknown }
    try {
      outcome = { ok: true, result: await send(current.value) }
    } catch (error) {
      outcome = { ok: false, error }
    }
    const next = waiting
    waiting = null
    sending = next
    // A newer value goes out next, so this answer is out of date.
    if (next !== null) return drain(next)
    if (outcome.ok) onSaved(outcome.result)
    else onFailed(outcome.error)
  }

  return (value) => {
    if (sending === null) {
      sending = { value }
      void drain(sending)
    } else {
      // The save in flight already carries this value, so nothing has to wait.
      waiting = Object.is(value, sending.value) ? null : { value }
    }
  }
}
