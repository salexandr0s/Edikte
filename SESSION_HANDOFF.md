# Session handoff: 2026-11-10

Project: Edikte, the Electron desktop app for Austrian court auctions and real-estate sales in insolvency proceedings. The feature is merged into `main` through [PR #1](https://github.com/salexandr0s/Edikte/pull/1), merge commit `b720e2cbfbdb6002550c7053226805f66017dd15`. [Version 0.2.0](https://github.com/salexandr0s/Edikte/releases/tag/v0.2.0) is public and marked latest.

The approved plan is `~/.claude/plans/edikte-insolvency-sales.md` (revision 2). Its progress file is `~/.claude/plans/edikte-insolvency-sales-progress.md`. The feature and all four recommended improvements are complete. The user approved items 1–4, including stale-analysis handling, on 2026-11-10, then authorized push, PR, merge, downloadable releases and cleanup. See the [feature review](docs/insolvency-sales-review.md) and [release notes](docs/releases/v0.2.0.md).

## Completed

Recovered Claude's clean final contract commit, `c5a40ee`, and created a Codex goal to finish the feature, verification, review, documentation and approved improvements.

| Commit    | Work                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1d0a377` | Source-scoped stores and geocoding, document retirement/restoration, active-report selection, retention, preserved starred/noted removals and legacy saved filters    |
| `7a0e835` | Shared sync engine, auction and insolvency strategies, record builder, sequential multi-source service/scheduling, unreadable-file guard and opt-in live verification |
| `d6970e7` | Source-specific analysis prompts and versions, and the actual report IDs in completed analysis evidence                                                               |
| `c900595` | Source-aware list/map/detail/settings/first-run UI, disabled-source recovery, batch query guards, paired copy and e2e heading updates                                 |
| `4aad949` | Feature verification, review and screenshots                                                                                                                          |
| `bc21197` | Consistent SQLite backup before pending migrations, with failure before DDL and migration-ledger writes                                                               |
| `a729fe6` | Return focus after programmatic dialogs and map-card Escape/Close                                                                                                     |
| `2aaf01f` | Current-report hash provenance, stale-result UI, cached area repair and guarded legacy migration 0006                                                                 |
| `74d85d8` | Version 0.2.0 package preparation and release notes                                                                                                                   |
| `b720e2c` | Merged feature PR #1 into `main`; release tag `v0.2.0`                                                                                                                |

The auction system prompt still has version 2 and its previous SHA-256. The insolvency prompt uses version 1. Queued analysis records now save the report actually read, even when sync replaced the report while the job waited.

An unreadable file list degrades an insolvency run without changing stored records. Valid empty lists retire their old document links. Foreign document URLs still follow the skip-and-count rule. Cancellation applies the existing retry delay to the entire pass, so auto sync does not immediately run a remaining source.

German and English UI copy refers to the combined list as Objekte/Listings. Insolvency sales use publication dates and the notice value as Schätzwert. The detail shows administrator/deputy contacts and description; further URLs remain plain text. At least one source must stay enabled.

## Release and cleanup

Version 0.2.0 was published on 2026-11-10 at 19:41:55 UTC (20:41:55 CET). Its six assets are two macOS DMGs and two ZIPs (Apple silicon and Intel), the Windows x64 installer, and `SHA256SUMS.txt`. All six uploaded assets have positive byte counts. The checksum file's hash matches its GitHub asset digest, and the five package hashes in it match GitHub's package asset digests.

The [release workflow](https://github.com/salexandr0s/Edikte/actions/runs/42886436068) finished with all five jobs successful. It checked the Mac packages natively on both architectures and installed and checked the Windows x64 installer. [PR CI](https://github.com/salexandr0s/Edikte/actions/runs/42885971254) and [main CI](https://github.com/salexandr0s/Edikte/actions/runs/42886400222) also passed.

Only `main` remains locally and remotely; the merged feature branch was deleted. Generated `out/` and `test-results/` were moved to the Trash. The mock renderer preview was closed and its development server stopped. The real user-data folder remains untouched, and the local application was not replaced or installed, as the user requested.

Six duplicate Actions package artifacts were deleted from the successful [0.2.0](https://github.com/salexandr0s/Edikte/actions/runs/42886436068) and [0.1.0](https://github.com/salexandr0s/Edikte/actions/runs/42209782702) release runs. Published releases, tags, download assets and workflow logs were retained.

## Verification state

- Both-project typecheck, ESLint and Prettier passed after all approved improvements.
- Unit tests: 752 passed, two opt-in tests skipped.
- Built Electron smoke test: passed after all approved improvements and the final migration safeguard. It used a temporary user-data folder and offline mode.
- Browser checks: mock renderer, both languages, light/dark views, 960/1280/1440 CSS pixel widths; source switch/sort/date behavior; rich and sparse sale detail; map pins and a sale card; source settings; saved-filter recovery when its source is disabled; keyboard operation. Filter dialog footer remained accessible at 960 × 600 and Escape returned focus to its trigger.
- Batch actions now require the page to answer the current query. The normal mock response was too fast to observe the loading interval reliably; the identity guard and handler guard were inspected in code.
- Browser map initially failed because a shared Vite optimizer cache served HTTP 504 for Leaflet. `vite.renderer.config.ts` now uses its own cache directory. The map and real basemap tiles loaded after restarting the development server.
- Independent backend review ran 202 focused tests across 20 suites and found two concrete report-integrity defects, both fixed and covered by regressions.
- README screenshots were regenerated with the existing script and all twelve images were inspected. They show made-up mock data and the new source controls.
- Improvement review found no remaining actionable backend or UI findings. Regressions cover malformed legacy IDs, stale report areas/risks/filter counts, changed-byte extraction invalidation, cached local-estimate recovery and unsafe legacy migration backfills. The backup test proves committed WAL changes appear in the standalone snapshot and that backup failure leaves schema, ledger and data untouched.
- Browser improvement checks covered saved-filter, fill, API-key and analysis dialog focus; map Escape and Close from inside a selected card; a plan with two downloads plus one cached read; local area recovery while old AI history stays stale; and the warning in both languages/themes at the 960-pixel minimum width. Provider controls used the mock bridge only.
- Live verification passed in 1028.06 seconds (about 17 minutes): a fresh temporary Vienna database, both sources, one shared default client at one request per second. Both sources finished with status `ok`; the service emitted one final idle state and all three sample PDFs downloaded with positive byte counts. Court auctions had 154 listed/fetched/changed, zero removed and 274 requests. Vitest discarded captured logs for the passing test, so exact insolvency counts, full-run header percentiles and individual byte counts are unavailable. The temporary directory and downloads were removed. This run loaded the code before the unreadable-file guard; focused tests cover that guard at the committed revision.
- A separate three-page insolvency search probe returned HTTP 200 in all three requests, with response headers after 301/135/132 ms and no timeouts. Pages held 100/100/20 readable rows, total 220, `incomplete=false`, no skipped rows. It used the same default client and one-request-per-second queue; the 10-second API timeout stays unchanged. These measurements cover list headers, not full-run retries. The temporary probe test was removed.

The real user-data folder has not been opened or migrated by this work. No live AI analysis has run.

## Key files

- `src/main/scraper/{sync,sync-site,auction-site}.ts` and `insolvency/{api,detail,search,edict-record,parser-version,site}.ts`.
- `src/main/db/{sync-store,listing-store,document-store,location-store,user-store,analysis-store}.ts`.
- `src/main/services/{sync/sync-service,geocode/geocode-service,analysis/analysis-service,analysis/analysis-job}.ts` and `src/main/ai/analysis/{prompt,pipeline,batch}.ts`.
- `src/renderer/src/features/{listings,detail,settings,first-run}/`, shared translation pairs, and `vite.renderer.config.ts`.
- `tests/scraper/insolvency/live.test.ts`: opt-in live sync and sample downloads, temporary data only, aggregate logs without record contents.
- `src/main/db/backup.ts`, migration `0006_analysis_document_hash.sql`, document/analysis stores and services: backups, current-report provenance and cached recovery.
- `docs/insolvency-sales-review.md`: verification, approved improvements and the deferred retention policy.

## Deferred work and known gaps

No implementation or release work remains under the approved scope. Version 0.2.0 is available from the public release linked above.

README and CLAUDE text, this handoff, the review, project memory and the twelve regenerated/inspected screenshots document the final behavior.

Expiry of downloads outside sync scope remains deferred until the user chooses a retention policy (review item 5). Source-switch counts remain optional. Neither was among the four approved improvements.

Remaining verification gaps: no live AI analysis; the Electron map-tile protocol and live Nominatim lookup were not exercised by the browser mock checks. Contrast review used visual inspection and existing semantic tokens, not numerical measurement of every state. Native Mac package and installed Windows startup checks are now covered by the successful release workflow.

## Resume commands

```sh
git status --short
git log --oneline -8
npm run typecheck
npm run lint
npm test
npm run format:check
npm run test:e2e
npm run dev:renderer
```

Reuse successful checks for unchanged code. A later deliberate live rerun is `EDIKTE_LIVE=1 npx vitest run tests/scraper/insolvency/live.test.ts --reporter=verbose --silent=false`; it makes hundreds of rate-limited requests and removes its own temporary database and downloads afterward. The verbose reporter preserves aggregate measurements that the default reporter discarded for a passing test.

## Decisions

- Preserve the existing feature commits and finish in logical commits. The feature branch was deleted after the approved merge.
- Use the shared source contracts from `c5a40ee`. `current.source` identifies the active sync run; `lastRuns` contains the newest finished run of each enabled source.
- Preserve debtor-field exclusions, including old/new change-log values and free-text history notes. Store the administrator contacts needed for offers.
- Preserve explicit sources in old saved filters. Recover a disabled-source selection through a visible action, without rewriting the saved filter.
- Never analyse a retired report merely because it has a lower document ID. Preserve downloaded retired files for viewing and record the actual analysed report in evidence.
- Current analysis and local-estimate values require the active report ID and matching known byte hash. Unknown legacy provenance stays stale; history and evidence remain readable. Migration backfills only safe extraction that predates the result, invalidating unsafe cache readiness before the backfill. No automatic AI refresh.
- Preserve the last known hash when cache files are evicted. Changed bytes invalidate extracted pages atomically; identical bytes can reuse them. Explicit area fill can repair cached estimates or interrupted extraction without another download.
- Keep pre-migration SQLite snapshots in `migration-backups`; backup failure aborts before any schema or ledger mutation. Backups have no automatic expiry.
- The user authorized push, PR, merge, release and cleanup. The local app was left in place; testing and release checks used isolated temporary user-data folders.
