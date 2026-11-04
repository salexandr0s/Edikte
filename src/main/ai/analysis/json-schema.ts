import { z } from 'zod'
import { AnalysisResultSchema } from '@shared/analysis-schema'

/**
 * The JSON Schema providers receive, derived from a Zod schema. One schema has
 * to pass OpenAI strict structured outputs (ChatGPT, OpenAI keys, Codex
 * `--output-schema`), Anthropic structured output and the Claude CLI
 * `--json-schema`, so it keeps to what all of them accept:
 * - every property is required, and every object has `additionalProperties: false`
 * - nullable values are `anyOf` unions with `{ type: 'null' }`, never type lists
 * - value constraints (minimum, maxLength, pattern, format and the like) move
 *   into the description, as in ternmail's AnthropicRequest.structuredSchema.
 *   Zod still enforces them when the answer is parsed.
 * Unknown keywords throw, so a schema change that needs new handling fails in
 * the tests instead of at a provider.
 */

/** Name sent with the schema where an API requires one. */
export const ANALYSIS_SCHEMA_NAME = 'gutachten_analysis'

type JsonObject = Record<string, unknown>

const CONSTRAINTS = new Map<string, (value: unknown) => string>([
  ['minimum', (value) => `at least ${String(value)}`],
  ['maximum', (value) => `at most ${String(value)}`],
  ['exclusiveMinimum', (value) => `greater than ${String(value)}`],
  ['exclusiveMaximum', (value) => `less than ${String(value)}`],
  ['multipleOf', (value) => `a multiple of ${String(value)}`],
  ['minLength', (value) => `at least ${String(value)} characters long`],
  ['maxLength', (value) => `at most ${String(value)} characters long`],
  ['pattern', (value) => `a string matching the regular expression ${String(value)}`],
  ['format', (value) => `a string in ${String(value)} format`],
  ['minItems', (value) => `a list of at least ${String(value)} items`],
  ['maxItems', (value) => `a list of at most ${String(value)} items`],
  ['uniqueItems', () => 'a list without duplicates'],
])

const COPIED = new Set(['type', 'enum', 'const', 'description'])
const OBJECT_KEYS = new Set(['properties', 'required', 'additionalProperties'])
// Metadata that tells the model nothing and that not every provider accepts.
const DROPPED = new Set(['$schema', '$id', 'title', 'default', 'examples'])

let analysisSchema: JsonObject | null = null

/** The provider schema for AnalysisResultSchema, as a fresh copy callers may change. */
export function analysisJsonSchema(): JsonObject {
  analysisSchema ??= toProviderJsonSchema(AnalysisResultSchema)
  return structuredClone(analysisSchema)
}

export function toProviderJsonSchema(schema: z.ZodType): JsonObject {
  return convert(z.toJSONSchema(schema, { io: 'output', target: 'draft-2020-12' }), '$')
}

function convert(input: unknown, path: string): JsonObject {
  if (!isJsonObject(input)) throw new Error(`Expected a schema object at ${path}`)
  const node = Array.isArray(input.type) ? splitTypeList(input, path) : input
  const output: JsonObject = {}
  const notes: string[] = []
  for (const [key, value] of Object.entries(node)) {
    const describe = CONSTRAINTS.get(key)
    if (describe !== undefined) {
      // Zod writes the safe integer range on every int(); that is no real limit.
      if (!isSafeIntegerBound(key, value)) notes.push(describe(value))
    } else if (key === 'items') {
      output.items = convert(value, `${path}[]`)
    } else if (key === 'anyOf') {
      output.anyOf = asList(value, path).map((branch, index) => convert(branch, `${path}|${index}`))
    } else if (COPIED.has(key)) {
      output[key] = value
    } else if (!OBJECT_KEYS.has(key) && !DROPPED.has(key)) {
      throw new Error(`Unsupported JSON Schema keyword "${key}" at ${path}`)
    }
  }
  if (node.type === 'object' || node.properties !== undefined) {
    Object.assign(output, convertObject(node, path))
  }
  if (notes.length > 0) output.description = withNotes(output.description, notes)
  return output
}

function convertObject(node: JsonObject, path: string): JsonObject {
  const properties = node.properties ?? {}
  if (!isJsonObject(properties)) throw new Error(`Expected properties to be an object at ${path}`)
  const keys = Object.keys(properties)
  const required = node.required === undefined ? [] : asList(node.required, path)
  const optional = keys.filter((key) => !required.includes(key))
  if (optional.length > 0) {
    throw new Error(
      `Optional properties at ${path}: ${optional.join(', ')}. Strict structured outputs need every property; use .nullable()`,
    )
  }
  if (node.additionalProperties !== undefined && node.additionalProperties !== false) {
    throw new Error(`additionalProperties must be false at ${path}`)
  }
  return {
    properties: Object.fromEntries(
      keys.map((key) => [key, convert(properties[key], `${path}.${key}`)]),
    ),
    required: keys,
    additionalProperties: false,
  }
}

// Zod writes simple nullable values as `{ type: ['boolean', 'null'] }`.
function splitTypeList(node: JsonObject, path: string): JsonObject {
  const types = asList(node.type, path)
  const others = types.filter((type) => type !== 'null')
  if (others.length !== 1 || !types.includes('null')) {
    throw new Error(`Unsupported type list at ${path}`)
  }
  const { description, ...rest } = node
  const branch: JsonObject = { ...rest, type: others[0] }
  if (Array.isArray(branch.enum)) {
    branch.enum = asList(branch.enum, path).filter((value) => value !== null)
  }
  const union: JsonObject = { anyOf: [branch, { type: 'null' }] }
  if (description !== undefined) union.description = description
  return union
}

function withNotes(description: unknown, notes: readonly string[]): string {
  const note = `Must be ${notes.join(' and ')}.`
  if (typeof description !== 'string' || description.trim() === '') return note
  const text = description.trim()
  return `${text}${/[.!?]$/.test(text) ? '' : '.'} ${note}`
}

function isSafeIntegerBound(key: string, value: unknown): boolean {
  return (
    (key === 'minimum' && value === Number.MIN_SAFE_INTEGER) ||
    (key === 'maximum' && value === Number.MAX_SAFE_INTEGER)
  )
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asList(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`Expected a list at ${path}`)
  return value as unknown[]
}
