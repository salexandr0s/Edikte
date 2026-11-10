# Edikte

Desktop app for macOS and Windows that lists court auctions from edikte.justiz.gv.at and real-estate sales in insolvency proceedings from justizonline.gv.at. It downloads the appraisal reports (Gutachten) on demand and analyses them with an AI provider the user signs in to. Both sources share the list, map, saved filters and document tools; users choose the sources and Bundesländer in Settings. The UI is German and English. It is built for personal use; a wider audience changes the legal position (see Data and legal).

Rules here override the workspace `~/GitHub/CLAUDE.md` where they conflict.

## Commands

| Command                                | What it does                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run dev`                          | App with hot reload                                                                       |
| `npm run dev:renderer`                 | Renderer only, in a browser, against the mock bridge (made-up data)                       |
| `npm run typecheck`                    | Node project (main, preload, shared, tests) and web project (renderer, shared)            |
| `npm run lint`, `npm run format:check` | ESLint and Prettier                                                                       |
| `npm test`                             | Vitest unit tests (`tests/**/*.test.ts`)                                                  |
| `npm run test:e2e`                     | Builds, then runs the Playwright Electron smoke test                                      |
| `npm run db:generate`                  | Writes a migration after a change to `src/main/db/schema.ts`                              |
| `npm run icons`                        | Renders `build/icon.icns`, `build/icon.ico` and `build/icon.png` from `build/icon.svg`    |
| `npm run screenshots`                  | Renders the README screenshots into `docs/screenshots/` while `npm run dev:renderer` runs |

Before a commit: typecheck, lint, unit tests and `format:check`. Run `test:e2e` as well when main, preload, the build config or the app shell change.

## Where code lives

| Folder          | Contents                                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/shared/`   | Contracts used by every process: domain types, IPC channels and Zod schemas, analysis schema, number and area parsing, listing filter                        |
| `src/main/`     | Electron main: `db/` (Drizzle schema, migrations, stores), `ipc/` (router and handlers), `ai/` (providers and analysis), `scraper/`, `documents/`, `secure/` |
| `src/preload/`  | Typed `contextBridge` API (`index.ts`) and the preload of the hidden PDF raster window                                                                       |
| `src/renderer/` | React app in `src/`, PDF raster page in `pdf-raster/`                                                                                                        |
| `tests/`        | Vitest suites by area, Playwright smoke test in `e2e/`                                                                                                       |

`src/shared/` is the contract between processes. Change a schema there and fix every consumer in the same commit. While several agents work in parallel, only the lead changes `src/shared/`, `package.json` and the lockfile; the others report what they need.

## Data and legal

- The ministry licenses re-use of the Ediktsdatei under the IWG. The app reads the public auction pages and the JSON API behind the public JustizOnline search for personal use only. Do not add bulk export, sharing or hosted features without revisiting that.
- The insolvency reader excludes the debtor's name, company-register number and address fields, including from `rawLabels`. It stores the administrator's and deputy's contact details and the property description. History entries keep only the date, operation and field name, without old/new values or free-text notes.
- Gutachten name the owners and contain land-register data. Downloaded files stay in the app's data folder. Committed fixtures must have names and addresses replaced. The immoradar HTML corpus stays outside this repo.
- Before the first analysis, the user confirms that report text goes to their AI provider (`consent_required`).
- The app never reads token files, other apps' keychain items or `*_API_KEY` environment variables. ChatGPT tokens and API keys live only in the safeStorage file. The renderer sees connection status and an account label, never a secret.
- The Claude CLI route runs the user's own `claude` binary under the user's account. Never present the app as Claude Code, and never send Claude subscription tokens from app code.

## Conventions

- Money: euros as plain numbers. Dates from the site: Vienna local time as `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`, never converted. App timestamps: ISO UTC. Court-auction IDs have 32 lowercase hex characters; insolvency-sale IDs are `mv-<JustizOnline record number>`. Shared patterns live in `src/shared/edict-id.ts`; the stored `source` column identifies the source.
- Scraping: one shared queue sends at most one request per second across edikte.justiz.gv.at and justizonline.gv.at, sequentially, with backoff and jitter on 403, 429 and 5xx and a descriptive User-Agent. Court auctions use HTML; insolvency sales use JSON under `/jop/service/edi/v1/`. Redirects stay on the request's original host. Sync state, parser versions and runs are separate for each source.
- Insolvency sales have no auction date or minimum bid. Their price and price per m² use the value in the notice (`schaetzwertEur`) under either price-basis setting. Analysis uses the prompt and prompt version for the listing's source.
- Completed analyses and local area estimates carry the hash of the report bytes they read. Current values require the active report ID and a matching known hash. Unknown legacy provenance is stale; history and evidence remain visible, but stale values do not affect filters, risk or price per m². Never start AI work to refresh them automatically. Explicit area fill can repair cached local estimates without network or AI work.
- Before pending migrations on an existing file database, save a consistent SQLite snapshot under `migration-backups` before changing the schema or ledger. Backup failure aborts the upgrade. Tests use temporary databases; backups are retained until the user removes them.
- HTTP from main and workers uses Node's global `fetch`, not Electron's `net`: it runs under Vitest without Electron and sends only the headers the code sets.
- Downloaded PDFs and HTML are untrusted. Parse PDFs in the utility process, never in main.
- Every IPC handler goes through `createIpcRouter` in `src/main/ipc/handle.ts`: sender check, then Zod parsing of request and response. Errors cross IPC as `AppError` codes, and the renderer shows `errors.<code>` from the translations.

## Interface

- Read `~/.claude/uiux-contract/` before UI work. The tokens are mapped to Tailwind in `src/renderer/src/styles/app.css`; use only those values.
- White text sits on `bg-accent-fill` (blue-700). Coloured text uses `text-accent-text`, `text-danger-text`, `text-warning-text` or `text-success-text`. The plain accent and danger colours fail WCAG AA as text colour and behind white text.
- Minimum window width is 960 px.
- Every string lives in a `de.json` and `en.json` pair with the same keys: shared strings in `src/renderer/src/i18n/`, each screen's own strings in `src/renderer/src/features/<screen>/i18n/`. `tests/i18n.test.ts` checks keys and placeholders, and that each top-level namespace sits in one file. Main reads the same files for its startup error dialog. German uses "Sie". English keeps the legal term on first mention, for example "Appraised value (Schätzwert)".
- Write copy under the avoid-ai-writing rules, and read German strings by hand.

## Tests

- Unit tests run in Node. They must not import renderer modules that touch `window` or `document`.
- The e2e test launches the built app with `EDIKTE_USER_DATA_DIR` set to a temp folder and `EDIKTE_OFFLINE=1`, so it neither syncs nor starts a CLI. No test may use the real data folder.
- Development and live checks also set `EDIKTE_USER_DATA_DIR` to a temp folder. The real database is migrated only when the user starts the new build with their own data folder.
- Packaged builds are checked with the self-check, not Playwright: the fuses switch off the Node inspector Playwright needs. Run the app binary with `EDIKTE_SMOKE_TEST=1` and `EDIKTE_USER_DATA_DIR=<temp folder>`. Exit code 0 means the renderer loaded its data from main; 1 means a failure, logged to stderr.
- Tests that call the live site or a live AI provider must be opt-in (`EDIKTE_LIVE=1`, `EDIKTE_LIVE_AI=<provider>`) and stay out of CI.

## Build notes

- TypeScript stays on 6.0.x: typescript-eslint 8.72 does not support TypeScript 7.
- The preload builds to CommonJS (`out/preload/index.cjs`) because sandboxed preloads cannot load ES modules.
- The mock bridge (`src/renderer/src/dev/mock-bridge.ts`) loads only when `import.meta.env.DEV` is true, so production builds leave it out.
- The CSP is added to the built HTML only; the dev server runs without it.
- better-sqlite3 13 is a Node-API addon: one binary loads in Node (Vitest) and in Electron, so there is no electron-rebuild step. Packaged builds still need the binary for the target architecture.
- `.npmrc` sets `save-exact`. Add dependencies with exact versions.
