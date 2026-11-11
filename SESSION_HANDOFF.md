# Session handoff: 2026-11-11

Project: Edikte. Branch: `codex/listing-completeness-prices`, based on `main` at `2db2afb`. The requested price fixes and verification of older active listings are complete. The user had no example links. The fixes are committed locally as `1525f78` (`fix(scraper): recover published prices and verify older listings`). They have not been pushed or released. The installed app and real user-data folder have not been opened or changed.

## Completed

- Fixed complete currency-amount extraction, including grouped spaces and no-break spaces, currency before or after the amount, Euro/EUR/€, whole-euro suffixes and sentence punctuation. Negative or malformed amounts cannot turn into positive fragments.
- Kept winning-bid extraction anchored to the amount immediately after its phrase.
- Added written-bid minimum-offer and deposit extraction from explicit statements in current top-level paragraphs. Labeled fields take precedence. Nested historical notices and unrelated amounts are excluded. No appraised value is inferred.
- Raised auction parser version to 3 and insolvency parser version to 2, so existing records are reparsed on the next sync.
- Upgraded the pagination regression to use the real parser, sync engine, SQLite store and default listing query. A notice published on 2023-01-17 appears on page 2, persists and remains visible as on_offer.
- Extended opt-in live verification to compare discovered and stored counts, default visibility, oldest publication dates and stored/displayed prices.
- Independent plan and code review completed. Two punctuation regressions found during review were fixed and rechecked through the actual modules. No remaining actionable findings.

## Evidence and interpretation

A public [written-bid notice](https://edikte.justiz.gv.at/edikte/ex/exedi3.nsf/alldoc/19a397258aeb6943c1258e6d002b003e!OpenDocument) states a minimum offer of EUR 523,500 and deposit of EUR 69,800 in prose. Both fields were null before the fix. Re-parsing the cached real page with the updated parser returned 523500 and 69800; its appraised value remains null.

A sequential, rate-limited sample of ten insolvency notices found seven correctly parsed prices and three genuinely empty values, with no alternative price in those descriptions. Examples with no published value: [168705](https://justizonline.gv.at/jop/web/ediktsdatei/suche/168705), [168494](https://justizonline.gv.at/jop/web/ediktsdatei/suche/168494) and [31005](https://justizonline.gv.at/jop/web/ediktsdatei/suche/31005). Those values must remain unknown.

A supplementary audit sampled twelve evenly spaced positions from 101 through 200, with publications from August 2025 through June 2026. Three prices parsed correctly; nine published value fields were genuinely empty, without alternative price headings or explicit prices in their descriptions. No nonempty price field was missed. Examples of empty values: [164642](https://justizonline.gv.at/jop/web/ediktsdatei/suche/164642), [164086](https://justizonline.gv.at/jop/web/ediktsdatei/suche/164086), [39988](https://justizonline.gv.at/jop/web/ediktsdatei/suche/39988) and [37255](https://justizonline.gv.at/jop/web/ediktsdatei/suche/37255). These 22 sampled notices support source omissions as an explanation for remaining blanks; they do not individually audit all 126 empty values in the full sync. The supplementary audit used thirteen logical requests and seventeen attempts under the same rate limit and retry policy. No raw files were retained, and all live requests have stopped.

No publication-age cutoff defect was demonstrated. The current insolvency query sends no date filter and includes all API pages. A public API probe returned 220 Vienna records with incompleteResult=false; the oldest was published on 2023-01-17, and sampled March 2024 notices were still discoverable with prices. Initial/full court searches have no publication cutoff; daily full sweeps and within-day incremental retention are covered by existing tests. Default listing filters have no date bound. Do not claim to have removed an age restriction that was not present.

## Key files changed

- `src/main/scraper/site-text.ts`, `detail.ts`, `insolvency/detail.ts`: shared currency parsing and explicit written-bid values.
- `src/main/scraper/parser-version.ts`, `insolvency/parser-version.ts`: refresh existing stored values.
- `tests/scraper/detail.test.ts`, `insolvency/detail.test.ts`: price regressions.
- `tests/scraper/insolvency/site.test.ts`: paginated old-notice persistence and default visibility.
- `tests/scraper/insolvency/live.test.ts`: full live completeness and price projection assertions.

## Verification state

At commit `1525f78`, after all review fixes:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run format:check`: passed.
- `npm test`: 781 passed, 2 opt-in tests skipped (71 passed suites, 2 skipped).
- `npm run test:e2e`: built successfully; Electron smoke test passed using isolated temporary data and offline mode.
- `git diff --check`: passed.
- Focused parser/sync checks: 100 passed. Twelve regression failures were demonstrated before the original fix; review reproductions were checked again after the punctuation fixes.

Full live verification passed at the same commit in 1126.66 seconds (about 18 minutes 47 seconds). Both sources finished with status `ok`; one final idle event was emitted. Command:

```sh
EDIKTE_LIVE=1 npx vitest run tests/scraper/insolvency/live.test.ts --reporter=verbose --silent=false
```

| Source           | Discovered / fetched / stored | Default-visible listings | Oldest stored / visible publication | Visible with / without a price |
| ---------------- | ----------------------------- | ------------------------ | ----------------------------------- | ------------------------------ |
| Court auctions   | 158 / 158 / 158               | 111                      | 2026-09-07 / 2026-09-08             | 109 / 2                        |
| Insolvency sales | 220 / 220 / 220               | 220                      | 2023-01-17 / 2023-01-17             | 94 / 126                       |

Court counts differ after case grouping and default status filtering. Every insolvency notice, including the oldest, remained visible. Stored and displayed appraised/minimum values matched. Neither source removed records in this fresh sync.

The shared default client sent 280 court requests and 271 insolvency API attempts. Court headers had a median of 67 ms and p95 of 229 ms, with no aborted requests or HTTP errors. Insolvency headers had a median of 112 ms and p95 of 10002 ms; 48 attempts timed out and were retried, with no HTTP errors. Three sample PDFs downloaded successfully: 124830, 125666 and 158303 bytes. Downloads took four request attempts, including one timeout retry.

The test used a fresh temporary Vienna database and one request per second. Its temporary database and downloads were removed; a subsequent check found no remaining test directory. An earlier run was deliberately stopped after review found punctuation bugs; it exited 130 and its owned temporary database directory was also removed. The successful run used the final reviewed parser.

## Remaining work

No implementation or verification work remains for this goal. The final audit checked the price fixes against regressions and the real written-bid notice, existing-record refresh against parser-version upgrade coverage, and listing completeness against paginated persistence tests and the full live count/oldest-date assertions. All required local checks and the live test passed at `1525f78`.

The remaining deployment step is to build or release the updated app if requested. Once the updated app is used, the next sync reparses stored listings through the raised parser versions. The current installed/released version does not contain this local commit.

No release or install is part of this fix request. Existing version 0.2.0 release context is preserved in the previous handoff commit `2db2afb`. No real-user migration or live AI request has run.
