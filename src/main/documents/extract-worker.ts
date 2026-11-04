import { readFile, stat } from 'node:fs/promises'
import { isAppError } from '@shared/errors'
import { extractPages } from './extract'
import { ExtractErrorCodeSchema, ExtractRequestSchema, type ExtractReply } from './extract-protocol'

// Entry of the utility process that parses untrusted PDFs away from the main
// process. One request per process; the host kills it after the reply.

process.parentPort.once('message', (event) => {
  void handle(event.data).then((reply) => process.parentPort.postMessage(reply))
})

async function handle(data: unknown): Promise<ExtractReply> {
  const request = ExtractRequestSchema.safeParse(data)
  if (!request.success) return { id: '', ok: false, code: 'internal', message: 'Invalid request' }
  const { id, filePath, maxBytes } = request.data
  try {
    const info = await stat(filePath)
    if (!info.isFile()) return { id, ok: false, code: 'not_found', message: 'The file is missing' }
    if (info.size > maxBytes) {
      return { id, ok: false, code: 'document_too_large', message: 'The file is too large to read' }
    }
    const file = await readFile(filePath)
    const document = await extractPages(new Uint8Array(file.buffer, file.byteOffset, file.length))
    return { id, ok: true, document }
  } catch (error) {
    if (isAppError(error)) {
      const code = ExtractErrorCodeSchema.safeParse(error.code)
      return { id, ok: false, code: code.success ? code.data : 'internal', message: error.message }
    }
    const missing = typeof error === 'object' && error !== null && 'code' in error
    if (missing && error.code === 'ENOENT') {
      return { id, ok: false, code: 'not_found', message: 'The file is missing' }
    }
    return { id, ok: false, code: 'document_unreadable', message: 'The PDF could not be read' }
  }
}
