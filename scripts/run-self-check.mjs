// @ts-check
/**
 * Runs the self-check of a packaged Edikte build (see src/main/smoke-check.ts)
 * with a new, empty data folder and exits with the app's result: 0 when the
 * renderer loaded its data from main, 1 otherwise.
 *
 * Usage: node scripts/run-self-check.mjs <app executable>
 *   macOS:   <...>/Edikte.app/Contents/MacOS/Edikte
 *   Windows: <...>\Edikte.exe
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// The app reports a failure after 30 seconds by itself. This limit covers a
// process that hangs before the check starts.
const TIMEOUT_MS = 120_000

const executable = process.argv[2]
if (executable === undefined) {
  console.error('Usage: node scripts/run-self-check.mjs <app executable>')
  process.exit(2)
}

/**
 * @param {string} file
 * @param {NodeJS.ProcessEnv} env
 * @returns {Promise<{ code: number | null, signal: NodeJS.Signals | null, timedOut: boolean }>}
 */
function runApp(file, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, [], { env, stdio: 'inherit' })
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, TIMEOUT_MS)
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, timedOut })
    })
  })
}

/** @param {unknown} error */
function describe(error) {
  return error instanceof Error ? error.message : String(error)
}

const userDataDir = await mkdtemp(path.join(tmpdir(), 'edikte-self-check-'))
/** @type {NodeJS.ProcessEnv} */
const env = {}
for (const [key, value] of Object.entries(process.env)) {
  // ELECTRON_RUN_AS_NODE and similar variables change what the binary does.
  if (!key.startsWith('ELECTRON_')) env[key] = value
}
env.EDIKTE_SMOKE_TEST = '1'
env.EDIKTE_USER_DATA_DIR = userDataDir

let exitCode = 1
try {
  console.log(`Self-check of ${executable} with data folder ${userDataDir}`)
  const result = await runApp(executable, env)
  if (result.timedOut) {
    console.error(`::error::Self-check failed: no result after ${TIMEOUT_MS / 1000} seconds`)
  } else if (result.signal !== null) {
    // macOS kills an arm64 process whose code signature does not match its binary.
    console.error(`::error::Self-check failed: the app was stopped by ${result.signal}`)
  } else if (result.code === 0) {
    console.log('Self-check passed')
    exitCode = 0
  } else {
    console.error(`::error::Self-check failed with exit code ${result.code}; the app log is above`)
  }
} catch (error) {
  console.error(`::error::Could not start ${executable}: ${describe(error)}`)
} finally {
  try {
    await rm(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
  } catch (error) {
    // Helper processes can hold files for a moment on Windows; a leftover temp folder does no harm.
    console.warn(`Could not remove ${userDataDir}: ${describe(error)}`)
  }
}
process.exit(exitCode)
