# Session handoff: 2026-11-10

Project: Edikte, the Electron desktop app for Austrian court auctions and real-estate sales in insolvency proceedings. Branch `feat/insolvency-sales`, based on `47ef51a`. Work remains local; nothing has been pushed, merged or released.

The approved plan is `~/.claude/plans/edikte-insolvency-sales.md` (revision 2). Its progress file is `~/.claude/plans/edikte-insolvency-sales-progress.md`. The feature was already approved through implementation, verification and review. The improvement pass has a separate approval gate.

## Completed

Recovered Claude's clean final contract commit, `c5a40ee`, and created an active Codex goal to finish the feature, verification, review, documentation and approved improvements.

| Commit    | Work                                                                                                                                                                  |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1d0a377` | Source-scoped stores and geocoding, document retirement/restoration, active-report selection, retention, preserved starred/noted removals and legacy saved filters    |
| `7a0e835` | Shared sync engine, auction and insolvency strategies, record builder, sequential multi-source service/scheduling, unreadable-file guard and opt-in live verification |
| `d6970e7` | Source-specific analysis prompts and versions, and the actual report IDs in completed analysis evidence                                                               |
| `c900595` | Source-aware list/map/detail/settings/first-run UI, disabled-source recovery, batch query guards, paired copy and e2e heading updates                                 |

The auction system prompt still has version 2 and its previous SHA-256. The insolvency prompt uses version 1. Queued analysis records now save the report actually read, even when sync replaced the report while the job waited.

An unreadable file list degrades an insolvency run without changing stored records. Valid empty lists retire their old document links. Foreign document URLs still follow the skip-and-count rule. Cancellation applies the existing retry delay to the entire pass, so auto sync does not immediately run a remaining source.

German and English UI copy refers to the combined list as Objekte/Listings. Insolvency sales use publication dates and the notice value as Schätzwert. The detail shows administrator/deputy contacts and description; further URLs remain plain text. At least one source must stay enabled.

## Verification state

- Both-project typecheck, ESLint and Prettier passed after the review fixes.
- Unit tests: 737 passed, two opt-in tests skipped.
- Built Electron smoke test: passed after the review fixes. It used a temporary user-data folder and offline mode.
- Browser checks: mock renderer, both languages, light/dark views, 960/1280/1440 CSS pixel widths; source switch/sort/date behavior; rich and sparse sale detail; map pins and a sale card; source settings; saved-filter recovery when its source is disabled; keyboard operation. Filter dialog footer remained accessible at 960 × 600 and Escape returned focus to its trigger.
- Batch actions now require the page to answer the current query. The normal mock response was too fast to observe the loading interval reliably; the identity guard and handler guard were inspected in code.
- Browser map initially failed because a shared Vite optimizer cache served HTTP 504 for Leaflet. `vite.renderer.config.ts` now uses its own cache directory. The map and real basemap tiles loaded after restarting the development server.
- Independent backend review ran 202 focused tests across 20 suites and found two concrete report-integrity defects, both fixed and covered by regressions.
- README screenshots were regenerated with the existing script and all twelve images were inspected. They show made-up mock data and the new source controls.
- Live verification passed in 1028.06 seconds (about 17 minutes): a fresh temporary Vienna database, both sources, one shared default client at one request per second. Both sources finished with status `ok`; the service emitted one final idle state and all three sample PDFs downloaded with positive byte counts. Court auctions had 154 listed/fetched/changed, zero removed and 274 requests. Vitest discarded captured logs for the passing test, so exact insolvency counts, full-run header percentiles and individual byte counts are unavailable. The temporary directory and downloads were removed. This run loaded the code before the unreadable-file guard; focused tests cover that guard at the committed revision.
- A separate three-page insolvency search probe returned HTTP 200 in all three requests, with response headers after 301/135/132 ms and no timeouts. Pages held 100/100/20 readable rows, total 220, `incomplete=false`, no skipped rows. It used the same default client and one-request-per-second queue; the 10-second API timeout stays unchanged. These measurements cover list headers, not full-run retries. The temporary probe test was removed.

The real user-data folder has not been opened or migrated by this work. No live AI analysis has run.

## Key files

- `src/main/scraper/{sync,sync-site,auction-site}.ts` and `insolvency/{api,detail,search,edict-record,parser-version,site}.ts`.
- `src/main/db/{sync-store,listing-store,document-store,location-store,user-store,analysis-store}.ts`.
- `src/main/services/{sync/sync-service,geocode/geocode-service,analysis/analysis-service,analysis/analysis-job}.ts` and `src/main/ai/analysis/{prompt,pipeline,batch}.ts`.
- `src/renderer/src/features/{listings,detail,settings,first-run}/`, shared translation pairs, and `vite.renderer.config.ts`.
- `tests/scraper/insolvency/live.test.ts`: opt-in live sync and sample downloads, temporary data only, aggregate logs without record contents.
- `docs/insolvency-sales-review.md`: verification, fixed findings and ranked improvements for approval.

## Remaining work and known gaps

Await the user's improvement choice. An async question offered migration backups plus dialog/map focus fixes (recommended), all four recommended fixes including stale-analysis handling, or deferring all improvements. No answer has arrived and no improvement changes have been applied. The Codex goal remains active for this choice and the approved work that follows.

README and CLAUDE text, this handoff, the review and the twelve inspected screenshots complete the feature documentation. Reuse the images if approved changes do not alter their visible content.

The review recommends a consistent pre-migration database backup, a stale-analysis marker when its report is retired/replaced, focus return for programmatically opened dialogs, and marker focus after closing a map card with Escape. Expiry of downloads outside sync scope needs a policy choice first. The saved plan explicitly requires approval before the improvement pass changes anything.

Previously recorded gaps remain: Electron map-tile protocol and live Nominatim lookup were not exercised by the browser mock checks; no live Codex analysis, Windows run, packaged-app check or release was part of this work. Contrast review used visual inspection and existing semantic tokens, not numerical measurement of every state.

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

- Keep the existing feature branch and prior commits; commit logical units locally.
- Use the shared source contracts from `c5a40ee`. `current.source` identifies the active sync run; `lastRuns` contains the newest finished run of each enabled source.
- Preserve debtor-field exclusions, including old/new change-log values and free-text history notes. Store the administrator contacts needed for offers.
- Preserve explicit sources in old saved filters. Recover a disabled-source selection through a visible action, without rewriting the saved filter.
- Never analyse a retired report merely because it has a lower document ID. Preserve downloaded retired files for viewing and record the actual analysed report in evidence.
- Push, PR, merge and release still require separate approval.
