//! DuckDB worker thread and queries.
//!
//! `duckdb::Connection` is not `Sync`, so a single thread owns it inside an
//! [`Engine`]. Commands talk to that thread through [`Db`], which sends a
//! closure over an `mpsc` channel and awaits the reply on a `oneshot` channel.

use std::collections::HashMap;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::sync::{Arc, Mutex};

use duckdb::{Connection, InterruptHandle};
use serde_json::Value as Json;
use tokio::sync::{mpsc, oneshot};

use crate::model::{
    AppError, AppResult, Column, ColumnStats, FileId, FileInfo, OpenedFile, Page, View,
};

/// Pseudo column added by `read_parquet(..., file_row_number = true)`.
const FILE_ROW: &str = "file_row_number";
/// Upper bound for a single `get_rows` request.
pub const MAX_PAGE_ROWS: u64 = 10_000;
/// Blobs are shown as a hex preview of this many bytes.
const BLOB_PREVIEW_BYTES: usize = 32;
/// Largest integer a JavaScript number represents exactly.
const MAX_SAFE_INT: i64 = (1 << 53) - 1;

// ---------------------------------------------------------------------------
// Engine: owns the connection, runs on the worker thread
// ---------------------------------------------------------------------------

struct OpenFile {
    info: FileInfo,
    columns: Vec<Column>,
    /// Name of the DuckDB view over `read_parquet`.
    src: String,
    /// Whether `src` exposes `file_row_number` (false if the file has a real
    /// column of that name).
    has_file_row: bool,
    /// SELECT list and per-column fetch kinds, built once for `rows`.
    select: String,
    kinds: Vec<Kind>,
    view: Option<Materialized>,
}

struct Materialized {
    key: View,
    table: String,
    total: u64,
}

/// The materialization currently running, so a newer request for a
/// different view can interrupt it.
struct Running {
    file_id: FileId,
    view: View,
    interrupted: bool,
}

type RunningSlot = Arc<Mutex<Option<Running>>>;

pub struct Engine {
    conn: Connection,
    files: HashMap<FileId, OpenFile>,
    next_id: FileId,
    next_table: u64,
    running: RunningSlot,
}

impl Engine {
    pub fn new() -> AppResult<Self> {
        let conn = Connection::open_in_memory()?;
        let threads = std::thread::available_parallelism()
            .map(|n| n.get())
            .unwrap_or(4);
        // Parquet and JSON are compiled in; never download extensions.
        conn.execute_batch(&format!(
            "SET autoinstall_known_extensions = false; SET autoload_known_extensions = false; \
             SET threads = {threads}; SET preserve_insertion_order = true; \
             SET parquet_metadata_cache = true;"
        ))?;
        // An in-memory database spills to `.tmp` in the working directory,
        // which may not be writable for an installed app; use the OS temp dir.
        let spill = std::env::temp_dir().join("parquet-viewer-duckdb");
        conn.execute_batch(&format!(
            "SET temp_directory = {};",
            sql_string(&spill.to_string_lossy())
        ))?;
        // Keep huge sorts from exhausting RAM: DuckDB spills to disk instead.
        // Its default limit is 80% of RAM; scale that down to 50%.
        let default_limit: String =
            conn.query_row("SELECT current_setting('memory_limit')", [], |r| r.get(0))?;
        if let Some(limit) = scale_memory_limit(&default_limit, 0.5 / 0.8) {
            conn.execute_batch(&format!("SET memory_limit = '{limit}';"))?;
        }
        // Work around a DuckDB bug: with a filter on one column and ORDER BY
        // another, compressed materialization trusts Parquet statistics the
        // filter invalidated (debug builds assert `min_val <= input`; release
        // builds could sort wrongly). Covered by `sorts_and_filters`.
        conn.execute_batch("SET disabled_optimizers = 'compressed_materialization';")?;
        // Render TIMESTAMPTZ in UTC. Needs ICU, so ignore failures.
        let _ = conn.execute_batch("SET TimeZone = 'UTC';");
        Ok(Self {
            conn,
            files: HashMap::new(),
            next_id: 1,
            next_table: 1,
            running: RunningSlot::default(),
        })
    }

    fn file(&self, id: FileId) -> AppResult<&OpenFile> {
        self.files.get(&id).ok_or(AppError::UnknownFile(id))
    }

    pub fn open(&mut self, path: &str) -> AppResult<OpenedFile> {
        let size_bytes = check_parquet_file(path)?;

        let (row_count, row_groups, created_by) = self
            .conn
            .query_row(
                "SELECT num_rows, num_row_groups, created_by FROM parquet_file_metadata(?)",
                [path],
                |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, i64>(1)?,
                        r.get::<_, Option<String>>(2)?,
                    ))
                },
            )
            .map_err(|e| AppError::NotParquet(format!("{path}: {e}")))?;

        let physical = self.physical_schema(path)?;
        let has_file_row = !physical.iter().any(|p| p.name == FILE_ROW);

        let id = self.next_id;
        self.next_id += 1;
        let src = format!("src_{id}");
        // Views cannot take bound parameters, so this is the one place the
        // path goes into SQL, as an escaped string literal.
        let options = if has_file_row {
            ", file_row_number = true"
        } else {
            ""
        };
        self.conn.execute_batch(&format!(
            "CREATE OR REPLACE TEMP VIEW {src} AS SELECT * FROM read_parquet({}{options})",
            sql_string(path)
        ))?;

        let columns = self.describe(&src, has_file_row, &physical)?;
        let kinds: Vec<Kind> = columns.iter().map(|c| kind_of(&c.duckdb_type)).collect();
        let select = columns
            .iter()
            .zip(&kinds)
            .map(|(c, k)| select_expr(c, *k))
            .collect::<Vec<_>>()
            .join(", ");
        let info = FileInfo {
            path: path.to_string(),
            size_bytes,
            row_count: row_count as u64,
            row_groups: row_groups as u64,
            created_by,
        };
        self.files.insert(
            id,
            OpenFile {
                info: info.clone(),
                columns,
                src,
                has_file_row,
                select,
                kinds,
                view: None,
            },
        );
        Ok(OpenedFile { file_id: id, info })
    }

    /// Top-level columns from the Parquet footer, in file order.
    fn physical_schema(&self, path: &str) -> AppResult<Vec<PhysicalColumn>> {
        let mut stmt = self.conn.prepare(
            "SELECT name, type, logical_type, converted_type, repetition_type, num_children \
             FROM parquet_schema(?)",
        )?;
        let rows = stmt
            .query_map([path], |r| {
                Ok((
                    PhysicalColumn {
                        name: r.get(0)?,
                        physical_type: r.get(1)?,
                        logical_type: r.get::<_, Option<String>>(2)?.or(r.get(3)?),
                        nullable: r.get::<_, Option<String>>(4)?.as_deref() != Some("REQUIRED"),
                    },
                    r.get::<_, Option<i64>>(5)?.unwrap_or(0),
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        // The schema is a depth-first tree with the root first. Track how
        // many children each open level still has to find depth-1 entries.
        let mut top = Vec::new();
        let mut remaining: Vec<i64> = Vec::new();
        for (i, (col, children)) in rows.into_iter().enumerate() {
            if i == 0 {
                remaining.push(children);
                continue;
            }
            while remaining.last() == Some(&0) {
                remaining.pop();
            }
            if let Some(last) = remaining.last_mut() {
                *last -= 1;
            }
            if remaining.len() == 1 {
                top.push(col);
            }
            if children > 0 {
                remaining.push(children);
            }
        }
        Ok(top)
    }

    fn describe(
        &self,
        src: &str,
        has_file_row: bool,
        physical: &[PhysicalColumn],
    ) -> AppResult<Vec<Column>> {
        let mut stmt = self.conn.prepare(&format!("DESCRIBE {src}"))?;
        let described = stmt
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        let columns = described
            .into_iter()
            .filter(|(name, _)| !(has_file_row && name == FILE_ROW))
            .map(|(name, duckdb_type)| {
                let p = physical.iter().find(|p| p.name == name);
                Column {
                    physical_type: p.and_then(|p| p.physical_type.clone()),
                    logical_type: p.and_then(|p| p.logical_type.clone()),
                    nullable: p.is_none_or(|p| p.nullable),
                    name,
                    duckdb_type,
                }
            })
            .collect();
        Ok(columns)
    }

    pub fn schema(&self, id: FileId) -> AppResult<Vec<Column>> {
        Ok(self.file(id)?.columns.clone())
    }

    pub fn rows(&mut self, id: FileId, offset: u64, limit: u64, view: &View) -> AppResult<Page> {
        let limit = limit.min(MAX_PAGE_ROWS);
        let (source, total) = self.source_for(id, view)?;
        let f = self.file(id)?;
        let select = &f.select;
        let end = offset.saturating_add(limit);

        // Page by a row-number range so DuckDB can skip row groups instead
        // of scanning everything before a deep OFFSET.
        let sql = match &source {
            Source::Materialized(table) if shadows_rowid(&f.columns) => {
                format!("SELECT {select} FROM {table} LIMIT {limit} OFFSET {offset}")
            }
            Source::Materialized(table) => format!(
                "SELECT {select} FROM {table} WHERE rowid >= {offset} AND rowid < {end} ORDER BY rowid"
            ),
            Source::File if f.has_file_row => format!(
                "SELECT {select} FROM {} WHERE {FILE_ROW} >= {offset} AND {FILE_ROW} < {end} ORDER BY {FILE_ROW}",
                f.src
            ),
            Source::File => format!(
                "SELECT {select} FROM {} LIMIT {limit} OFFSET {offset}",
                f.src
            ),
        };

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map([], |r| {
                f.kinds
                    .iter()
                    .enumerate()
                    .map(|(i, k)| read_value(r, i, *k))
                    .collect::<Result<Vec<_>, _>>()
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Page {
            offset,
            rows,
            total_rows: total,
        })
    }

    /// Where rows for `view` come from: the file itself, or a temp table
    /// holding the sorted/filtered result. Materializes on first use.
    fn source_for(&mut self, id: FileId, view: &View) -> AppResult<(Source, u64)> {
        let f = self.file(id)?;
        let clause = view.clause.trim();
        if clause.is_empty() {
            return Ok((Source::File, f.info.row_count));
        }
        if let Some(m) = f.view.as_ref().filter(|m| m.key == *view) {
            return Ok((Source::Materialized(m.table.clone()), m.total));
        }

        // The user's WHERE / ORDER BY text goes to DuckDB as is, but only
        // as part of a single SELECT (see `check_clause`).
        let query = format!("SELECT * FROM {} {clause}", f.src);
        check_clause(&self.conn, &f.src, &query)?;
        let table = format!("view_{id}_{}", self.next_table);
        self.next_table += 1;
        // The table is written in view order, so its `rowid` is the row's
        // position in the view and pages are cheap `rowid` ranges.
        self.materialize(id, view, &format!("CREATE TEMP TABLE {table} AS {query}"))?;
        // `execute` reports 0 rows for CREATE TABLE AS, so count them.
        let total: i64 =
            self.conn
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))?;
        let total = total as u64;
        // Keep one materialized view per file. The previous one is dropped
        // only now, so after an invalid query the last valid view is still
        // there to go back to.
        let previous = self.files.get_mut(&id).and_then(|f| {
            f.view.replace(Materialized {
                key: view.clone(),
                table: table.clone(),
                total,
            })
        });
        if let Some(old) = previous {
            self.conn
                .execute_batch(&format!("DROP TABLE IF EXISTS {}", old.table))?;
        }
        Ok((Source::Materialized(table), total))
    }

    /// Runs a `CREATE TABLE … AS` for `view`. A newer request for another
    /// view may interrupt it (see `Db::get_rows`).
    fn materialize(&self, id: FileId, view: &View, sql: &str) -> AppResult<()> {
        *self.running.lock().unwrap() = Some(Running {
            file_id: id,
            view: view.clone(),
            interrupted: false,
        });
        let result = self.conn.execute(sql, []);
        let interrupted = self
            .running
            .lock()
            .unwrap()
            .take()
            .is_some_and(|r| r.interrupted);
        match result {
            Ok(_) => Ok(()),
            Err(_) if interrupted => Err(AppError::Cancelled),
            Err(e) => Err(AppError::QueryFailed(e.to_string())),
        }
    }

    pub fn column_stats(&self, id: FileId, column: &str) -> AppResult<ColumnStats> {
        let f = self.file(id)?;
        find_column(&f.columns, column)?;
        let q = quote_ident(column);
        let sql = format!(
            "SELECT CAST(min({q}) AS VARCHAR), CAST(max({q}) AS VARCHAR), \
             count(*) - count({q}) FROM {}",
            f.src
        );
        Ok(self.conn.query_row(&sql, [], |r| {
            Ok(ColumnStats {
                min: r.get(0)?,
                max: r.get(1)?,
                null_count: r.get::<_, i64>(2)? as u64,
            })
        })?)
    }

    pub fn close(&mut self, id: FileId) -> AppResult<()> {
        let f = self.files.remove(&id).ok_or(AppError::UnknownFile(id))?;
        if let Some(m) = f.view {
            self.conn
                .execute_batch(&format!("DROP TABLE IF EXISTS {}", m.table))?;
        }
        self.conn
            .execute_batch(&format!("DROP VIEW IF EXISTS {}", f.src))?;
        Ok(())
    }
}

enum Source {
    File,
    Materialized(String),
}

struct PhysicalColumn {
    name: String,
    physical_type: Option<String>,
    logical_type: Option<String>,
    nullable: bool,
}

const ONE_STATEMENT: &str = "Only a WHERE / ORDER BY clause is allowed, without `;`";

/// Parses and binds `SELECT * FROM {src} {clause}` without running it, and
/// rejects anything but exactly one SELECT. This matters because
/// duckdb-rs's `prepare` silently executes every statement before the last,
/// so `WHERE true; DROP …` would otherwise run. Errors name the source
/// `file`, as the query bar shows it.
fn check_clause(conn: &Connection, src: &str, query: &str) -> AppResult<()> {
    // Same length as `src`, so DuckDB's `^` error marker stays aligned.
    let shown = format!("{:<width$}", "file", width = src.len());
    let fail = |message: &str| AppError::QueryFailed(message.replace(src, &shown));

    let parsed: String = conn.query_row(
        "SELECT json_serialize_sql(CAST(? AS VARCHAR))",
        [query],
        |r| r.get(0),
    )?;
    let parsed: Json = serde_json::from_str(&parsed).map_err(|e| fail(&e.to_string()))?;
    if parsed["error"] == Json::Bool(true) {
        let message = parsed["error_message"].as_str().unwrap_or("invalid SQL");
        // Raised when any statement after a `;` is not a SELECT.
        if message.starts_with("Only SELECT statements") {
            return Err(fail(ONE_STATEMENT));
        }
        return Err(fail(message));
    }
    if parsed["statements"].as_array().map(Vec::len) != Some(1) {
        return Err(fail(ONE_STATEMENT));
    }
    // A single statement, so preparing it only parses and binds: this
    // reports unknown columns and type errors before any work starts.
    conn.prepare(query).map_err(|e| fail(&e.to_string()))?;
    Ok(())
}

/// Checks the file exists and has the `PAR1` magic at both ends. Returns the
/// file size.
fn check_parquet_file(path: &str) -> AppResult<u64> {
    let mut file = File::open(path).map_err(|e| match e.kind() {
        std::io::ErrorKind::NotFound => AppError::FileNotFound(path.to_string()),
        _ => AppError::Io(format!("{path}: {e}")),
    })?;
    let meta = file.metadata()?;
    if !meta.is_file() {
        return Err(AppError::FileNotFound(path.to_string()));
    }
    let size = meta.len();
    let mut head = [0u8; 4];
    let mut tail = [0u8; 4];
    let ok = size >= 12
        && file.read_exact(&mut head).is_ok()
        && file.seek(SeekFrom::End(-4)).is_ok()
        && file.read_exact(&mut tail).is_ok()
        && &head == b"PAR1"
        && &tail == b"PAR1";
    if !ok {
        return Err(AppError::NotParquet(path.to_string()));
    }
    Ok(size)
}

// ---------------------------------------------------------------------------
// SQL building
// ---------------------------------------------------------------------------

/// Scales a DuckDB memory setting such as `12.7 GiB` by `factor`.
fn scale_memory_limit(setting: &str, factor: f64) -> Option<String> {
    let (value, unit) = setting.trim().split_once(' ')?;
    let value: f64 = value.parse().ok()?;
    if !unit.chars().all(|c| c.is_ascii_alphabetic()) {
        return None;
    }
    Some(format!("{:.1} {unit}", value * factor))
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn sql_string(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

fn find_column<'a>(columns: &'a [Column], name: &str) -> AppResult<&'a Column> {
    columns
        .iter()
        .find(|c| c.name == name)
        .ok_or_else(|| AppError::UnknownColumn(name.to_string()))
}

/// A real column named `rowid` hides DuckDB's pseudo column of that name.
fn shadows_rowid(columns: &[Column]) -> bool {
    columns.iter().any(|c| c.name.eq_ignore_ascii_case("rowid"))
}

// ---------------------------------------------------------------------------
// Value mapping
// ---------------------------------------------------------------------------

/// How a column is fetched and turned into JSON.
#[derive(Clone, Copy)]
enum Kind {
    Bool,
    Int,
    /// 64/128-bit integers: numbers when exact in JS, strings otherwise.
    BigInt,
    Float,
    Blob,
    /// Lists, structs, maps, unions: fetched with `to_json`.
    Json,
    /// Everything else (decimals, dates, timestamps, UUIDs, ...) as text.
    Text,
}

fn kind_of(duckdb_type: &str) -> Kind {
    let t = duckdb_type.trim();
    if t.ends_with(']')
        || ["STRUCT(", "MAP(", "UNION("]
            .iter()
            .any(|p| t.starts_with(p))
    {
        return Kind::Json;
    }
    match t {
        "BOOLEAN" => Kind::Bool,
        "TINYINT" | "SMALLINT" | "INTEGER" | "UTINYINT" | "USMALLINT" | "UINTEGER" => Kind::Int,
        "BIGINT" | "UBIGINT" | "HUGEINT" | "UHUGEINT" => Kind::BigInt,
        "FLOAT" | "DOUBLE" => Kind::Float,
        "BLOB" => Kind::Blob,
        _ => Kind::Text,
    }
}

fn select_expr(col: &Column, kind: Kind) -> String {
    let q = quote_ident(&col.name);
    match kind {
        Kind::Bool | Kind::Int | Kind::Float | Kind::Blob => q,
        Kind::BigInt => format!("CAST({q} AS VARCHAR)"),
        Kind::Json => format!("CAST(to_json({q}) AS VARCHAR)"),
        // `2024-01-02 03:04:05+00` -> `2024-01-02T03:04:05+00` (ISO 8601).
        Kind::Text if col.duckdb_type.starts_with("TIMESTAMP") => {
            format!("replace(CAST({q} AS VARCHAR), ' ', 'T')")
        }
        Kind::Text => format!("CAST({q} AS VARCHAR)"),
    }
}

fn read_value(row: &duckdb::Row, i: usize, kind: Kind) -> duckdb::Result<Json> {
    Ok(match kind {
        Kind::Bool => row
            .get::<_, Option<bool>>(i)?
            .map_or(Json::Null, Json::Bool),
        Kind::Int => row.get::<_, Option<i64>>(i)?.map_or(Json::Null, Json::from),
        Kind::BigInt => row
            .get::<_, Option<String>>(i)?
            .map_or(Json::Null, |s| big_int(&s)),
        Kind::Float => row.get::<_, Option<f64>>(i)?.map_or(Json::Null, |v| {
            serde_json::Number::from_f64(v)
                .map_or_else(|| Json::String(v.to_string()), Json::Number)
        }),
        Kind::Blob => row
            .get::<_, Option<Vec<u8>>>(i)?
            .map_or(Json::Null, |b| Json::String(blob_preview(&b))),
        Kind::Json => row.get::<_, Option<String>>(i)?.map_or(Json::Null, |s| {
            serde_json::from_str(&s).unwrap_or(Json::String(s))
        }),
        Kind::Text => row
            .get::<_, Option<String>>(i)?
            .map_or(Json::Null, Json::String),
    })
}

fn big_int(s: &str) -> Json {
    match s.parse::<i64>() {
        Ok(v) if (-MAX_SAFE_INT..=MAX_SAFE_INT).contains(&v) => Json::from(v),
        _ => Json::String(s.to_string()),
    }
}

fn blob_preview(bytes: &[u8]) -> String {
    let hex: String = bytes
        .iter()
        .take(BLOB_PREVIEW_BYTES)
        .map(|b| format!("{b:02x}"))
        .collect();
    if bytes.len() > BLOB_PREVIEW_BYTES {
        format!("0x{hex}… ({} bytes)", bytes.len())
    } else {
        format!("0x{hex}")
    }
}

// ---------------------------------------------------------------------------
// Db: async handle to the worker thread
// ---------------------------------------------------------------------------

type Job = Box<dyn FnOnce(&mut Engine) + Send>;

struct Shared {
    /// Newest `get_rows` sequence number seen per file.
    latest_seq: Mutex<HashMap<FileId, u64>>,
    running: RunningSlot,
    interrupt: Arc<InterruptHandle>,
}

#[derive(Clone)]
pub struct Db {
    tx: mpsc::UnboundedSender<Job>,
    shared: Arc<Shared>,
}

impl Db {
    pub fn start() -> AppResult<Self> {
        let engine = Engine::new()?;
        let shared = Arc::new(Shared {
            latest_seq: Mutex::default(),
            running: engine.running.clone(),
            interrupt: engine.conn.interrupt_handle(),
        });
        let (tx, mut rx) = mpsc::unbounded_channel::<Job>();
        std::thread::Builder::new()
            .name("duckdb".into())
            .spawn(move || {
                let mut engine = engine;
                while let Some(job) = rx.blocking_recv() {
                    job(&mut engine);
                }
            })?;
        Ok(Self { tx, shared })
    }

    /// Runs `f` on the worker thread and waits for its result.
    pub async fn run<T, F>(&self, f: F) -> AppResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut Engine) -> AppResult<T> + Send + 'static,
    {
        let (reply, rx) = oneshot::channel();
        self.tx
            .send(Box::new(move |engine| {
                let _ = reply.send(f(engine));
            }))
            .map_err(|_| worker_gone())?;
        rx.await.map_err(|_| worker_gone())?
    }

    /// Like [`Engine::rows`], for the grid's paging requests (`seq` set):
    /// skips the query if a newer request for the same file arrived while
    /// this one was queued, and interrupts a running materialization of a
    /// view the UI no longer shows. Requests without `seq` (copying a
    /// selection) always run and do not affect paging.
    pub async fn get_rows(
        &self,
        id: FileId,
        seq: Option<u64>,
        offset: u64,
        limit: u64,
        view: View,
    ) -> AppResult<Page> {
        if let Some(seq) = seq {
            {
                let mut latest = self.shared.latest_seq.lock().unwrap();
                let entry = latest.entry(id).or_insert(0);
                *entry = (*entry).max(seq);
            }
            let mut running = self.shared.running.lock().unwrap();
            if let Some(r) = running
                .as_mut()
                .filter(|r| r.file_id == id && r.view != view)
            {
                r.interrupted = true;
                self.shared.interrupt.interrupt();
            }
        }
        let shared = self.shared.clone();
        self.run(move |engine| {
            if let Some(seq) = seq {
                let latest = shared.latest_seq.lock().unwrap().get(&id).copied();
                if latest.is_some_and(|latest| seq < latest) {
                    return Err(AppError::Cancelled);
                }
            }
            engine.rows(id, offset, limit, &view)
        })
        .await
    }

    pub async fn close(&self, id: FileId) -> AppResult<()> {
        self.shared.latest_seq.lock().unwrap().remove(&id);
        self.run(move |engine| engine.close(id)).await
    }
}

fn worker_gone() -> AppError {
    AppError::QueryFailed("database worker stopped".into())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests;
