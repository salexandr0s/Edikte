import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SettingsPatchSchema } from '@shared/domain'
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

  it('keep the rows of a database last opened before migration 0005', () => {
    // Catches a migration that loses documents, analyses, stars or notes. A table
    // rebuild would: with foreign keys on, dropping the old table deletes every
    // row that references it.
    const edictId = 'c'.repeat(32)
    const at = '2026-11-05T09:00:00.000Z'
    // One made-up row per table, in an order the foreign keys allow.
    const oldRows: [table: string, row: Record<string, string | number | null>][] = [
      [
        'edicts',
        {
          id: edictId,
          case_key: 'made-up-case',
          notice_type: 'versteigerung',
          status: 'upcoming',
          url: 'https://example.invalid/edict',
          property_type: 'apartment',
          title: 'Musterwohnung Top 1',
          raw_labels: '{}',
          content_hash: 'hash',
          parser_version: 1,
          first_seen_at: at,
          last_seen_at: at,
          fetched_at: at,
        },
      ],
      [
        'documents',
        {
          id: 7,
          edict_id: edictId,
          kind: 'langgutachten',
          title: 'Langgutachten (pdf)',
          file_name: 'gutachten.pdf',
          url: 'https://example.invalid/gutachten.pdf',
          local_path: `${edictId}/gutachten.pdf`,
          created_at: at,
        },
      ],
      [
        'document_pages',
        { id: 4, document_id: 7, page_number: 1, has_text: 1, text: 'Musterseite' },
      ],
      [
        'analyses',
        {
          id: 3,
          edict_id: edictId,
          provider: 'claude-cli',
          model: 'made-up-model',
          prompt_version: 1,
          schema_version: 1,
          status: 'done',
          result: '{"summary":"made up"}',
          created_at: at,
        },
      ],
      [
        'user_state',
        { case_key: 'made-up-case', starred: 1, notes: 'Made-up note', updated_at: at },
      ],
      [
        'saved_filters',
        {
          id: 2,
          name: 'Made-up filter',
          query: '{"bezirke":[21]}',
          created_at: at,
          updated_at: at,
        },
      ],
      [
        'sync_runs',
        { id: 5, kind: 'full', status: 'ok', scope: '["wien"]', started_at: at, listed: 1 },
      ],
      [
        'edict_locations',
        {
          edict_id: edictId,
          query: 'Musterweg 1, Musterstadt',
          lat: 47.5,
          lng: 14.5,
          precision: 'address',
          provider: 'made-up',
          geocoded_at: at,
        },
      ],
    ]

    const sqlite = new Database(':memory:')
    try {
      // As in openDatabase: the app migrates with foreign keys on.
      sqlite.pragma('foreign_keys = ON')
      const older = bundledMigrations().filter((migration) => migration.tag < '0005')
      expect(runMigrations(sqlite, older).at(-1)).toBe('0004_edict_locations')
      for (const [table, row] of oldRows) {
        const columns = Object.keys(row)
        const placeholders = columns.map(() => '?').join(', ')
        sqlite
          .prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`)
          .run(...Object.values(row))
      }

      expect(runMigrations(sqlite)[0]).toBe('0005_edict_source')

      for (const [table, row] of oldRows) {
        const kept = sqlite.prepare(`SELECT ${Object.keys(row).join(', ')} FROM ${table}`).all()
        expect(kept, table).toEqual([row])
      }
      expect(sqlite.prepare('SELECT source, insolvency FROM edicts').all()).toEqual([
        { source: 'court_auction', insolvency: null },
      ])
      expect(sqlite.prepare('SELECT source FROM sync_runs').all()).toEqual([
        { source: 'court_auction' },
      ])
      expect(sqlite.prepare('SELECT removed_at FROM documents').all()).toEqual([
        { removed_at: null },
      ])
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
    } finally {
      sqlite.close()
    }
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

  it('keeps the fields a settings:update patch leaves out', () => {
    const database = open()
    const consentAt = '2026-11-05T08:00:00.000Z'
    updateSettings(database, { autoSync: false, analysisConsentAt: consentAt })
    updateSettings(database, SettingsPatchSchema.parse({ language: 'en' }))
    expect(readSettings(database)).toMatchObject({
      language: 'en',
      autoSync: false,
      analysisConsentAt: consentAt,
    })
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
