import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { bundledMigrations, runMigrations } from '../../src/main/db/migrate'

it('baselines existing cases, including removed notices, without enabling alerts or changing saved state', () => {
  const sqlite = new Database(':memory:')
  try {
    sqlite.pragma('foreign_keys = ON')
    runMigrations(
      sqlite,
      bundledMigrations().filter((migration) => migration.tag < '0007'),
    )
    const first = '2026-09-01T08:00:00.000Z'
    const later = '2026-11-01T08:00:00.000Z'
    const insert = sqlite.prepare(`INSERT INTO edicts (
      id, case_key, notice_type, status, url, property_type, title, raw_labels,
      content_hash, parser_version, first_seen_at, last_seen_at, fetched_at, removed_at
    ) VALUES (?, 'same-case', 'versteigerung', 'upcoming', 'https://example.invalid',
      'apartment', 'Musterwohnung', '{}', 'content', 1, ?, ?, ?, ?)`)
    insert.run('a', first, first, first, later)
    insert.run('b', later, later, later, null)
    sqlite
      .prepare(
        `INSERT INTO saved_filters (name, query, created_at, updated_at)
      VALUES ('My search', '{}', ?, ?)`,
      )
      .run(first, first)
    sqlite
      .prepare(
        `INSERT INTO user_state (case_key, starred, hidden, notes, updated_at)
      VALUES ('same-case', 1, 0, 'Keep this note', ?)`,
      )
      .run(first)

    expect(runMigrations(sqlite)).toEqual(['0007_saved_search_notifications'])
    const discoveries = sqlite
      .prepare(
        `SELECT case_key, first_seen_at, kind, snapshot
      FROM listing_discoveries`,
      )
      .all()
    expect(discoveries).toEqual([
      { case_key: 'same-case', first_seen_at: first, kind: 'baseline', snapshot: null },
    ])
    expect(sqlite.prepare('SELECT count(*) AS count FROM filter_alerts').get()).toEqual({
      count: 0,
    })
    expect(sqlite.prepare('SELECT count(*) AS count FROM notification_batches').get()).toEqual({
      count: 0,
    })
    expect(sqlite.prepare('SELECT name, query FROM saved_filters').get()).toEqual({
      name: 'My search',
      query: '{}',
    })
    expect(sqlite.prepare('SELECT starred, notes FROM user_state').get()).toEqual({
      starred: 1,
      notes: 'Keep this note',
    })
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    expect(runMigrations(sqlite)).toEqual([])
  } finally {
    sqlite.close()
  }
})
