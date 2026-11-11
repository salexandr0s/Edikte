# Session handoff: 2026-11-11

Project: Edikte. Branch: `codex/listing-completeness-prices`. This implementation starts from `37cb0a6`; the earlier price/completeness fixes remain in `1525f78`. The user approved and requested implementation of the saved-search notification and opening-dashboard plan. The installed app and real user-data folder were not opened or migrated. No release, push, or install was requested.

## Completed

- Dashboard is the startup screen after onboarding and on subsequent launches. It combines saved searches without duplicate cases, supports one-search selection, and shows matching/new/upcoming/starred counts, property previews, saved-search alert controls, recent digests, and source freshness.
- Added typed query/saved-search-union/notification result collections. Dashboard counts and drill-downs share the same resolver. Dashboard and Listings stay mounted; details return to the actual opener with selection and scroll retained.
- Added a transactional discovery journal with monotonic IDs, immutable first-discovery snapshots, silent legacy and per-source/region import baselines, and merge aliases for corrected case identities and old-key reissues.
- Added per-search after-sync/daily/weekly alerts, configurable Vienna wall time and weekday, desktop preferences, transactional cursors/candidates, restart catch-up, zero-count suppression, partial-source coverage, and delivery-time rechecks.
- Added immutable notification membership/history, unread state, pagination, desktop attempt/failure reporting, test delivery, persisted pending-open handoff, and desktop activation restoration. Windows has a stable AppUserModelID and toast CLSID; macOS cold-click identifiers are captured from the ready event before startup.
- Added alert configuration to shipped presets without changing their protected criteria. Pausing, semantic edits, scope changes, schedule-only edits, and deletion follow the approved baseline/history rules.
- Added German/English UI and native copy, browser mock support with made-up data, and README feature documentation.
- Fixed two shared controls exposed by the real Electron flow: switches now separate accessible labels from descriptions; select menus inside dialogs render above the modal overlay.
- Independent plan and implementation review completed. Confirmed native bootstrap issues were fixed and rechecked; no unresolved code review finding remains.

## Key files changed

- Contracts: `src/shared/notifications.ts`, `ipc.ts`, `ipc-channels.ts`.
- Persistence: `src/main/db/{schema,discovery-store,notification-store,collection-store,dashboard-store,listing-store,sync-store}.ts`; generated migration `0007_saved_search_notifications.sql` and metadata. Existing database backup-before-migration behavior remains active.
- Services: `src/main/services/notifications/` (scheduler, service, native transport, formatter, activation parsing), sync pass-settled hook, main bootstrap and validated IPC integration.
- Renderer: dashboard, notifications, and collections feature directories; app shell/context; preserved detail origins; saved-search menu; translations/resources; mock support; shared select/switch controls.
- Verification: focused discovery/dashboard/notification/migration/service/schedule/activation/mock tests; extended Electron smoke journey.

## Verification state

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run format:check`: passed.
- `npm test`: 805 passed, 2 opt-in live tests skipped, across 81 test files.
- `npm run test:e2e`: passed. Covers onboarding to dashboard, both languages, real persisted weekly alert configuration/time/weekday/desktop preference, notification empty state/unsupported transport, collection return navigation, and Listings navigation.
- Mock browser checks: English/German, light/dark, 960 px no horizontal overflow, selected-search preservation through detail navigation, fixed notification results, and no page errors.
- Packaged macOS arm64 build: produced in an isolated temporary output directory; code signature is ad hoc. Packaged self-check exited 0 with a temporary database and offline mode.
- Packaged native delivery: opened the isolated app through native UI, completed onboarding, and requested a test notification. UI reported an attempt. The Mac locked before a banner or click could be verified; no claim of confirmed native display is made.
- `git diff --check`: passed before handoff.
- No live scraping or AI request ran for this feature; tests and app checks used temporary data.

## Remaining / known gaps

- Confirm macOS notification banner and click behavior on an unlocked desktop with OS notifications allowed.
- Verify native display and historical/cold activation on an installed Windows build; this environment is macOS.
- No release, version bump, push, or installation was performed. Alerts default off for every saved search.
- Dashboard screenshot with made-up data: `/Users/nationalbank/.codex/visualizations/2026/11/11/01a1cb46-76b7-7dc0-98fc-1b30efc59458/edikte-dashboard.png`.

## Resume commands

```sh
cd /Users/nationalbank/GitHub/Edikte
git status --short
git log -3 --oneline
npm run typecheck
npm run lint
npm run format:check
npm test
npm run test:e2e
```

Reuse the successful checks for the same revision; rerun only those invalidated by further changes. Development or packaged checks must set `EDIKTE_USER_DATA_DIR` to a fresh temporary directory. `EDIKTE_OFFLINE=1` prevents automatic sync/provider detection. Automated Electron tests additionally set `EDIKTE_DISABLE_DESKTOP_NOTIFICATIONS=1`; native manual checks omit that variable. Packaged startup self-checks use `EDIKTE_SMOKE_TEST=1`, which disables native delivery.

## Decisions made

- New means newly committed property discovery, matched once using the discovery snapshot. Later price, area, analysis, or star changes do not introduce an old property as a new alert match. Missing information can prevent qualification; alerts never start AI or downloads.
- Discovery IDs determine processing progress; commit timestamps determine reporting periods. Source-page fetch times cannot lose a row across a digest cutoff.
- Initial imports and legacy data are baseline entries, excluded from new counts and alerts while included in total matching results.
- Schedules use Europe/Vienna wall time: nonexistent DST times move to the next valid minute, repeated times use the first occurrence. Missed periods combine into one catch-up digest per search.
- Delivery rechecks may discard pending candidates; published digests retain their original count, membership, and previews permanently, with current availability shown separately.
- Current app lifecycle is retained; no tray mode, external agent, email service, or server was added.
