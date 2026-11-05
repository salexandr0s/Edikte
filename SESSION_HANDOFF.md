# Session Handoff — 2026-11-05

Project: Edikte, an Electron desktop app (macOS, Windows) for the court auctions on edikte.justiz.gv.at. Private repo https://github.com/salexandr0s/Edikte. `main` is the only local branch and matches `origin/main`. This file is tracked since this session. It replaces the map-view handoff of the same day; that session's open points are carried below.

## Completed

### Data check: the app shows everything the site lists

Request: "it appears like we don't have enough data incoming". Result: no app defect, no code changed.

- The database holds one sync run (full, ok, started 2026-11-05 09:54 CET): 123 listed, 123 pages read, 0 errors, 0 unreadable rows. 123 edicts, all Vienna, 120 cases, none removed.
- The live Vienna search at 15:00 CET returned the same 123 IDs with the same notice mix (88 Versteigerung, 25 Meistbotsverteilung, 6 Zuschlag, 2 Entfall, 1 Verschiebung, 1 Schriftliche Anbote). ID diff against the database: 0 new, 0 gone.
- The Bundesland filter misses nothing: the unfiltered Austria-wide search (537 rows) has exactly 123 rows with a Vienna postcode.
- The site shrank. The plan notes of 4 Nov record 136 Vienna rows (98 Versteigerung) and 552 Austria-wide. The stored list has no auction before 11 Nov, so edicts of auctions already held drop off the site.
- Vienna publications: 6 on 3 Nov, 10 on 4 Nov, none by 15:00 on 5 Nov. Austria-wide, 20 edicts carry a 5 Nov date, so the site does publish. One Hernals edict changed on the site on 5 Nov; the incremental query `[DATBM]>=04.11.2026` lists it, so the next incremental run reads it again.
- The default list filter (upcoming and postponed) shows about 90 of the 120 cases; 28 sold or closed and 2 cancelled cases are hidden.
- The app was not running (last database write 10:19 CET), so nothing synced. While it runs, auto sync starts 6 h after the last settled run (15:57 CET for this one), for Vienna only, the scope chosen at setup. The other eight Bundesländer hold 414 edicts.
- The site's raw Domino views (`?ReadViewEntries`) answer HTTP 500, so the full-text search the app sends is the only count source.
- The database was last opened by the build before the map commits; migration `0004_edict_locations` applies at the next launch.

### Repo cleanup

- Every branch was already in `main`: `feat/initial-app` (fbb7bc9), `feat/map-view` (239a1e0), `origin/claude/keen-hamilton-27wvrh` (379e322) and `origin/feat/initial-app` are ancestors of f45e8f6. Nothing to merge.
- Deleted the two local branches. Removed a detached worktree that a spare session had left in a temp folder (at 0ddac7d, clean, no process in it).
- Moved `out/` (electron-vite output, 4.7 MB) and `dist/` (electron-builder output, 322 MB, with the mac-arm64 app built at 15:43) to the Trash. `build/` holds the tracked icons and stays.
- Committed this file. The remote branches `origin/feat/initial-app` and `origin/claude/keen-hamilton-27wvrh` are still on GitHub, both merged.

## Key Files Changed

- `SESSION_HANDOFF.md` (this file, now tracked). No source, test or config file changed.

## Verification State

- f45e8f6: GitHub CI run 42050243497 (push to `main`, 14:58 UTC) passed: typecheck, lint, format check, unit tests and the Playwright smoke test of the built app on Linux.
- This session: `npx prettier --check SESSION_HANDOFF.md` passes. No other check applies to a Markdown-only commit.
- Not checked: the packaged app and the map inside Electron (see the gaps).

## Remaining / Known Gaps

- The data check did not read every stored page for changes made on the site after 09:54. The one changed Hernals edict was found through the date query, and the incremental run does the same for all of them.
- Map view, from the map session:
  - Run `npm run dev` and look at the map with real data. The cluster threshold (`LABEL_GAP`) and the dark basemap filter were tuned on the mock's seven pins.
  - The pin card was not tried below 600 px of map height.
  - Clusters are rebuilt on every zoom change, which drops and recreates every marker. Fine for hundreds of pins, not measured beyond that.
  - The status chip's tooltip was not confirmed by hand.
- Carried over from earlier sessions:
  - Confirm that tiles arrive through `edikte-tile://` and that lookups reach Nominatim inside Electron.
  - Decide whether opening the map should ask once before addresses go to nominatim.openstreetmap.org. The first map open on a large list looks up one address per second.
  - `saved-filters.tsx`, `fill-areas.tsx`, `api-key-actions.tsx` and `analysis-gate.tsx` open without a `trigger`, so focus lands on the body when they close.
  - `--edk-modal-max-height` is untested on short windows.
  - Saving `dialog.tsx` or `toast.tsx` under the dev server throws "must be used inside …Provider" until reload.
  - The second user still needs collaborator access.
  - No live Codex analysis yet.
- Three mock renderer dev servers (`vite --config vite.renderer.config.ts`) from earlier sessions were still running at 16:20 CET and were left alone.

## Resume Commands

```bash
cd ~/GitHub/Edikte
git status && git log --oneline -6 && git branch -a
npm run typecheck && npm run lint && npm test && npm run format:check
npm run dev:renderer
```

The mock app starts with the setup steps (Language, AI providers, First sync); click Continue three times to reach the list, then the map icon next to the sort control.

## Decisions Made

- No code change for the data question: the smaller list is the site's own, and the app holds it row for row.
- The build folders went to the Trash, not through `rm -rf`: `~/.claude/settings.json` denies `rm -r`, `rm -rf` and `git clean -f`.
- The handoff is tracked from now on: the request was to commit every change, and most repos under `~/GitHub` track it.
- Remote branches stay: the request named local branches. Both are merged, so deleting them loses nothing.
- From the map session (12f0057 to d051fe1):
  - Leaflet's controls were replaced by the app's own `Button`, `Badge`, `Tooltip` and `Spinner`, not restyled, so Leaflet's CSS needs no overrides.
  - The pin card is content-sized in a left column so the map stays visible beside it; the chosen pin is panned out from under the column.
  - Dark mode keeps the CSS inversion of the tile pane, darkened to `brightness(0.8)` after comparing three variants.
  - No cluster plugin: a greedy screen-space grouping in `map-pins.ts`, about 40 lines, tested under Vitest.
  - Clusters live in render state derived from the zoom, and the fit logic works on the places, so regrouping never refits.
  - The tile layer is bounded to Austria instead of changing the failure heuristic.
  - The scale label builds its no-break space with `String.fromCharCode(0xa0)` because ESLint's `no-irregular-whitespace` rejects the character in a template literal.
  - The three map commits are separate so the grouping and the tile fix can be reverted on their own.
