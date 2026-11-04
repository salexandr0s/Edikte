// Stands in for the claude and codex binaries in the provider tests. The
// scenario comes from $HOME/fake-cli.json, because HOME is one of the few
// variables the app passes on; every call is appended to $HOME/calls.jsonl.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const home = process.env.HOME ?? ''
const scenario = JSON.parse(readFileSync(join(home, 'fake-cli.json'), 'utf8'))
const args = process.argv.slice(2)

function record(kind, extra = {}) {
  appendFileSync(join(home, 'calls.jsonl'), `${JSON.stringify({ kind, args, ...extra })}\n`)
}

function finish(stdout, stderr, exitCode) {
  if (stdout) process.stdout.write(stdout)
  if (stderr) process.stderr.write(stderr)
  // process.exit() could cut off output that is still in the pipe.
  process.exitCode = exitCode
}

// Answers to auth status and login status come in the scenario's order; the last one repeats.
function nextAuth() {
  const counterPath = join(home, 'auth-calls.txt')
  const count = existsSync(counterPath) ? Number(readFileSync(counterPath, 'utf8')) : 0
  writeFileSync(counterPath, String(count + 1))
  return scenario.auth[Math.min(count, scenario.auth.length - 1)]
}

async function readStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

function valueAfter(flag) {
  const index = args.indexOf(flag)
  return index === -1 ? null : args[index + 1]
}

async function analysis() {
  const run = scenario.run ?? {}
  if (run.ignoreSigterm) process.on('SIGTERM', () => {})
  const stdin = await readStdin()
  if (args[0] === 'exec') {
    const schemaPath = valueAfter('--output-schema')
    const images = args.flatMap((arg, index) => (arg === '-i' ? [args[index + 1]] : []))
    record('exec', {
      stdin,
      schema: schemaPath ? readFileSync(schemaPath, 'utf8') : null,
      images: images.map((name) => ({
        name,
        bytes: existsSync(name) ? readFileSync(name).length : -1,
      })),
    })
    const answerPath = valueAfter('-o')
    if (answerPath && typeof run.answer === 'string') writeFileSync(answerPath, run.answer)
  } else {
    record('print', { stdin })
  }
  for (const line of run.lines ?? []) process.stdout.write(`${line}\n`)
  if (run.hang) setInterval(() => {}, 60_000)
  else finish('', run.stderr ?? '', run.exitCode ?? 0)
}

const isAuthStatus =
  (args.at(-3) === 'auth' && args.at(-2) === 'status') ||
  (args[0] === 'login' && args[1] === 'status')
const isLogin = args.at(-2) === 'login' || (args[0] === 'login' && args.length === 1)

if (args.includes('--version')) {
  record('version')
  finish(`${scenario.version}\n`, '', 0)
} else if (args.includes('--help')) {
  record('help')
  finish(scenario.help, '', 0)
} else if (isAuthStatus) {
  record('auth')
  const answer = nextAuth()
  finish(answer.stdout ?? '', answer.stderr ?? '', answer.exitCode ?? 0)
} else if (isLogin) {
  record('login')
  finish('', '', scenario.loginExitCode ?? 0)
} else {
  await analysis()
}
