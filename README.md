# Parquet Viewer

A fast, read-only desktop viewer for Parquet files on Windows, macOS and Linux. It uses a Tauri 2 shell, a React + TypeScript UI and DuckDB embedded in a Rust backend.

> **Status:** v1 features implemented and tested on Windows. The CI and release workflows have not run yet, and macOS/Linux verification and code signing are still open (see the roadmap).

## Features (v1)

- Open a local `.parquet` file from a file dialog, by drag and drop, or as a command-line argument
- See the schema, row count, file size and row group metadata right away
- Scroll smoothly through files with 100M+ rows in a virtualized grid
- Filter and sort with a SQL field: type a `WHERE … ORDER BY …` clause and DuckDB runs it as is; invalid SQL shows DuckDB's error
- Sort by clicking a column header (rewrites the clause's `ORDER BY`)
- Column statistics on demand: min, max, null count
- Copy cells or rows

**Not in v1:** editing, writing or exporting data (it is a reader only), other formats (CSV, JSON, Excel and SQLite come later through DuckDB), remote files (S3, HTTP), pivot tables, mobile builds.

## Architecture

The UI never touches data directly. It asks for a row range, and a single worker thread that owns the DuckDB connection runs the query.

```
┌──────────────────────┐   invoke()    ┌──────────────────────┐   mpsc    ┌─────────────────────┐
│  React UI (webview)  │ ────────────▶ │  Tauri commands      │ ────────▶ │  DB worker thread   │
│  Glide Data Grid     │ ◀──────────── │  (async, Rust)       │ ◀──────── │  duckdb::Connection │
│  paging + LRU cache  │   JSON page   │                      │  oneshot  │                     │
└──────────────────────┘               └──────────────────────┘           └──────────┬──────────┘
                                                                                     │ read_parquet()
                                                                                     ▼
                                                                              file.parquet
```

`duckdb::Connection` can't be shared safely across threads. Each command sends a request over an `mpsc` channel and awaits the reply on a `oneshot` channel. Commands stay `async`, so the UI never blocks. Every request carries a sequence number, so the UI can drop stale replies while scrolling.

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Shell | Tauri 2 | Small binaries, OS webview, Rust backend |
| UI | React + TypeScript (Vite) | Familiar, large ecosystem |
| Grid | Glide Data Grid | Canvas rendering, handles millions of rows |
| Query engine | `duckdb` crate, `bundled` feature | Built-in Parquet reader, nothing to install at runtime |
| Data transfer | `serde` + JSON (v1), Arrow IPC later | Simple first, faster later |
| Async/threads | `tokio` (via Tauri) + a dedicated DB thread | Keeps the UI responsive |
| Errors | `thiserror` | Typed errors serialized to the UI |

## Getting started

1. Install Rust (via `rustup` or `mise use -g rust@latest`), Node.js LTS, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (WebView2 on Windows, Xcode tools on macOS, WebKitGTK on Linux).
2. Install dependencies and run the app in development mode:

   ```sh
   npm install
   npm run tauri dev
   ```

The first build compiles DuckDB from C++ and takes several minutes. Later builds are cached. Use `cargo check` while coding to keep iteration fast. DuckDB is compiled with optimizations even in dev builds, since unoptimized it is far too slow to judge performance.

Checks:

```sh
npm run lint && npm run format:check && npm test     # frontend
cd src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
cargo test bench_large_file -- --ignored --nocapture  # 100M-row benchmark (PV_BENCH_ROWS to resize)
```

## Project layout

```
src/
  App.tsx            Window layout, opening files, query state
  components/        DataView (grid), QueryBar, Sidebar, AboutDialog
  lib/               api (typed commands), pager + LRU cache, cells, clause
src-tauri/src/
  lib.rs             Tauri setup, command registration, launch file
  commands.rs        #[tauri::command] functions
  db.rs              DuckDB worker thread, queries, tests
  model.rs           Shared structs (FileInfo, Column, View, Page, AppError)
```

## Backend API

The frontend talks to Rust through these Tauri commands. Each open file gets a `file_id`, so tabs with several files can be added later.

| Command | Input | Returns |
| --- | --- | --- |
| `open_file` | `path` | `file_id`, `FileInfo` (path, size, row count, row groups, created_by) |
| `get_schema` | `file_id` | list of `Column` (name, DuckDB type, Parquet physical/logical type, nullable) |
| `get_rows` | `file_id`, `offset`, `limit`, `view` (SQL `clause`), optional `seq` | `Page` (rows as JSON values, `total_rows` for the current view) |
| `get_column_stats` | `file_id`, `column` | min, max, null count |
| `close_file` | `file_id` | nothing |
| `take_pending_open` | – | a file passed on the command line or by the OS, if any |

**Key queries**

- Metadata: `parquet_metadata(?)` and `parquet_file_metadata(?)` for row groups and footer info
- Schema: `DESCRIBE SELECT * FROM read_parquet(?)` plus `parquet_schema(?)` for physical types
- Unsorted rows: a `file_row_number` range, which stays fast at any depth (deep `LIMIT/OFFSET` does not)
- Queried rows: `CREATE TEMP TABLE … AS SELECT * FROM file <clause>` once per clause, then `rowid` ranges

**Query layer rules**

- The query field's text goes to DuckDB as is, by design. It is first parsed with `json_serialize_sql` and must be exactly one `SELECT`, because duckdb-rs's `prepare` silently runs every statement before the last one. Everything else (paths, column names) is bound or quoted.
- Map DuckDB values to JSON explicitly: integers above 2^53 and decimals as strings, timestamps as ISO 8601, blobs as a hex preview, lists and structs as JSON.
- Return typed errors (`FileNotFound`, `NotParquet`, `QueryFailed`) so the UI can show useful messages.

## Performance

Target: open a 10 GB file and show the first screen in under 300 ms, then scroll at 60 fps. The approach is to read only what is on screen.

- **Metadata first.** On open, query only the footer. Never scan data to show the first screen.
- **Virtualized grid.** Fetch pages of 500 rows and keep the 20 most recent pages in an LRU cache.
- **Prefetch and debounce.** Debounce scroll requests by ~50 ms and prefetch one page above and below the viewport.
- **Cancel stale queries.** Drop responses older than the latest request, and use DuckDB's interrupt for long-running ones.
- **No deep OFFSET.** Page unsorted files by `file_row_number`, and materialize queried views once into a temp table paged by `rowid`. After an invalid query, the previous view is still materialized.
- **Project columns (planned).** For very wide files, select only the visible columns.
- **Cheaper transfer later.** If JSON shows up in profiling, switch `get_rows` to Arrow IPC and decode with `apache-arrow` in the UI.
- **Tune DuckDB.** Set `threads` to the CPU count, a `memory_limit` of 50% of RAM, and a spill directory in the OS temp folder so huge sorts spill to disk instead of failing. Cache Parquet footers between queries.

Measured on a 100M-row, 2.8 GB file (Windows, `cargo test bench_large_file`):

| Step | Time |
| --- | --- |
| Open + schema | 8 ms |
| Unsorted page at any depth | 22–25 ms |
| First `ORDER BY` (materialize) | 8.6 s |
| Page of a sorted view, any depth | 5–6 ms |
| First `WHERE contains(…)` (6.3M matches) | 2.9 s |

Still to benchmark: a file with 500+ columns and one with deeply nested types.

## Roadmap

Each phase ends with a gate, and the next phase starts only once the gate passes.

### Phase 1: Foundations (weeks 1–2)

- [ ] Rust Book chapters 1–10 and 16
- [ ] Scaffold the Tauri + React app and confirm it builds on Windows, macOS and Linux (Windows done)
- [x] Add `duckdb` (bundled) and the worker thread with its request channel
- [ ] A `ping` command that runs `SELECT 42` end to end

**Gate:** a SQL query runs from a Tauri command on all three OSes.

### Phase 2: Metadata view (week 3)

- [x] `open_file` from a file dialog, drag and drop, and a command-line argument
- [x] `get_schema` plus a file info panel (row count, size, row groups)
- [x] Clear errors for missing and non-Parquet files

**Gate:** the schema of a 10 GB file shows in under 300 ms.

### Phase 3: Scrolling grid (weeks 4–5)

- [x] `get_rows` with offset and limit, plus JSON type mapping
- [x] Glide Data Grid wired to a paging hook with an LRU cache
- [x] Debounce, prefetch and dropping of stale responses
- [x] Fixture tests for every Parquet type

**Gate:** smooth 60 fps scrolling through 100M rows.

### Phase 4: Query and sort (week 6)

- [x] SQL field for `WHERE … ORDER BY …`, with DuckDB's errors shown inline
- [x] Sort by clicking a column header
- [x] Materialize queried views into temp tables
- [x] Copy cells or rows

**Gate:** after the first sort, each page loads in under 200 ms.

### Phase 5: Ship v1 (week 7)

- [ ] CI builds with the Tauri GitHub Action and release-please (workflows written, not yet run)
- [x] `.parquet` file association and an About screen with licenses
- [ ] Code signing and macOS notarization

**Gate:** signed installers for all three OSes.

## Testing

- Rust unit tests for `db.rs`, using small Parquet fixtures generated with DuckDB's `COPY … TO 'x.parquet'` that cover every type (decimals, timestamps with time zones, lists, structs, maps, nulls)
- Snapshot tests for the JSON produced by `get_rows`, so type-mapping changes show up in review
- Vitest tests for the paging cache, request cancellation and `ORDER BY` rewriting
- One end-to-end smoke test per OS: open a fixture, scroll, sort, close (still to automate)

## Packaging

- Releases use [release-please](https://github.com/googleapis/release-please): it keeps a release PR up to date from [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, …) and bumps the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`. Merging that PR tags the release.
- The official Tauri GitHub Action then builds `.msi`/NSIS on Windows, `.dmg` on macOS, and `.AppImage` and `.deb` on Linux, and attaches them to the release.
- `.parquet` is registered as a file association in `tauri.conf.json`.
- Releases will be code-signed on macOS (with notarization) and Windows. The release workflow reads the Apple secrets when set; Windows signing still needs a certificate.
- The Tauri updater plugin is enabled once a release channel exists.

## Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Borrow checker slows progress | Weeks lost early | Learn the basics first, clone data freely in v1 |
| `duckdb::Connection` is not `Sync` | Compile errors when sharing it | One dedicated DB thread owns the connection, fed by a channel |
| Slow builds from bundled DuckDB | Slow iteration | Keep `target/` cached, use `cargo check` while coding |
| Deep OFFSET on sorted views | Laggy scrolling | Materialize sorted views into a temp table with row numbers |
| Webview differences per OS | Layout or rendering bugs | Test on all three OSes from Phase 2 |
| Unusual Parquet types | Crashes or wrong display | Fixture tests per type, fall back to `CAST(… AS VARCHAR)` |

## Licenses

DuckDB, Tauri and Glide Data Grid are MIT licensed. Their license notices appear in the app's About screen.
