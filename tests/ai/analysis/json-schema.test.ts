import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { analysisJsonSchema, toProviderJsonSchema } from '../../../src/main/ai/analysis/json-schema'

type SchemaNode = Record<string, unknown>

// What OpenAI strict mode, Anthropic structured output and both CLIs all accept.
const PORTABLE_KEYWORDS = new Set([
  'type',
  'enum',
  'const',
  'description',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'anyOf',
])

function isNode(value: unknown): value is SchemaNode {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Every node with its path, such as "$.areas[].page"; "|0" marks an anyOf branch. */
function schemaNodes(node: SchemaNode, path = '$'): Array<[string, SchemaNode]> {
  const nodes: Array<[string, SchemaNode]> = [[path, node]]
  if (isNode(node.properties)) {
    for (const [key, child] of Object.entries(node.properties)) {
      if (isNode(child)) nodes.push(...schemaNodes(child, `${path}.${key}`))
    }
  }
  if (isNode(node.items)) nodes.push(...schemaNodes(node.items, `${path}[]`))
  const branches: unknown[] = Array.isArray(node.anyOf) ? node.anyOf : []
  branches.forEach((branch, index) => {
    if (isNode(branch)) nodes.push(...schemaNodes(branch, `${path}|${index}`))
  })
  return nodes
}

describe('analysisJsonSchema', () => {
  const schema = analysisJsonSchema()
  const nodes = schemaNodes(schema)

  it('requires every property and allows no other keys', () => {
    const objects = nodes.filter(([, node]) => node.type === 'object')
    expect(objects.map(([path]) => path)).toEqual(
      expect.arrayContaining(['$', '$.areas[]', '$.verkehrswert|0', '$.risks[]']),
    )
    for (const [path, node] of objects) {
      expect(node.additionalProperties, path).toBe(false)
      expect(node.required, path).toEqual(
        Object.keys(isNode(node.properties) ? node.properties : {}),
      )
    }
  })

  it('uses only keywords every provider accepts', () => {
    for (const [path, node] of nodes) {
      expect(
        Object.keys(node).filter((key) => !PORTABLE_KEYWORDS.has(key)),
        path,
      ).toEqual([])
      expect(Array.isArray(node.type), path).toBe(false)
    }
  })

  it('writes nullable values as unions with null and constraints as text', () => {
    const byPath = new Map(nodes)
    const page = byPath.get('$.areas[].page')
    expect(page?.anyOf).toEqual([
      { type: 'integer', description: 'Must be at least 1.' },
      { type: 'null' },
    ])
    expect(page?.description).toMatch(/PDF page number/)
    expect(byPath.get('$.areas[].sqm')).toEqual({
      type: 'number',
      description: 'Must be greater than 0.',
    })
  })

  it('returns a copy that callers may change', () => {
    const copy = analysisJsonSchema()
    copy.properties = {}
    expect(analysisJsonSchema()).toEqual(schema)
  })
})

describe('toProviderJsonSchema', () => {
  it('turns type lists into unions and moves constraints into descriptions', () => {
    const schema = z.object({
      flag: z.boolean().nullable().describe('A flag'),
      size: z.number().min(2).max(9).describe('Size'),
      tags: z.array(z.string().max(20)).max(3),
    })
    expect(toProviderJsonSchema(schema)).toEqual({
      type: 'object',
      properties: {
        flag: { anyOf: [{ type: 'boolean' }, { type: 'null' }], description: 'A flag' },
        size: { type: 'number', description: 'Size. Must be at least 2 and at most 9.' },
        tags: {
          type: 'array',
          items: { type: 'string', description: 'Must be at most 20 characters long.' },
          description: 'Must be a list of at most 3 items.',
        },
      },
      required: ['flag', 'size', 'tags'],
      additionalProperties: false,
    })
  })

  it('rejects shapes that strict structured outputs cannot express', () => {
    expect(() => toProviderJsonSchema(z.object({ note: z.string().optional() }))).toThrow(
      /Optional properties at \$: note/,
    )
    expect(() => toProviderJsonSchema(z.record(z.string(), z.number()))).toThrow()
  })
})
