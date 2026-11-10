import Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { bundledMigrations, runMigrations } from '../../src/main/db/migrate'

it('backfills report hashes only when the stored extraction predates the same-edict result', () => {
  const sqlite = new Database(':memory:')
  const before = '2026-11-01T08:00:00.000Z'
  const at = '2026-11-02T08:00:00.000Z'
  const after = '2026-11-03T08:00:00.000Z'
  try {
    sqlite.pragma('foreign_keys = ON')
    runMigrations(
      sqlite,
      bundledMigrations().filter((migration) => migration.tag < '0006'),
    )
    const edict = sqlite.prepare(`INSERT INTO edicts (
      id, case_key, notice_type, status, url, property_type, title, raw_labels,
      content_hash, parser_version, first_seen_at, last_seen_at, fetched_at
    ) VALUES (?, ?, 'versteigerung', 'upcoming', 'https://example.invalid', 'apartment',
      'Musterwohnung', '{}', 'content', 1, ?, ?, ?)`)
    for (const id of ['a', 'b']) edict.run(id, `case-${id}`, before, before, before)
    const document = sqlite.prepare(`INSERT INTO documents (
      id, edict_id, kind, title, file_name, url, sha256, downloaded_at, created_at
    ) VALUES (?, ?, 'langgutachten', 'Gutachten', 'report.pdf', ?, ?, ?, ?)`)
    document.run(1, 'a', 'https://example.invalid/1', 'hash-before', before, before)
    document.run(2, 'a', 'https://example.invalid/2', 'hash-after', after, before)
    document.run(3, 'b', 'https://example.invalid/3', 'hash-other-edict', before, before)
    document.run(4, 'a', 'https://example.invalid/4', null, before, before)
    document.run(5, 'a', 'https://example.invalid/5', 'hash-no-time', null, before)
    sqlite.exec('UPDATE documents SET extracted_at = downloaded_at, page_count = 1')
    const analysis = sqlite.prepare(`INSERT INTO analyses (
      id, edict_id, provider, model, prompt_version, schema_version, status,
      document_ids, started_at, finished_at, created_at
    ) VALUES (?, 'a', 'claude-cli', 'test', 2, 1, ?, ?, ?, ?, ?)`)
    analysis.run(1, 'done', '[1]', at, after, after)
    analysis.run(2, 'done', '[1]', null, at, after)
    analysis.run(3, 'done', '[1]', null, null, at)
    analysis.run(4, 'done', '[2]', at, at, at)
    analysis.run(5, 'done', '[3]', at, at, at)
    analysis.run(6, 'done', '[4]', at, at, at)
    analysis.run(7, 'done', '[5]', at, at, at)
    analysis.run(8, 'failed', '[1]', at, at, at)
    analysis.run(9, 'done', 'invalid JSON', at, at, at)
    analysis.run(10, 'done', '["1"]', at, at, at)
    const estimate = sqlite.prepare(`INSERT INTO area_estimates (
      id, edict_id, document_id, kind, sqm, page, quote, confidence, method, created_at
    ) VALUES (?, 'a', ?, 'nutzflaeche', 50, 1, 'Nutzfläche 50 m²', 'medium', 'test', ?)`)
    estimate.run(1, 1, at)
    estimate.run(2, 2, at)
    estimate.run(3, 3, at)

    expect(runMigrations(sqlite)).toEqual(['0006_analysis_document_hash'])
    expect(
      sqlite.prepare('SELECT document_sha256 AS hash FROM analyses ORDER BY id').all(),
    ).toEqual([
      { hash: 'hash-before' },
      { hash: 'hash-before' },
      { hash: 'hash-before' },
      ...Array.from({ length: 7 }, () => ({ hash: null })),
    ])
    expect(
      sqlite.prepare('SELECT document_sha256 AS hash FROM area_estimates ORDER BY id').all(),
    ).toEqual([{ hash: 'hash-before' }, { hash: null }, { hash: null }])
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    sqlite.prepare('UPDATE documents SET sha256 = ? WHERE id = 1').run('later-download')
    expect(runMigrations(sqlite)).toEqual([])
    expect(
      sqlite.prepare('SELECT document_sha256 AS hash FROM analyses WHERE id = 1').get(),
    ).toEqual({ hash: 'hash-before' })
  } finally {
    sqlite.close()
  }
})

it('invalidates unsafe legacy extraction without assigning its new hash to results from old pages', () => {
  const sqlite = new Database(':memory:')
  const before = '2026-11-01T08:00:00.000Z'
  const at = '2026-11-02T08:00:00.000Z'
  const after = '2026-11-03T08:00:00.000Z'
  try {
    sqlite.pragma('foreign_keys = ON')
    runMigrations(
      sqlite,
      bundledMigrations().filter((migration) => migration.tag < '0006'),
    )
    sqlite
      .prepare(
        `INSERT INTO edicts (
      id, case_key, notice_type, status, url, property_type, title, raw_labels,
      content_hash, parser_version, first_seen_at, last_seen_at, fetched_at
    ) VALUES ('a', 'case-a', 'versteigerung', 'upcoming', 'https://example.invalid', 'apartment',
      'Musterwohnung', '{}', 'content', 1, ?, ?, ?)`,
      )
      .run(before, before, before)
    const document = sqlite.prepare(`INSERT INTO documents (
      id, edict_id, kind, title, file_name, url, sha256, downloaded_at,
      extracted_at, page_count, extract_error, created_at
    ) VALUES (?, 'a', 'langgutachten', 'Gutachten', 'report.pdf', ?, ?, ?, ?, ?, ?, ?)`)
    const cacheRows = [
      { hash: 'safe', downloaded: before, extracted: before, pages: 1, error: null },
      // Interrupted replacement: new hash and download, but old extraction and page text.
      { hash: 'replacement', downloaded: at, extracted: before, pages: 1, error: null },
      { hash: 'missing-download', downloaded: null, extracted: before, pages: 1, error: null },
      { hash: 'invalid-download', downloaded: 'invalid', extracted: before, pages: 1, error: null },
      { hash: 'missing-extraction', downloaded: before, extracted: null, pages: 1, error: null },
      {
        hash: 'invalid-extraction',
        downloaded: before,
        extracted: 'invalid',
        pages: 1,
        error: null,
      },
      { hash: null, downloaded: before, extracted: before, pages: 1, error: null },
      {
        hash: 'extraction-error',
        downloaded: before,
        extracted: before,
        pages: 1,
        error: 'Failed',
      },
      { hash: 'unknown-pages', downloaded: before, extracted: before, pages: null, error: null },
      // Safe current cache, extracted only after these historical results were created.
      { hash: 'later-extraction', downloaded: before, extracted: after, pages: 1, error: null },
    ]
    const page = sqlite.prepare(`INSERT INTO document_pages
      (document_id, page_number, has_text, text) VALUES (?, 1, 1, 'Old extracted page')`)
    const analysis = sqlite.prepare(`INSERT INTO analyses (
      id, edict_id, provider, model, prompt_version, schema_version, status,
      document_ids, started_at, finished_at, created_at
    ) VALUES (?, 'a', 'claude-cli', 'test', 2, 1, 'done', ?, ?, ?, ?)`)
    const estimate = sqlite.prepare(`INSERT INTO area_estimates (
      id, edict_id, document_id, kind, sqm, page, quote, confidence, method, created_at
    ) VALUES (?, 'a', ?, 'nutzflaeche', 50, 1, 'Nutzfläche 50 m²', 'medium', 'test', ?)`)
    for (const [index, cache] of cacheRows.entries()) {
      const id = index + 1
      const resultAt = id === cacheRows.length ? at : after
      document.run(
        id,
        `https://example.invalid/${id}`,
        cache.hash,
        cache.downloaded,
        cache.extracted,
        cache.pages,
        cache.error,
        before,
      )
      page.run(id)
      analysis.run(id, JSON.stringify([id]), resultAt, resultAt, resultAt)
      estimate.run(id, id, resultAt)
    }

    runMigrations(sqlite)

    const hashes = [{ hash: 'safe' }, ...cacheRows.slice(1).map(() => ({ hash: null }))]
    expect(
      sqlite.prepare('SELECT document_sha256 AS hash FROM analyses ORDER BY id').all(),
    ).toEqual(hashes)
    expect(
      sqlite.prepare('SELECT document_sha256 AS hash FROM area_estimates ORDER BY id').all(),
    ).toEqual(hashes)
    expect(
      sqlite
        .prepare(
          `SELECT extracted_at AS extracted, page_count AS pages, extract_error AS error
      FROM documents ORDER BY id`,
        )
        .all(),
    ).toEqual([
      { extracted: before, pages: 1, error: null },
      ...cacheRows.slice(1, -1).map(() => ({ extracted: null, pages: null, error: null })),
      { extracted: after, pages: 1, error: null },
    ])
    expect(sqlite.prepare('SELECT count(*) AS count FROM document_pages').get()).toEqual({
      count: cacheRows.length,
    })
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  } finally {
    sqlite.close()
  }
})
