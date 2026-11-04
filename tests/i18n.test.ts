import { describe, expect, it } from 'vitest'
import { BundeslandSchema } from '@shared/enums'
import { AppErrorCodeSchema } from '@shared/errors'
import { resources, translationFiles } from '../src/renderer/src/i18n/resources'

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

const languages = {
  de: flatten(resources.de.translation),
  en: flatten(resources.en.translation),
}

describe('translations', () => {
  it('define each namespace in one file only', () => {
    for (const [language, files] of Object.entries(translationFiles)) {
      const owners = new Map<string, string>()
      for (const [file, tree] of Object.entries(files)) {
        for (const namespace of Object.keys(tree)) {
          expect(owners.get(namespace), `${language}: ${namespace} in ${file}`).toBeUndefined()
          owners.set(namespace, file)
        }
      }
    }
  })

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
