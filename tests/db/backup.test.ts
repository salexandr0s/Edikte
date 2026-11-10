import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMigrationBackup } from '../../src/main/db/backup'
import { openDatabase } from '../../src/main/db/client'
import { bundledMigrations, runMigrations } from '../../src/main/db/migrate'

let folder: string
let file: string
const opened: Database.Database[] = []

beforeEach(() => {
  folder = mkdtempSync(path.join(tmpdir(), 'edikte-migration-backup-'))
  file = path.join(folder, 'edikte.sqlite')
})
afterEach(() => {
  for (const sqlite of opened.splice(0)) if (sqlite.open) sqlite.close()
  rmSync(folder, { recursive: true, force: true })
})

function connect(fileName: string, readonly = false): Database.Database {
  const sqlite = new Database(fileName, { readonly, fileMustExist: readonly })
  opened.push(sqlite)
  return sqlite
}

function olderDatabase(): Database.Database {
  const sqlite = connect(file)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('wal_autocheckpoint = 0')
  runMigrations(
    sqlite,
    bundledMigrations().filter((migration) => migration.tag < '0005'),
  )
  sqlite.pragma('wal_checkpoint(TRUNCATE)')
  sqlite
    .prepare('INSERT INTO settings (id, value, updated_at) VALUES (1, ?, ?)')
    .run('{"language":"en"}', '2026-11-10T12:00:00.000Z')
  return sqlite
}

function backups(): string[] {
  const directory = path.join(folder, 'migration-backups')
  return existsSync(directory)
    ? readdirSync(directory).map((name) => path.join(directory, name))
    : []
}

function columns(sqlite: Database.Database, table: string): string[] {
  return sqlite
    .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => row.name)
}

describe('pre-migration database backup', () => {
  it('includes committed WAL data in a standalone old-schema snapshot before upgrading the source', () => {
    olderDatabase()
    expect(statSync(`${file}-wal`).size).toBeGreaterThan(32)
    const bareCopy = path.join(folder, 'bare-copy.sqlite')
    copyFileSync(file, bareCopy)
    expect(connect(bareCopy, true).prepare('SELECT * FROM settings').all()).toEqual([])

    const migrated = openDatabase(file)
    opened.push(migrated.$client)
    const [backup] = backups()
    expect(backups()).toHaveLength(1)
    if (backup === undefined) throw new Error('Missing backup')
    const snapshot = connect(backup, true)
    expect(snapshot.prepare('SELECT value FROM settings').get()).toEqual({
      value: '{"language":"en"}',
    })
    expect(columns(snapshot, 'edicts')).not.toContain('source')
    expect(
      snapshot.prepare('SELECT tag FROM schema_migrations ORDER BY tag DESC LIMIT 1').get(),
    ).toEqual({ tag: '0004_edict_locations' })
    expect(snapshot.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(columns(migrated.$client, 'edicts')).toContain('source')
    expect(migrated.$client.prepare('SELECT value FROM settings').get()).toEqual({
      value: '{"language":"en"}',
    })
    if (process.platform !== 'win32') expect(statSync(backup).mode & 0o777).toBe(0o600)
  })

  it('leaves schema, migration ledger and data unchanged if the backup cannot be written', () => {
    const source = olderDatabase()
    const schemaBefore = source
      .prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY name')
      .all()
    const migrationsBefore = source.prepare('SELECT * FROM schema_migrations ORDER BY tag').all()
    writeFileSync(path.join(folder, 'migration-backups'), 'blocks the backup directory')
    expect(() => openDatabase(file)).toThrowError(
      expect.objectContaining({ code: 'database_backup_failed' }),
    )
    expect(source.prepare('SELECT type, name, sql FROM sqlite_schema ORDER BY name').all()).toEqual(
      schemaBefore,
    )
    expect(source.prepare('SELECT * FROM schema_migrations ORDER BY tag').all()).toEqual(
      migrationsBefore,
    )
    expect(source.prepare('SELECT value FROM settings').get()).toEqual({
      value: '{"language":"en"}',
    })
  })

  it('does not back up fresh, current or newer-schema databases, or in-memory data', () => {
    const fresh = openDatabase(file)
    opened.push(fresh.$client)
    expect(backups()).toEqual([])
    fresh.$client.close()
    const current = openDatabase(file)
    opened.push(current.$client)
    expect(backups()).toEqual([])
    current.$client
      .prepare('INSERT INTO schema_migrations (tag, applied_at) VALUES (?, ?)')
      .run('9999_future', '2026-11-10T12:00:00.000Z')
    expect(() => openDatabase(file)).toThrowError(
      expect.objectContaining({ code: 'database_newer' }),
    )
    expect(backups()).toEqual([])
    const memory = connect(':memory:')
    memory.exec("CREATE TABLE populated (value TEXT); INSERT INTO populated VALUES ('made up')")
    expect(createMigrationBackup(memory, '0005_edict_source')).toBeNull()
  })

  it('uses a distinct filename for each backup and preserves earlier backups', () => {
    const sqlite = olderDatabase()
    const first = createMigrationBackup(sqlite, '0005_edict_source')
    if (first === null) throw new Error('Missing backup')
    const contents = readFileSync(first)
    const second = createMigrationBackup(sqlite, '0005_edict_source')
    expect(second).not.toBe(first)
    expect(backups()).toHaveLength(2)
    expect(readFileSync(first)).toEqual(contents)
  })
})
