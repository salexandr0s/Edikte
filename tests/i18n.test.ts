import { describe, expect, it } from 'vitest'
import { BundeslandSchema } from '@shared/enums'
import { AppErrorCodeSchema } from '@shared/errors'
import de from '../src/renderer/src/i18n/de.json'
import en from '../src/renderer/src/i18n/en.json'

interface Tree {
  [key: string]: string | Tree
}

function flatten(tree: Tree, prefix = ''): Map<string, string> {
  const flat = new Map<string, string>()
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === '' ? key : `${prefix}.${key}`
    if (typeof value === 'string') flat.set(path, value)
    else for (const entry of flatten(value, path)) flat.set(...entry)
  }
  return flat
}

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((match) => match[1] ?? '').sort()
}

const languages = { de: flatten(de), en: flatten(en) }

describe('translations', () => {
  it('have the same keys in German and English', () => {
    expect([...languages.de.keys()].sort()).toEqual([...languages.en.keys()].sort())
  })

  it('have no empty strings', () => {
    for (const [language, strings] of Object.entries(languages)) {
      for (const [key, value] of strings) {
        expect(value.trim(), `${language}: ${key}`).not.toBe('')
      }
    }
  })

  it('use the same placeholders in both languages', () => {
    for (const [key, value] of languages.en) {
      expect(placeholders(languages.de.get(key) ?? ''), key).toEqual(placeholders(value))
    }
  })

  it('cover every error code and Bundesland', () => {
    for (const strings of Object.values(languages)) {
      for (const code of AppErrorCodeSchema.options)
        expect(strings.has(`errors.${code}`)).toBe(true)
      for (const land of BundeslandSchema.options)
        expect(strings.has(`bundesland.${land}`)).toBe(true)
    }
  })
})
