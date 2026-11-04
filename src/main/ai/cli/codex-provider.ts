import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProviderError, type AiProvider } from '../provider'
import type { ResolvedCli } from './binary'
import { safeDetail } from './cli-output'
import { createCliProvider, type CliAccount } from './cli-provider'
import { CliRuntime, type CliProviderOptions } from './cli-runtime'
import {
  CODEX_MODELS,
  CODEX_REQUIRED_FLAGS,
  CodexEventParser,
  buildCodexExecArgs,
  buildCodexPrompt,
  isCodexModel,
  parseCodexAnswer,
  parseCodexLoginStatus,
} from './codex-protocol'

/**
 * Codex through the user's own `codex` binary and its sign-in. Codex reports
 * no account name, so the account check can only tell sign-in methods apart.
 */
export function createCodexCliProvider(options: CliProviderOptions): AiProvider {
  const runtime = new CliRuntime('codex-cli', options)

  const readAccount = async (cli: ResolvedCli, signal?: AbortSignal): Promise<CliAccount> => {
    const run = await runtime.invoke(cli, ['login', 'status'], {
      timeoutMs: runtime.limits.probeTimeoutMs,
      signal,
    })
    return parseCodexLoginStatus(run.exitCode, run.stdout, run.stderr)
  }

  return createCliProvider<CliAccount>(runtime, {
    helpArgs: ['exec', '--help'],
    requiredFlags: CODEX_REQUIRED_FLAGS,
    loginArgs: ['login'],
    models: CODEX_MODELS,
    readAccount,
    validate: (request) => {
      if (!isCodexModel(request.model)) {
        throw new ProviderError(
          'codex-cli',
          'invalid_request',
          `"${safeDetail(request.model, 40)}" is not a valid model ID`,
        )
      }
    },
    // The schema, the images and the answer file stay in the run's private folder.
    analyze: ({ cli, request, signal, onProgress }) =>
      runtime.withTempDir(async (dir) => {
        const { prompt, images } = buildCodexPrompt(request.system, request.content)
        const schemaPath = join(dir, 'output-schema.json')
        const answerPath = join(dir, 'answer.json')
        await writeFile(schemaPath, JSON.stringify(request.jsonSchema), { mode: 0o600 })
        for (const image of images) {
          await writeFile(join(dir, image.fileName), image.data, { mode: 0o600 })
        }
        const parser = new CodexEventParser(onProgress)
        const args = buildCodexExecArgs(
          {
            workDir: dir,
            schemaPath,
            answerPath,
            imageFiles: images.map((image) => image.fileName),
          },
          request.model,
        )
        const run = await runtime.invoke(
          cli,
          args,
          {
            input: Buffer.from(prompt, 'utf8'),
            onLine: (line) => parser.push(line),
            timeoutMs: runtime.limits.analysisTimeoutMs,
            signal,
          },
          dir,
        )
        const events = parser.finish(run.exitCode, run.stderr)
        return {
          json: await readAnswer(answerPath, runtime.limits.maxStdoutBytes),
          usage: {
            inputTokens: events.inputTokens,
            outputTokens: events.outputTokens,
            costUsd: null,
          },
          model: request.model,
          accountLabel: null,
          raw: events.raw,
        }
      }),
  })
}

/** The `-o` file Codex writes with its final message. */
async function readAnswer(path: string, maxBytes: number): Promise<unknown> {
  let text: string
  try {
    const info = await stat(path)
    if (info.size > maxBytes) {
      throw new ProviderError(
        'codex-cli',
        'provider_invalid_output',
        'The final Codex message is too large',
      )
    }
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof ProviderError) throw error
    throw new ProviderError('codex-cli', 'provider_incomplete', 'Codex wrote no final message')
  }
  return parseCodexAnswer(text)
}
