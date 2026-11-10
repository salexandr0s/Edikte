import { randomUUID } from 'node:crypto'
import { closeSync, fsyncSync, mkdirSync, openSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { AppError } from '@shared/errors'

/**
 * A standalone SQLite snapshot before migrations, including committed WAL
 * changes. Empty databases and migration ledgers without app tables need none.
 */
export function createMigrationBackup(
  sqlite: Database.Database,
  firstMigration: string,
): string | null {
  if (sqlite.memory || sqlite.name === '') return null
  const hasAppTables =
    sqlite
      .prepare(
        "SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name NOT GLOB 'sqlite_*' AND name <> 'schema_migrations' LIMIT 1",
      )
      .get() !== undefined
  if (!hasAppTables) return null

  const sourceFile = path.resolve(sqlite.name)
  const folder = path.join(path.dirname(sourceFile), 'migration-backups')
  const timestamp = new Date().toISOString().replaceAll(':', '-')
  const tag = firstMigration.replace(/[^a-zA-Z0-9_-]/g, '_')
  const file = path.join(
    folder,
    `${path.basename(sourceFile)}.before-${tag}-${timestamp}-${randomUUID()}.sqlite`,
  )
  let reserved = false
  try {
    mkdirSync(folder, { recursive: true, mode: 0o700 })
    // VACUUM accepts an empty file. Exclusive creation keeps every prior backup
    // intact and sets its permissions before SQLite writes any contents.
    const empty = openSync(file, 'wx', 0o600)
    reserved = true
    closeSync(empty)
    sqlite.prepare('VACUUM INTO ?').run(file)
    const saved = openSync(file, 'r+')
    try {
      fsyncSync(saved)
    } finally {
      closeSync(saved)
    }
    return file
  } catch (cause) {
    if (reserved) {
      try {
        unlinkSync(file)
      } catch {
        /* Leave a failed cleanup for manual inspection. */
      }
    }
    throw new AppError(
      'database_backup_failed',
      'The pre-migration database backup could not be saved; the database was not upgraded',
      { cause },
    )
  }
}
