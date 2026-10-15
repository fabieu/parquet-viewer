# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A read-only Tauri 2 desktop app for viewing Parquet files and filtering/sorting them with a user-typed SQL `WHERE … ORDER BY …` suffix. Rust backend (DuckDB, bundled) in `packages/tauri`, React 18 + TypeScript + Vite frontend in `packages/frontend`, and the project landing page (React 19 + Tailwind v4) in `packages/website`. pnpm workspace; the frontend and website are workspace packages — the Rust crate is built by Cargo/Tauri.

## Commands

Run from the repo root unless noted.

```sh
pnpm install
pnpm tauri dev        # app in dev mode (starts Vite on fixed port 1420)
pnpm tauri build      # installers

pnpm lint             # eslint (frontend)
pnpm format:check     # prettier, printWidth 110; `pnpm format` to fix
pnpm test             # vitest run (frontend)
pnpm --filter @parquet-viewer/frontend exec vitest run src/lib/pager.test.ts   # single test file
pnpm --filter @parquet-viewer/frontend exec vitest run -t "name"               # by test name
pnpm build            # tsc + vite build (type check)

# backend, in packages/tauri
cargo fmt --check
cargo clippy --all-targets -- -D warnings
cargo test
cargo test sorts_and_filters                 # single test
cargo insta review                           # accept changed snapshots (needs cargo-insta)

pnpm licenses         # regenerate packages/frontend/THIRD_PARTY_LICENSES.json (needs cargo-about); run after dependency changes

pnpm --filter @parquet-viewer/website dev     # landing page dev server (http://localhost:5173/parquet-viewer/)
pnpm --filter @parquet-viewer/website build   # tsc + client build + SSR build + prerender into packages/website/dist
```

- `tauri::generate_context!` requires `packages/frontend/dist` to exist, so `cargo` builds/tests fail on a fresh clone until you run `pnpm build` (or create the empty dir, as CI does).
- First Rust build is slow: DuckDB is compiled from source. `libduckdb-sys` is built with `opt-level = 3` even in dev.
- CI (`.github/workflows/ci.yml`) runs exactly the checks above; clippy runs on Linux, Windows and macOS because of cfg-gated code (macOS file-open events in `lib.rs`).

## Architecture

### Backend (`packages/tauri/src`)

- `lib.rs` — Tauri setup and command registration. A file passed on the command line (Windows/Linux) or via the macOS `RunEvent::Opened` is stored in `PendingOpen`; the UI pulls it with `take_pending_open` (macOS also emits `open-file`).
- `commands.rs` — thin `#[tauri::command]` wrappers that forward to `Db`.
- `model.rs` — serde types crossing the IPC boundary (camelCase). `AppError` serializes as `{ kind, message }`. **`packages/frontend/src/lib/api.ts` mirrors this file by hand — keep the two in sync.**
- `db.rs` — the core:
  - `duckdb::Connection` isn't `Sync`, so one worker thread owns an `Engine`; `Db` sends closures over an `mpsc` channel and awaits a `oneshot` reply. All queries are serialized through it.
  - Each opened file becomes a DuckDB view over `read_parquet(..., file_row_number = true)`.
  - Non-empty clauses are **materialized** into a temp table in view order so pages are cheap `rowid` ranges (`Engine::source_for`). Filters and large sorts store only `file_row_number`s and read row values back from the file; sorts whose estimated full copy fits `FULL_COPY_SHARE` of the memory limit copy all columns. One materialized view per file; the previous one is dropped only after the new one succeeds, so an invalid query keeps the last valid result.
  - `check_clause` is the SQL-injection guard: it uses `json_serialize_sql` to ensure the user text forms exactly one SELECT, then `prepare`s it to surface bind errors early. Error messages replace the internal view name with `file`.
  - Paging requests carry a `seq`; `Db::get_rows` returns `AppError::Cancelled` for superseded requests and interrupts a running materialization of a different view.
  - Engine settings worth knowing: extension autoload disabled, spill dir in OS temp, memory limit scaled to 50% of RAM, `compressed_materialization` optimizer disabled to work around a DuckDB bug (covered by the `sorts_and_filters` test), TIMESTAMPTZ rendered in UTC.
  - Values are converted per DuckDB type `Kind` to JSON; integers beyond 2^53 become strings, blobs become hex previews.
- `db/tests.rs` — tests build Parquet fixtures with DuckDB `COPY … TO` into a tempdir; type coverage is checked with `insta` JSON snapshots in `db/snapshots/`.

### Frontend (`packages/frontend/src`)

- `lib/api.ts` — typed `invoke` wrappers; converts backend errors to `AppError` (`isCancelled` to ignore superseded requests).
- `lib/pager.ts` — the scrolling engine: fixed-size pages (500 rows), debounced fetch of visible pages ±1, only the visible column window, contiguous missing pages batched into one request, LRU page cache that merges in columns fetched later. Sequence numbers are global across pagers because the backend compares them per file.
- `lib/clause.ts` — header-click sort cycling rewrites the trailing `ORDER BY` of the user's clause.
- `lib/cells.ts` — value → glide-data-grid cell mapping and TSV copy text.
- `components/DataView.tsx` hosts `@glideapps/glide-data-grid`; `App.tsx` owns file/view state.
- Visual design follows `DESIGN.md` (black canvas, single yellow accent `#faff69`, Inter / JetBrains Mono); theme tokens live in `global.css` and `lib/theme.ts`.

### Website (`packages/website`)

- Single landing page deployed to GitHub Pages (`https://fabieu.github.io/parquet-viewer/`, set once as `VITE_SITE_URL` in `.env`; the Vite `base` is derived from it) by `.github/workflows/website.yml`; pull requests only build it.
- Follows `DESIGN.md` Part 2; tokens are the Tailwind `@theme` in `src/index.css`.
- Fully static: React and the icon components are used only to render HTML, never in the browser. The only shipped JavaScript is `src/client.ts` (~2 KB), which wires up the mobile menu, the query-example tabs and the back-to-top button by `id`/ARIA attributes — keep the markup in `Nav.tsx`, `QueryExamples.tsx` and `ScrollToTop.tsx` in step with it. Components must not use state, effects or event handlers.
- Pages are listed in `PAGES` (`src/content.ts`): home, `imprint/` and `privacy/`, each with its own HTML shell (`index.html`, `imprint/index.html`, `privacy/index.html`, also listed in `vite.config.ts`); `<html data-page>` names the page.
- `renderInto` (`src/entry-server.tsx`) fills a shell's `<!--app-->` and `<!--head-->` (font preload; JSON-LD on the home page). `scripts/prerender.mjs` runs it for the build; in dev, the `staticPagesInDev` plugin in `vite.config.ts` runs it per request and reloads the page when a component changes (no HMR), so dev and production serve the same HTML.
- Impressum and Datenschutzerklärung are German HTML in `src/legal/*.html`, adapted from the faustball-ux project (same operator; the privacy text is from Datenschutz-Generator.de). Keep the privacy policy in step with the site: it states that the site sets no cookies, uses no analytics and embeds no third-party content, and names GitHub Pages as the host.
- `src/content.ts` holds the copy shared by the page and the JSON-LD (FAQ, links). Keep the facts in sync with the README.
- No third-party requests on page load (the privacy policy promises it): fonts are self-hosted via @fontsource, and the Buy Me a Coffee button is a plain link in their colors, not their embed script (which uses `document.write` and loads Google Fonts).
- `public/screenshots/*.webp` are generated from `docs/*.png`; `public/og.png` is the 1200 × 630 social preview.

## Conventions

- Conventional Commits are required: release-please generates the changelog and bumps the version in `package.json`, `packages/tauri/Cargo.toml`, `Cargo.lock` and `tauri.conf.json` together — don't bump versions by hand.
- The app must never modify opened files; export refuses to overwrite the open file.
