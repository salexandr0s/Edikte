import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '@shared/domain'
import { isAppError } from '@shared/errors'
import { openDatabase, type AppDatabase } from '../../src/main/db/client'
import { bundledMigrations, runMigrations } from '../../src/main/db/migrate'
import { documentPages, documents, edicts } from '../../src/main/db/schema'
import { parseStoredSettings, readSettings, updateSettings } from '../../src/main/db/settings-store'
import {
  deleteFilter,
  ensurePresetFilters,
  listSavedFilters,
  saveFilter,
} from '../../src/main/db/user-store'

let db: AppDatabase | null = null

function open(): AppDatabase {
  db = openDatabase(':memory:')
  return db
}

afterEach(() => {
  db?.$client.close()
  db = null
})

function searchPages(database: AppDatabase, term: string): number[] {
  return database.$client
    .prepare<[string], { rowid: number }>(
      'SELECT rowid FROM document_pages_fts WHERE document_pages_fts MATCH ? ORDER BY rowid',
    )
    .all(term)
    .map((match) => match.rowid)
}

describe('migrations', () => {
  it('apply once and are skipped on the next start', () => {
    const database = open()
    const tags = bundledMigrations().map((migration) => migration.tag)
    expect(tags.length).toBeGreaterThan(1)
    expect(runMigrations(database.$client)).toEqual([])
    const applied = database.$client
      .prepare<[], { tag: string }>('SELECT tag FROM schema_migrations ORDER BY tag')
      .all()
      .map((row) => row.tag)
    expect(applied).toEqual(tags)
  })

  it('refuse a database written by a newer version', () => {
    const database = open()
    database.$client
      .prepare('INSERT INTO schema_migrations (tag, applied_at) VALUES (?, ?)')
      .run('9999_future', new Date().toISOString())
    let code: string | null = null
    try {
      runMigrations(database.$client)
    } catch (error) {
      code = isAppError(error) ? error.code : 'other'
    }
    expect(code).toBe('database_newer')
  })

  it('keep the full-text index in sync with document pages', () => {
    const database = open()
    const now = new Date().toISOString()
    database
      .insert(edicts)
      .values({
        id: '0'.repeat(32),
        caseKey: 'case',
        noticeType: 'versteigerung',
        status: 'upcoming',
        url: 'https://edikte.justiz.gv.at/',
        propertyType: 'apartment',
        title: 'Eigentumswohnung',
        rawLabels: {},
        contentHash: 'hash',
        parserVersion: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        fetchedAt: now,
      })
      .run()
    const document = database
      .insert(documents)
      .values({
        edictId: '0'.repeat(32),
        kind: 'langgutachten',
        title: 'Langgutachten (pdf)',
        fileName: 'gutachten.pdf',
        url: 'https://edikte.justiz.gv.at/gutachten.pdf',
        createdAt: now,
      })
      .returning({ id: documents.id })
      .get()
    const page = database
      .insert(documentPages)
      .values({
        documentId: document.id,
        pageNumber: 8,
        hasText: true,
        text: 'Die Nutzfläche beträgt 65,76 m².',
      })
      .returning({ id: documentPages.id })
      .get()

    // remove_diacritics: "nutzflache" finds "Nutzfläche".
    expect(searchPages(database, 'nutzflache')).toEqual([page.id])

    database.$client
      .prepare('UPDATE document_pages SET text = ? WHERE id = ?')
      .run('Wohnfläche 70 m²', page.id)
    expect(searchPages(database, 'nutzflache')).toEqual([])
    expect(searchPages(database, 'wohnflache')).toEqual([page.id])

    database.$client.prepare('DELETE FROM document_pages WHERE id = ?').run(page.id)
    expect(searchPages(database, 'wohnflache')).toEqual([])
  })
})

describe('settings store', () => {
  it('returns defaults until settings are saved', () => {
    const database = open()
    expect(readSettings(database)).toEqual(DEFAULT_SETTINGS)
    updateSettings(database, { language: 'en', documentRetentionDays: 30 })
    expect(readSettings(database)).toMatchObject({ language: 'en', documentRetentionDays: 30 })
  })

  it('drops only the invalid fields of stored settings', () => {
    const stored = parseStoredSettings({ language: 'fr', autoSync: false, selectedProvider: 'x' })
    expect(stored).toEqual({ ...DEFAULT_SETTINGS, autoSync: false })
  })
})

describe('saved filters', () => {
  it('ship the preset once and protect it', () => {
    const database = open()
    ensurePresetFilters(database)
    ensurePresetFilters(database)
    const [preset, ...others] = listSavedFilters(database)
    expect(others).toEqual([])
    expect(preset?.presetKey).toBe('wien_under_5000')
    expect(preset?.query.maxPricePerSqm).toBe(5000)

    let code: string | null = null
    try {
      deleteFilter(database, preset?.id ?? -1)
    } catch (error) {
      code = isAppError(error) ? error.code : 'other'
    }
    expect(code).toBe('forbidden')

    const saved = saveFilter(database, { name: 'Floridsdorf', query: { bezirke: [21] } })
    expect(saved.presetKey).toBeNull()
    expect(saved.query.bezirke).toEqual([21])
    deleteFilter(database, saved.id)
    expect(listSavedFilters(database)).toHaveLength(1)
  })
})
