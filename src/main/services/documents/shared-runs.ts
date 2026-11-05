import { AppError, isAppError } from '@shared/errors'
import { log } from '../../log'

export type StartRun<Key, Result, Step> = (
  key: Key,
  signal: AbortSignal,
  onStep: (step: Step) => void,
) => Promise<Result>

interface Caller<Step> {
  onStep: ((step: Step) => void) | undefined
}

interface Entry<Result, Step> {
  controller: AbortController
  callers: Set<Caller<Step>>
  /** The newest step, for callers that join late. */
  latest: { step: Step } | null
  run: Promise<Result>
}

/**
 * One run per key, shared by every caller that asks for the key while it runs,
 * such as the download of one document. Each caller waits with its own signal:
 * an abort rejects that caller alone with `cancelled`, and the run itself is
 * aborted once no caller waits for it. Steps reach every caller waiting at the
 * time; a caller that joins late gets the newest step first.
 */
export class SharedRuns<Key, Result, Step> {
  private readonly entries = new Map<Key, Entry<Result, Step>>()
  private stopped = false

  constructor(private readonly start: StartRun<Key, Result, Step>) {}

  /** Joins the run for `key`, or starts one. */
  join(key: Key, signal: AbortSignal, onStep?: (step: Step) => void): Promise<Result> {
    if (this.stopped || signal.aborted) return Promise.reject(cancelled())
    const entry = this.entryFor(key)
    const caller: Caller<Step> = { onStep }
    entry.callers.add(caller)
    if (entry.latest !== null) deliver(caller, entry.latest.step)
    let abandon = noop
    const abandoned = new Promise<never>((_resolve, reject) => {
      abandon = () => {
        reject(cancelled())
        entry.callers.delete(caller)
        if (entry.callers.size === 0) entry.controller.abort()
      }
      signal.addEventListener('abort', abandon, { once: true })
    })
    return Promise.race([entry.run, abandoned]).finally(() => {
      signal.removeEventListener('abort', abandon)
      entry.callers.delete(caller)
    })
  }

  /** Whether a run for `key` has not settled yet. */
  has(key: Key): boolean {
    return this.entries.has(key)
  }

  /** For app quit: aborts every run, and later calls fail with `cancelled`. */
  stop(): void {
    this.stopped = true
    for (const entry of this.entries.values()) entry.controller.abort()
  }

  /** Settles once no run is left. */
  async idle(): Promise<void> {
    while (this.entries.size > 0) {
      await Promise.allSettled([...this.entries.values()].map((entry) => entry.run))
    }
  }

  private entryFor(key: Key): Entry<Result, Step> {
    const existing = this.entries.get(key)
    if (existing !== undefined && !existing.controller.signal.aborted) return existing
    // A run that every caller left may still be stopping: the next one starts after it.
    const previous = existing === undefined ? Promise.resolve() : existing.run.then(noop, noop)
    const controller = new AbortController()
    const entry: Entry<Result, Step> = {
      controller,
      callers: new Set(),
      latest: null,
      run: previous.then(() => {
        if (controller.signal.aborted) throw cancelled()
        return this.start(key, controller.signal, (step) => {
          entry.latest = { step }
          for (const caller of entry.callers) deliver(caller, step)
        })
      }),
    }
    this.entries.set(key, entry)
    const forget = (): void => {
      if (this.entries.get(key) === entry) this.entries.delete(key)
    }
    void entry.run.then(forget, forget)
    return entry
  }
}

function deliver<Step>(caller: Caller<Step>, step: Step): void {
  try {
    caller.onStep?.(step)
  } catch (error) {
    // One caller's listener must not fail the run the others wait for.
    log.warn('documents', 'A progress listener failed', isAppError(error) ? error.code : undefined)
  }
}

function cancelled(): AppError {
  return new AppError('cancelled', 'Cancelled')
}

function noop(): void {}
