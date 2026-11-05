import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { runMigrations } from './migrate'
import * as schema from './schema'

export type AppDatabase = BetterSQLite3Database<typeof schema> & { $client: Database.Database }

/** Opens (or creates) the database, applies pragmas and pending migrations. */
export function openDatabase(file: string): AppDatabase {
  const sqlite = new Database(file)
  try {
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('synchronous = NORMAL')
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')
    runMigrations(sqlite)
  } catch (error) {
    sqlite.close()
    throw error
  }
  return drizzle({ client: sqlite, schema })
}
