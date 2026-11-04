import { utilityProcess } from 'electron'
import type { ExtractedDocument } from './extract'
import {
  runExtractWorker,
  type ExtractRunOptions,
  type ExtractWorkerProcess,
} from './extract-protocol'
import workerPath from './extract-worker?modulePath'

/** Reads the pages of a downloaded PDF in a utility process, never in main. */
export function extractInUtilityProcess(
  filePath: string,
  options: ExtractRunOptions = {},
): Promise<ExtractedDocument> {
  return runExtractWorker(spawnReader, filePath, options)
}

function spawnReader(): ExtractWorkerProcess {
  const child = utilityProcess.fork(workerPath, [], {
    serviceName: 'Edikte PDF reader',
    stdio: 'ignore',
    // The parser handles untrusted files and needs no environment variables.
    env:
      process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot ?? 'C:\\Windows' } : {},
  })
  return {
    postMessage: (message) => child.postMessage(message),
    onMessage: (listener) => {
      child.on('message', listener)
    },
    onExit: (listener) => {
      child.on('exit', listener)
    },
    kill: () => {
      child.kill()
    },
  }
}
