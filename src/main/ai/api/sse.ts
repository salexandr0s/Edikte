export interface SseEvent {
  /** The `event:` field, or "message" when the frame has none. */
  event: string
  data: string
}

export interface SseLimits {
  /** Total bytes in the stream. */
  maxBytes: number
  /** Size of one event's data, and of one unfinished line. */
  maxEventBytes: number
  maxEvents: number
}

export class SseLimitError extends Error {}

/**
 * Incremental text/event-stream decoder following the WHATWG rules: LF, CR or
 * CRLF line ends, a leading BOM, comment lines, multi-line data. The `id` and
 * `retry` fields are ignored because these streams are never resumed.
 */
export class SseDecoder {
  private readonly decoder = new TextDecoder('utf-8')
  private buffer = ''
  private eventName = ''
  private data: string[] = []
  private dataSize = 0
  private totalBytes = 0
  private events = 0

  constructor(private readonly limits: SseLimits) {}

  push(chunk: Uint8Array): SseEvent[] {
    this.totalBytes += chunk.byteLength
    if (this.totalBytes > this.limits.maxBytes) throw new SseLimitError('Event stream too large')
    return this.consume(this.decoder.decode(chunk, { stream: true }), false)
  }

  /** Flushes the last line. An event without its closing blank line is dropped. */
  end(): SseEvent[] {
    return this.consume(this.decoder.decode(), true)
  }

  private consume(text: string, final: boolean): SseEvent[] {
    const input = this.buffer + text
    const events: SseEvent[] = []
    let start = 0
    for (let index = 0; index < input.length; index++) {
      const char = input.charCodeAt(index)
      if (char !== 0x0a && char !== 0x0d) continue
      // A CR at the end of a chunk may be the first half of a CRLF.
      if (char === 0x0d && index === input.length - 1 && !final) break
      this.line(input.slice(start, index), events)
      if (char === 0x0d && input.charCodeAt(index + 1) === 0x0a) index++
      start = index + 1
    }
    this.buffer = final ? '' : input.slice(start)
    if (this.buffer.length > this.limits.maxEventBytes)
      throw new SseLimitError('Event line too long')
    return events
  }

  private line(line: string, events: SseEvent[]): void {
    if (line === '') {
      if (this.data.length > 0) {
        this.events += 1
        if (this.events > this.limits.maxEvents) throw new SseLimitError('Too many events')
        events.push({ event: this.eventName || 'message', data: this.data.join('\n') })
      }
      this.eventName = ''
      this.data = []
      this.dataSize = 0
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') {
      this.eventName = value
    } else if (field === 'data') {
      this.dataSize += value.length + 1
      if (this.dataSize > this.limits.maxEventBytes) throw new SseLimitError('Event too large')
      this.data.push(value)
    }
  }
}

/** Decodes a response body; stops reading when the consumer stops iterating. */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
  limits: SseLimits,
): AsyncGenerator<SseEvent> {
  const decoder = new SseDecoder(limits)
  const reader = body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      yield* decoder.push(value)
    }
    yield* decoder.end()
  } finally {
    await reader.cancel().catch(() => undefined)
  }
}
