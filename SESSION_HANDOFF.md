# Session Handoff — 2026-11-06

Project: Edikte, an Electron desktop app (macOS, Windows) for the court auctions on edikte.justiz.gv.at. Public repo https://github.com/salexandr0s/Edikte since 2026-11-06, rebuilt from a rewritten history; the previous repo is kept private as `salexandr0s/Edikte-archive`. `main` is the only local branch and matches `origin/main`. This file is tracked since this session. It replaces the map-view handoff of the same day; that session's open points are carried below.

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

- Every branch was already in `main`: `feat/initial-app` (62fb006), `feat/map-view` (ee8b9e4), `origin/claude/keen-hamilton-27wvrh` (31e9aca) and `origin/feat/initial-app` are ancestors of 0d146d9. Nothing to merge.
- Deleted the two local branches. Removed a detached worktree that a spare session had left in a temp folder (at 263362e, clean, no process in it).
- Moved `out/` (electron-vite output, 4.7 MB) and `dist/` (electron-builder output, 322 MB, with the mac-arm64 app built at 15:43) to the Trash. `build/` holds the tracked icons and stays.
- Committed this file. The merged remote branches `origin/feat/initial-app` and `origin/claude/keen-hamilton-27wvrh` were deleted on GitHub afterwards; `main` is the only branch anywhere.

### Publishing audit

Request: "check that nothing personal is on edikte, no names, no nothing, then make it public."

- Searched every tracked file and all 70 commits for names, emails, user paths, the data folder, tokens and keys, and read the workflows, the release notes and assets, the PR texts, the comments and the repo description on GitHub. No secrets are stored there, and nobody else has access.
- Found three things. The handoff commit 0271b95 named the second user and carried the macOS user name in a path. The scraper fixtures carried the land-register numbers (EZ, BLNr, Grundstücksnummer) of real properties, which identify them in the public Grundbuch; `tests/scraper/detail.test.ts` and a comment in `src/main/scraper/detail.ts` repeated four of them. Streets, names, case numbers and edict IDs in the fixtures were already made up: 0 of the 136 fixture IDs match the live list or the database.
- Changed in this commit: the register numbers in all 12 fixtures (39 labelled fields and one unlabelled parcel in the Styria page) renumbered with `(n*7+3) mod 10^len`, so the length and the style stay and no number is kept; the four test values, the two case-key strings and the comment follow the fixtures; the two handoff lines reworded.
- The commits carried two private author emails (66 and 3 commits), visible in the `.patch` view of a public repo. The rewrite maps them to the GitHub noreply address.

### Published as a new repository

- The history was rewritten on a fresh clone with `git filter-repo` (the text replacements and the mailmap) and pushed to a new `salexandr0s/Edikte`, public since 2026-11-06. A force push into the old repo was rejected because its three merged PRs keep the old commits reachable. The old repo stays private as `salexandr0s/Edikte-archive` with its PRs, CI runs and the original release; delete it when it is no longer needed.
- Checked over the API after the push: every commit and the tag carry the GitHub noreply address, the handoff at HEAD and at its first commit holds no name or path, 71 commits, HEAD tree identical to the scrub commit.
- The local checkout was reset to the new history. The old objects remain only in the local reflog and in the archive repo.
- The tag push started the release workflow at 11:22 UTC on 2026-11-06. The first tag push, seconds after the first push into the empty repo, started nothing, so the tag was deleted and pushed again. The workflow rebuilt 0.1.0 and uploaded the packages to a draft release, which the user had published as the latest release (six assets) the same day.

### README with screenshots

Request: "can you make a nice readme for edikte? with screenshots etc". Commit cee9723.

- The README keeps its two language sections and every section of the old text (installation, unsigned app, AI providers, data folder, privacy, development). New: a centred header with the app icon and the release and CI badges, the list screenshot in light and dark through a `<picture>` element, a feature list, and a grid of the detail, map, filter and settings screens with captions, each language with its own screenshots.
- Added facts: the privacy section names Nominatim and basemap.at with the 14-day tile cache, the data folder section the `tiles` folder and the document retention (90 days after a case closes), the development section the screenshot command, and a licence line says there is none yet.
- `scripts/readme-screenshots.mjs` (`npm run screenshots`) drives Playwright's Chromium against `npm run dev:renderer`: it finishes the three setup steps, reads the labels from the i18n files so one flow serves both languages, and captures 1280×800 at 2× into `docs/screenshots/` (12 files, 4.0 MB). The map is a JPEG at quality 85 because its PNG weighed 1.6 to 2.9 MB; the other screens are PNGs of 200 to 345 KB.
- The images show the mock bridge's made-up sample data, and the README says so under the first image.

## Key Files Changed

- `tests/scraper/fixtures/*.html` (12 files): land-register numbers renumbered.
- `tests/scraper/detail.test.ts`, `src/main/scraper/detail.ts`: four expected EZ values, two case-key strings and one comment follow the fixtures.
- `README.md`: rewritten around the screenshots; the old sections kept.
- `docs/screenshots/` (12 images), `scripts/readme-screenshots.mjs`, `package.json` (`screenshots` script), `CLAUDE.md` (commands table).
- `SESSION_HANDOFF.md`: this file.

## Verification State

- 0d146d9: GitHub CI run 42050243497 (push to `main`, 14:58 UTC) passed: typecheck, lint, format check, unit tests and the Playwright smoke test of the built app on Linux.
- Scrub commit: `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm test` pass (the scraper suite alone: 103 passed, 1 skipped).
- History rewrite, tried on a throwaway clone with `git filter-repo --replace-text` (26 literal lines, longest first, so a line that contains another one is replaced first) and a mailmap: no old register number, name, user name or private email is left in any commit; the rewritten fixtures, test and source equal the working tree; the tag `v0.1.0` keeps its message; 70 commits. The list and the mailmap sit in the session scratchpad under `publish/`; the list is built from `git diff HEAD` of the scrub plus the two handoff lines, so it can be rebuilt.
- README commit cee9723: `npm run format:check` and `npm run lint` pass; the twelve images were looked at one by one; the page on GitHub shows the header, both badges, the dark list image in a dark browser, the feature list, the grid and the tables. Not run: unit tests and the e2e test, since no code under test changed; CI runs on the push.
- Not checked: the packaged app and the map inside Electron (see the gaps).

## Remaining / Known Gaps

- Delete `salexandr0s/Edikte-archive` once nothing in it is needed any more.
- No LICENSE file; `package.json` says UNLICENSED, so a public repo grants no rights. Decide whether that is intended. The README says so in one line.
- Two runs of `npm run screenshots` differ by a few hundred pixels at the bottom right of the list image, so every run changes the binary files. Commit new images only when a screen changed.
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
- No mock renderer dev server was running at the end of this session; the one started for the screenshots was stopped.

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
- The remote branches went after a second confirmation; both were merged, so nothing was lost.
- Register numbers were renumbered rather than removed, so the parsers still see the page layout as the site renders it.
- The history was rewritten with filter-repo rather than squashed: the commits keep their messages, and only the blobs with the old values and the author lines changed.
- New repository rather than a force push: the merged PRs of the old repo keep the old commits reachable, so the old repo stays private as an archive.
- README images are tracked in `docs/screenshots/` rather than uploaded elsewhere, so clones and forks render them. They come from the mock renderer, not the packaged app, so no real property, owner or data path appears in them. The map is the one JPEG, for its size.
- From the map session (f7dfc5c to e2286ca):
  - Leaflet's controls were replaced by the app's own `Button`, `Badge`, `Tooltip` and `Spinner`, not restyled, so Leaflet's CSS needs no overrides.
  - The pin card is content-sized in a left column so the map stays visible beside it; the chosen pin is panned out from under the column.
  - Dark mode keeps the CSS inversion of the tile pane, darkened to `brightness(0.8)` after comparing three variants.
  - No cluster plugin: a greedy screen-space grouping in `map-pins.ts`, about 40 lines, tested under Vitest.
  - Clusters live in render state derived from the zoom, and the fit logic works on the places, so regrouping never refits.
  - The tile layer is bounded to Austria instead of changing the failure heuristic.
  - The scale label builds its no-break space with `String.fromCharCode(0xa0)` because ESLint's `no-irregular-whitespace` rejects the character in a template literal.
  - The three map commits are separate so the grouping and the tile fix can be reverted on their own.
