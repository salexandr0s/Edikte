# Edikte v0.3.0 handoff — 2026-11-22

## Completed

This release includes the published-price parser fix, the saved-search dashboard and alerts, and the November efficiency and design passes. Existing listings are reparsed on the next sync after updating. Court appraisal values and minimum bids retain their own labels and filter semantics.

- SQLite builds listing details for the representative of each case. Dashboard queries reuse matches, and idle notification checks avoid loading listings. Hidden screens pause queries and map geocoding.
- Partial pagination and recoverable notice failures preserve readable listings, flag the sync and retry on a later pass. The first complete import establishes the new-listing alert baseline. A locked PDF keeps its index and extracted pages for the next cleanup attempt.
- Listings has direct search and shows publication dates when sorted by publication. The dashboard groups its counts, Settings opens with sources and regions, and property documents remain near the top in a 960-pixel window. The README screenshots use the updated renderer with fabricated data.

## Files

The database changes live in `src/main/db`, with sync and file cleanup in `src/main/scraper/sync.ts` and `src/main/documents/retention.ts`. The screens and their localized text live in `src/renderer/src/features`. The bilingual release notes are in `docs/releases/v0.3.0.md`.

## Verification

- Typecheck, lint, formatting and the built Electron smoke journey use the scripts in package.json. The final unit suite passed 815 tests and skipped the two opt-in suites.
- A direct, rate-limited check on November 22 read all three Vienna JustizOnline result pages, with 236 distinct listings and an oldest publication date of 2023-01-17. A real court notice yielded a EUR 523,500 written minimum bid and EUR 69,800 deposit.
- In a local synthetic benchmark with 800 listings and 20 overlapping saved searches, median dashboard reads fell from 23.92 ms to 12.29 ms. Browser checks covered German and English, light and dark, 960- and 1280-pixel windows, keyboard focus, search, chronological sorting, list/map switching, setup validation and notification filters.
- Native OS banner delivery and cold-click behavior remain unverified on the distributed builds. The earlier isolated ad-hoc macOS test bundle was refused by Notification Center. In-app digests are available. App and browser checks used temporary or fabricated data.

## Release verification

The tag workflow checks both Mac architectures, verifies each DMG and ZIP, installs and self-checks the Windows x64 installer, then assembles five downloads and a SHA-256 manifest. These commands show the current published assets and the run that produced them.

```sh
gh release view v0.3.0 --json isDraft,tagName,url,assets
gh run list --workflow Release --branch v0.3.0 --limit 1
```
