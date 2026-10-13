# Parquet Viewer

A fast, read-only desktop viewer for Parquet files on Windows, macOS and Linux. It uses a Tauri 2 shell, a React + TypeScript UI and DuckDB embedded in a Rust backend.

> **Status:** planning. The first release (v1) targets about 7 weeks of work.

## Features (v1)

- Open a local `.parquet` file from a file dialog, by drag and drop, or as a command-line argument
- See the schema, row count, file size and row group metadata right away
- Scroll smoothly through files with 100M+ rows in a virtualized grid
- Sort and filter by column, pushed down to DuckDB
- Copy cells or rows, and export the current view to CSV

**Not in v1:** other formats (CSV, JSON, Excel and SQLite come later through DuckDB), editing or writing Parquet, remote files (S3, HTTP), pivot tables, mobile builds.

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

1. Install Rust via `rustup`, Node.js LTS, and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (WebView2 on Windows, Xcode tools on macOS, WebKitGTK on Linux).
2. Install dependencies and run the app in development mode:

   ```sh
   npm install
   npm run tauri dev
   ```

The first build compiles DuckDB from C++ and takes several minutes. Later builds are cached. Use `cargo check` while coding to keep iteration fast.

## Project layout

```
src/                 React UI (components, hooks, grid)
src-tauri/src/
  main.rs            Tauri setup, command registration
  commands.rs        #[tauri::command] functions
  db.rs              DuckDB worker thread and queries
  model.rs           Shared structs (Schema, Page, Error)
```

## Backend API

The frontend talks to Rust through five Tauri commands. Each open file gets a `file_id`, so tabs with several files can be added later.

| Command | Input | Returns |
| --- | --- | --- |
| `open_file` | `path` | `file_id`, `FileInfo` (path, size, row count, row groups, created_by) |
| `get_schema` | `file_id` | list of `Column` (name, DuckDB type, Parquet physical/logical type, nullable) |
| `get_rows` | `file_id`, `offset`, `limit`, `view` (sort + filters) | `Page` (columns, rows as JSON values, `total_rows` for the current view) |
| `get_column_stats` | `file_id`, `column` | min, max, null count, distinct estimate |
| `close_file` | `file_id` | nothing |

**Key queries**

- Metadata: `parquet_metadata(?)` and `parquet_file_metadata(?)` for row groups and footer info
- Schema: `DESCRIBE SELECT * FROM read_parquet(?)` plus `parquet_schema(?)` for physical types
- Rows: `SELECT * FROM read_parquet(?) [WHERE …] [ORDER BY …] LIMIT ? OFFSET ?`
- Filtered count: `SELECT count(*) FROM read_parquet(?) WHERE …`, cached per view

**Query layer rules**

- Always bind values as parameters and quote column names with double quotes. Never paste user text into SQL.
- Map DuckDB values to JSON explicitly: integers above 2^53 and decimals as strings, timestamps as ISO 8601, blobs as a hex preview, lists and structs as JSON.
- Return typed errors (`FileNotFound`, `NotParquet`, `QueryFailed`) so the UI can show useful messages.

## Performance

Target: open a 10 GB file and show the first screen in under 300 ms, then scroll at 60 fps. The approach is to read only what is on screen.

- **Metadata first.** On open, query only the footer. Never scan data to show the first screen.
- **Virtualized grid.** Fetch pages of 500 rows and keep the 20 most recent pages in an LRU cache.
- **Prefetch and debounce.** Debounce scroll requests by ~50 ms and prefetch one page above and below the viewport.
- **Cancel stale queries.** Drop responses older than the latest request, and use DuckDB's interrupt for long-running ones.
- **No deep OFFSET on sorted views.** Materialize sorted or filtered results once into a temp table with a row number, then page from it.
- **Project columns.** For very wide files, select only the visible columns.
- **Cheaper transfer later.** If JSON shows up in profiling, switch `get_rows` to Arrow IPC and decode with `apache-arrow` in the UI.
- **Tune DuckDB.** Set `threads` to the CPU count and a `memory_limit` (for example 50% of RAM) so huge sorts spill to disk.

Benchmarks use 1 MB, 1 GB and 10 GB fixtures, including one with 500+ columns and one with deeply nested types.

## Roadmap

Each phase ends with a gate, and the next phase starts only once the gate passes.

### Phase 1: Foundations (weeks 1–2)

- [ ] Rust Book chapters 1–10 and 16
- [ ] Scaffold the Tauri + React app and confirm it builds on Windows, macOS and Linux
- [ ] Add `duckdb` (bundled) and the worker thread with its request channel
- [ ] A `ping` command that runs `SELECT 42` end to end

**Gate:** a SQL query runs from a Tauri command on all three OSes.

### Phase 2: Metadata view (week 3)

- [ ] `open_file` from a file dialog, drag and drop, and a command-line argument
- [ ] `get_schema` plus a file info panel (row count, size, row groups)
- [ ] Clear errors for missing and non-Parquet files

**Gate:** the schema of a 10 GB file shows in under 300 ms.

### Phase 3: Scrolling grid (weeks 4–5)

- [ ] `get_rows` with offset and limit, plus JSON type mapping
- [ ] Glide Data Grid wired to a paging hook with an LRU cache
- [ ] Debounce, prefetch and dropping of stale responses
- [ ] Fixture tests for every Parquet type

**Gate:** smooth 60 fps scrolling through 100M rows.

### Phase 4: Sort and filter (week 6)

- [ ] Sort by clicking a column header, and a filter bar per column
- [ ] Materialize sorted and filtered views into temp tables
- [ ] Copy cells or rows, and export the current view to CSV

**Gate:** after the first sort, each page loads in under 200 ms.

### Phase 5: Ship v1 (week 7)

- [ ] CI builds with the Tauri GitHub Action
- [ ] `.parquet` file association and an About screen with licenses
- [ ] Code signing and macOS notarization

**Gate:** signed installers for all three OSes.

## Testing

- Rust unit tests for `db.rs`, using small Parquet fixtures generated with DuckDB's `COPY … TO 'x.parquet'` that cover every type (decimals, timestamps with time zones, lists, structs, maps, nulls)
- Snapshot tests for the JSON produced by `get_rows`, so type-mapping changes show up in review
- Vitest tests for the paging cache and request cancellation
- One end-to-end smoke test per OS: open a fixture, scroll, sort, close

## Packaging

- The official Tauri GitHub Action builds `.msi`/NSIS on Windows, `.dmg` on macOS, and `.AppImage` and `.deb` on Linux.
- `.parquet` is registered as a file association in `tauri.conf.json`.
- Releases are code-signed on macOS (with notarization) and Windows.
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
