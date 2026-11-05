import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ProviderError, type AiProvider } from '../provider'
import type { ResolvedCli } from './binary'
import { describeExit, safeDetail } from './cli-output'
import { createCliProvider, type CliAccount } from './cli-provider'
import { CliRuntime, versionKey, type CliProviderOptions } from './cli-runtime'
import {
  CODEX_MODELS,
  CODEX_REQUIRED_FLAGS,
  CODEX_SHELL_FEATURES,
  CodexEventParser,
  buildCodexExecArgs,
  buildCodexPrompt,
  codexDisableArgs,
  codexFeaturesToDisable,
  codexShellToolOff,
  isCodexModel,
  parseCodexAnswer,
  parseCodexFeatures,
  parseCodexLoginStatus,
} from './codex-protocol'

/**
 * Codex through the user's own `codex` binary and its sign-in. Codex reports
 * no account name, so the account check can only tell sign-in methods apart:
 * a switch to another ChatGPT account goes unnoticed.
 */
export function createCodexCliProvider(options: CliProviderOptions): AiProvider {
  const runtime = new CliRuntime('codex-cli', options)
  /** The `--disable` names per installed version, or why the version cannot be used. */
  const disabledFeatures = new Map<string, string[] | string>()

  const readAccount = async (cli: ResolvedCli, signal?: AbortSignal): Promise<CliAccount> => {
    const run = await runtime.invoke(cli, ['login', 'status'], {
      timeoutMs: runtime.limits.probeTimeoutMs,
      signal,
    })
    return parseCodexLoginStatus(run.exitCode, run.stdout, run.stderr)
  }

  /**
   * The features to switch off, read with `codex features list` once per
   * version. A string says why the version cannot be used: a run without the
   * list, without the shell features in it, or with a shell_tool that the
   * flags leave on would keep shell access. Failed runs are not cached, since
   * they may not happen again; what a list says is.
   */
  const readFeatures = async (
    cli: ResolvedCli,
    version: string,
    signal?: AbortSignal,
  ): Promise<string[] | string> => {
    const key = versionKey(cli, version)
    const cached = disabledFeatures.get(key)
    if (cached !== undefined) return cached
    const run = await runtime.invoke(cli, ['features', 'list'], {
      timeoutMs: runtime.limits.probeTimeoutMs,
      signal,
    })
    if (run.exitCode !== 0) return `codex features list ${describeExit(run.exitCode)}`
    const names = codexFeaturesToDisable(parseCodexFeatures(run.stdout))
    if (!names) {
      const reason = `codex features list lacks ${CODEX_SHELL_FEATURES.join(' or ')}`
      disabledFeatures.set(key, reason)
      return reason
    }
    // The same list again with the flags, to see that they take.
    const check = await runtime.invoke(cli, [...codexDisableArgs(names), 'features', 'list'], {
      timeoutMs: runtime.limits.probeTimeoutMs,
      signal,
    })
    if (check.exitCode !== 0) {
      return `codex features list with --disable ${describeExit(check.exitCode)}`
    }
    if (!codexShellToolOff(parseCodexFeatures(check.stdout))) {
      const reason = 'codex --disable shell_tool has no effect'
      disabledFeatures.set(key, reason)
      return reason
    }
    disabledFeatures.set(key, names)
    return names
  }

  return createCliProvider<CliAccount>(runtime, {
    helpChecks: [{ args: ['exec', '--help'], flags: CODEX_REQUIRED_FLAGS }],
    checkVersion: async (cli, version, signal) => {
      const features = await readFeatures(cli, version, signal)
      return typeof features === 'string' ? features : null
    },
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
    analyze: async ({ cli, version, request, signal, onProgress }) => {
      const features = await readFeatures(cli, version, signal)
      if (typeof features === 'string') {
        throw new ProviderError(
          'codex-cli',
          'cli_update_required',
          `Codex CLI ${version}: ${features}`,
        )
      }
      return runtime.withTempDir(async (dir) => {
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
          features,
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
      })
    },
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
