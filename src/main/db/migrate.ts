import type Database from 'better-sqlite3'
import { z } from 'zod'
import { AppError } from '@shared/errors'
import { createMigrationBackup } from './backup'
import journalJson from './migrations/meta/_journal.json'

// Migrations come from drizzle-kit (`npm run db:generate`). They are bundled
// as strings, so the packaged app needs no migrations folder on disk.
const sqlByPath = import.meta.glob<string>('./migrations/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
})

const JournalSchema = z.object({
  entries: z.array(z.object({ idx: z.number().int(), tag: z.string().min(1) })),
})

export interface Migration {
  tag: string
  statements: string[]
}

export function bundledMigrations(): Migration[] {
  const journal = JournalSchema.parse(journalJson)
  return journal.entries
    .toSorted((a, b) => a.idx - b.idx)
    .map(({ tag }) => {
      const sql = sqlByPath[`./migrations/${tag}.sql`]
      if (sql === undefined) throw new Error(`Migration file for ${tag} is missing`)
      const statements = sql
        .split('--> statement-breakpoint')
        .map((statement) => statement.trim())
        .filter((statement) => statement !== '')
      return { tag, statements }
    })
}

/**
 * Applies pending migrations, each in its own transaction, and records them
 * in schema_migrations. Refuses to open a database written by a newer app.
 */
export function runMigrations(
  sqlite: Database.Database,
  migrations = bundledMigrations(),
): string[] {
  const hasLedger =
    sqlite
      .prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'")
      .get() !== undefined
  const applied = new Set(
    hasLedger
      ? sqlite
          .prepare<[], { tag: string }>('SELECT tag FROM schema_migrations')
          .all()
          .map((row) => row.tag)
      : [],
  )
  const known = new Set(migrations.map((migration) => migration.tag))
  const unknown = [...applied].filter((tag) => !known.has(tag))
  if (unknown.length > 0) {
    throw new AppError(
      'database_newer',
      `The database was written by a newer version of the app (${unknown.join(', ')})`,
    )
  }

  const pending = migrations.filter((migration) => !applied.has(migration.tag))
  const firstPending = pending[0]
  if (firstPending === undefined) return []
  createMigrationBackup(sqlite, firstPending.tag)
  sqlite.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (tag TEXT PRIMARY KEY NOT NULL, applied_at TEXT NOT NULL)',
  )

  const record = sqlite.prepare('INSERT INTO schema_migrations (tag, applied_at) VALUES (?, ?)')
  const newlyApplied: string[] = []
  for (const migration of pending) {
    sqlite.transaction(() => {
      for (const statement of migration.statements) sqlite.exec(statement)
      record.run(migration.tag, new Date().toISOString())
    })()
    newlyApplied.push(migration.tag)
  }
  return newlyApplied
}
