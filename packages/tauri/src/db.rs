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
    AppError, AppResult, Bin, Column, ColumnProfile, FileId, FileInfo, FooterStats, OpenedFile,
    Page, ValueCount, View,
};

/// Compression codecs DuckDB can decode. The Parquet spec also has the
/// deprecated `LZ4` (Hadoop-framed) and `LZO`, which it rejects.
const SUPPORTED_CODECS: [&str; 6] = [
    "UNCOMPRESSED",
    "SNAPPY",
    "GZIP",
    "BROTLI",
    "ZSTD",
    "LZ4_RAW",
];
/// Pseudo column added by `read_parquet(..., file_row_number = true)`.
const FILE_ROW: &str = "file_row_number";
/// Upper bound for a single `get_rows` request.
pub const MAX_PAGE_ROWS: u64 = 10_000;
/// Blobs are shown as a hex preview of this many bytes.
const BLOB_PREVIEW_BYTES: usize = 32;
/// Largest integer a JavaScript number represents exactly.
const MAX_SAFE_INT: i64 = (1 << 53) - 1;
/// A sorted view is copied in full only while that copy is estimated to
/// take at most this share of DuckDB's memory limit (see
/// `Engine::source_for`).
const FULL_COPY_SHARE: f64 = 0.125;
/// Number of most frequent values in a column profile.
const TOP_VALUES: usize = 5;
/// Number of bins in a column profile's histogram.
const HISTOGRAM_BINS: u64 = 20;

// ---------------------------------------------------------------------------
// Engine: owns the connection, runs on the worker thread
// ---------------------------------------------------------------------------

struct OpenFile {
    info: FileInfo,
    columns: Columns,
    /// Name of the DuckDB view over `read_parquet`.
    src: String,
    /// Whether `src` exposes `file_row_number` (false if the file has a real
    /// column of that name).
    has_file_row: bool,
    /// Uncompressed size of all column chunks, to estimate a full copy.
    uncompressed_bytes: u64,
    view: Option<Materialized>,
}

impl OpenFile {
    /// The materialization of exactly `view`, if it is the current one.
    fn materialized(&self, view: &View) -> Option<&Materialized> {
        self.view.as_ref().filter(|m| m.key == *view)
    }
}

struct Materialized {
    key: View,
    table: String,
    /// Whether `table` holds only `file_row_number`s instead of all columns.
    row_numbers: bool,
    total: u64,
    /// The view's own columns if it has a column list.
    columns: Option<Columns>,
}

/// The columns a view shows, with their SELECT expressions (qualified as
/// `s.…`) and fetch kinds, built once for `rows`.
struct Columns {
    list: Vec<Column>,
    exprs: Vec<String>,
    kinds: Vec<Kind>,
}

impl Columns {
    fn new(list: Vec<Column>) -> Self {
        let kinds: Vec<Kind> = list.iter().map(|c| kind_of(&c.duckdb_type)).collect();
        let exprs = list
            .iter()
            .zip(&kinds)
            .map(|(c, k)| select_expr(c, *k))
            .collect();
        Columns { list, exprs, kinds }
    }
}

impl Materialized {
    fn source(&self) -> Source {
        if self.row_numbers {
            Source::RowNumbers(self.table.clone())
        } else {
            Source::Materialized(self.table.clone())
        }
    }
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
    full_copy_budget: u64,
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
        let limit = setting_bytes(&default_limit).map(|b| (b as f64 * 0.5 / 0.8) as u64);
        if let Some(limit) = limit {
            conn.execute_batch(&format!("SET memory_limit = '{limit}B';"))?;
        }
        let full_copy_budget = (limit.unwrap_or(0) as f64 * FULL_COPY_SHARE) as u64;
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
            full_copy_budget,
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

        let (compression, uncompressed_bytes) = self.compression(path)?;
        let unsupported: Vec<&str> = compression
            .iter()
            .map(String::as_str)
            .filter(|c| !SUPPORTED_CODECS.contains(c))
            .collect();
        if !unsupported.is_empty() {
            return Err(AppError::UnsupportedCompression(unsupported.join(", ")));
        }

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

        let columns = Columns::new(self.describe(&src, has_file_row, &physical)?);
        let info = FileInfo {
            path: path.to_string(),
            size_bytes,
            row_count: row_count as u64,
            row_groups: row_groups as u64,
            created_by,
            compression,
        };
        self.files.insert(
            id,
            OpenFile {
                info: info.clone(),
                columns,
                src,
                has_file_row,
                uncompressed_bytes,
                view: None,
            },
        );
        Ok(OpenedFile { file_id: id, info })
    }

    /// Distinct compression codecs used by the file's column chunks, and
    /// the chunks' total uncompressed size.
    fn compression(&self, path: &str) -> AppResult<(Vec<String>, u64)> {
        let mut stmt = self.conn.prepare(
            "SELECT compression, CAST(sum(total_uncompressed_size) AS BIGINT)              FROM parquet_metadata(?) GROUP BY compression ORDER BY compression",
        )?;
        let chunks = stmt
            .query_map([path], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        let uncompressed = chunks.iter().map(|(_, size)| *size as u64).sum();
        let codecs = chunks.into_iter().map(|(codec, _)| codec).collect();
        Ok((codecs, uncompressed))
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
        Ok(self.file(id)?.columns.list.clone())
    }

    /// Names of the scalar and aggregate functions and macros a query can
    /// call, sorted, for autocomplete. Leaves out operators such as `+` and
    /// internal functions named `__…`.
    pub fn functions(&self) -> AppResult<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT DISTINCT function_name FROM duckdb_functions() \n             WHERE function_type IN ('scalar', 'aggregate', 'macro') \n             AND regexp_full_match(function_name, '[a-z][a-z0-9_]*') ORDER BY 1",
        )?;
        let names = stmt
            .query_map([], |r| r.get(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(names)
    }

    /// Rows `offset..offset + limit` of `view`, with the values of
    /// `columns` (indices into the schema) in that order. Reading fewer
    /// columns is much cheaper, since DuckDB decodes whole column chunks.
    pub fn rows(
        &mut self,
        id: FileId,
        offset: u64,
        limit: u64,
        view: &View,
        columns: &[usize],
    ) -> AppResult<Page> {
        let limit = limit.min(MAX_PAGE_ROWS);
        let (source, total) = self.source_for(id, view)?;
        let f = self.file(id)?;
        let shown = self.columns_of(id, view)?;
        let mut exprs = Vec::with_capacity(columns.len());
        let mut kinds = Vec::with_capacity(columns.len());
        for &i in columns {
            let expr = shown
                .exprs
                .get(i)
                .ok_or_else(|| AppError::UnknownColumn(i.to_string()))?;
            exprs.push(expr.as_str());
            kinds.push(shown.kinds[i]);
        }
        // Without columns, a row is empty but the row count still counts.
        let select = if exprs.is_empty() {
            "NULL".to_string()
        } else {
            exprs.join(", ")
        };
        let end = offset.saturating_add(limit);

        // Page by a row-number range so DuckDB can skip row groups instead
        // of scanning everything before a deep OFFSET.
        let sql = match &source {
            Source::Materialized(table) if shadows_rowid(&shown.list) => {
                format!("SELECT {select} FROM {table} s LIMIT {limit} OFFSET {offset}")
            }
            Source::Materialized(table) => format!(
                "SELECT {select} FROM {table} s WHERE rowid >= {offset} AND rowid < {end} ORDER BY rowid"
            ),
            // `select` is qualified, so a real `rowid` column cannot clash
            // with `p.rowid`.
            Source::RowNumbers(table) => format!(
                "SELECT {select} FROM {table} p JOIN {} s ON s.{FILE_ROW} = p.{FILE_ROW}                  WHERE p.rowid >= {offset} AND p.rowid < {end} ORDER BY p.rowid",
                f.src
            ),
            Source::File if f.has_file_row => format!(
                "SELECT {select} FROM {} s WHERE {FILE_ROW} >= {offset} AND {FILE_ROW} < {end} ORDER BY {FILE_ROW}",
                f.src
            ),
            Source::File => format!(
                "SELECT {select} FROM {} s LIMIT {limit} OFFSET {offset}",
                f.src
            ),
        };

        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt
            .query_map([], |r| {
                kinds
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
        if clause.is_empty() && view.projection().is_none() {
            return Ok((Source::File, f.info.row_count));
        }
        if let Some(m) = f.materialized(view) {
            return Ok((m.source(), m.total));
        }

        // The user's column list and WHERE / ORDER BY text go to DuckDB as
        // is, but only as part of a single SELECT (see `check_clause`).
        let query = view_query(f, view);
        let sorted = check_clause(&self.conn, &f.src, &query)?;
        let numbers = format!("SELECT {FILE_ROW} FROM {} {clause}", f.src);
        let (has_file_row, file_rows, uncompressed) =
            (f.has_file_row, f.info.row_count, f.uncompressed_bytes);
        let budget = self.full_copy_budget;
        // Estimates a full copy of `rows` rows from the file's average row.
        let fits = |rows: u64| {
            u128::from(uncompressed) * u128::from(rows)
                <= u128::from(budget) * u128::from(file_rows)
        };
        let table = format!("view_{id}_{}", self.next_table);
        self.next_table += 1;
        // The table is written in view order, so its `rowid` is the row's
        // position in the view and pages are cheap `rowid` ranges. A full
        // copy holds every column, which takes a lot of memory and time for
        // large views, so where possible the table keeps only each row's
        // `file_row_number` and pages read their rows from the file. That
        // is cheap for filters, whose rows stay in file order, but sorted
        // rows are scattered over the whole file, so sorts are still copied
        // in full while the copy fits the budget. A column list computes
        // its own columns, so its rows are always copied in full.
        let mut row_numbers =
            view.projection().is_none() && has_file_row && !(sorted && fits(file_rows));
        let source = if row_numbers { &numbers } else { &query };
        let mut total = self.create(id, view, &table, source)?;
        // A filter may leave few enough rows to copy in full after all.
        if row_numbers && sorted && fits(total) {
            self.conn.execute_batch(&format!("DROP TABLE {table}"))?;
            total = self.create(id, view, &table, &query)?;
            row_numbers = false;
        }
        let columns = view
            .projection()
            .map(|_| self.describe(&table, false, &[]).map(Columns::new))
            .transpose()?;
        let m = Materialized {
            key: view.clone(),
            table,
            row_numbers,
            total,
            columns,
        };
        let source = m.source();
        // Keep one materialized view per file. The previous one is dropped
        // only now, so after an invalid query the last valid view is still
        // there to go back to.
        let previous = self.files.get_mut(&id).and_then(|f| f.view.replace(m));
        if let Some(old) = previous {
            self.conn
                .execute_batch(&format!("DROP TABLE IF EXISTS {}", old.table))?;
        }
        Ok((source, total))
    }

    /// The columns `view` shows: its own after a column list, which must be
    /// materialized, or else the file's.
    fn columns_of(&self, id: FileId, view: &View) -> AppResult<&Columns> {
        let f = self.file(id)?;
        Ok(f.materialized(view)
            .and_then(|m| m.columns.as_ref())
            .unwrap_or(&f.columns))
    }

    /// The columns `view` shows, without running it: for a column list,
    /// those of the query as a subquery, which DuckDB names the same as the
    /// materialized table (`a, a` becomes `a, a_1`).
    pub fn view_schema(&self, id: FileId, view: &View) -> AppResult<Vec<Column>> {
        let f = self.file(id)?;
        if view.projection().is_none() || f.materialized(view).is_some() {
            return Ok(self.columns_of(id, view)?.list.clone());
        }
        let query = view_query(f, view);
        check_clause(&self.conn, &f.src, &query)?;
        self.describe(&format!("SELECT * FROM ({query}\n)"), false, &[])
    }

    /// Creates `table` from `query` (see `materialize`) and returns its row
    /// count.
    fn create(&self, id: FileId, view: &View, table: &str, query: &str) -> AppResult<u64> {
        self.materialize(id, view, &format!("CREATE TEMP TABLE {table} AS {query}"))?;
        // `execute` reports 0 rows for CREATE TABLE AS, so count them.
        let total: i64 =
            self.conn
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))?;
        Ok(total as u64)
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

    /// `column`'s statistics from the Parquet footer, without a scan.
    /// `None` for nested columns, whose statistics belong to their leaf
    /// columns, and for files without row groups.
    pub fn footer_stats(&self, id: FileId, column: &str) -> AppResult<Option<FooterStats>> {
        let f = self.file(id)?;
        let i = column_index(&f.columns.list, column)?;
        if matches!(f.columns.kinds[i], Kind::Json) {
            return Ok(None);
        }
        // The footer values are text; compare them as the column's type.
        // A value counts only if every row group has it.
        let t = &f.columns.list[i].duckdb_type;
        let sql = format!(
            "SELECT count(*), \
             count(TRY_CAST(stats_min_value AS {t})), \
             CAST(min(TRY_CAST(stats_min_value AS {t})) AS VARCHAR), \
             count(TRY_CAST(stats_max_value AS {t})), \
             CAST(max(TRY_CAST(stats_max_value AS {t})) AS VARCHAR), \
             count(stats_null_count), CAST(sum(stats_null_count) AS BIGINT) \
             FROM parquet_metadata(?) WHERE path_in_schema = ?"
        );
        Ok(self
            .conn
            .query_row(&sql, [f.info.path.as_str(), column], |r| {
                let groups: i64 = r.get(0)?;
                let complete = |i: usize| r.get::<_, i64>(i).map(|n| n == groups);
                Ok((groups > 0).then_some(FooterStats {
                    min: if complete(1)? { r.get(2)? } else { None },
                    max: if complete(3)? { r.get(4)? } else { None },
                    null_count: if complete(5)? {
                        r.get::<_, Option<i64>>(6)?.map(|n| n as u64)
                    } else {
                        None
                    },
                }))
            })?)
    }

    /// Statistics of `column` over the rows of `view`. Scans the column,
    /// after materializing the view if it is not already.
    pub fn column_profile(
        &mut self,
        id: FileId,
        column: &str,
        view: &View,
    ) -> AppResult<ColumnProfile> {
        let (source, _) = self.source_for(id, view)?;
        let shown = self.columns_of(id, view)?;
        let kind = shown.kinds[column_index(&shown.list, column)?];
        let from = source.relation(&self.file(id)?.src);
        let q = quote_ident(column);

        let numeric_aggs = if kind.is_numeric() {
            format!(
                "CAST(avg({q}) AS DOUBLE), CAST(stddev_samp({q}) AS DOUBLE), \
                 CAST(min({q}) AS DOUBLE), CAST(max({q}) AS DOUBLE)"
            )
        } else {
            "NULL::DOUBLE, NULL::DOUBLE, NULL::DOUBLE, NULL::DOUBLE".into()
        };
        let (rows, non_null, min, max, mean, std_dev, low, high) = self.conn.query_row(
            &format!(
                "SELECT count(*), count({q}), CAST(min({q}) AS VARCHAR), \
                 CAST(max({q}) AS VARCHAR), {numeric_aggs} FROM {from}"
            ),
            [],
            |r| {
                Ok((
                    r.get::<_, i64>(0)? as u64,
                    r.get::<_, i64>(1)? as u64,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<f64>>(4)?,
                    r.get::<_, Option<f64>>(5)?,
                    r.get::<_, Option<f64>>(6)?,
                    r.get::<_, Option<f64>>(7)?,
                ))
            },
        )?;

        // Grouping by value gives the top values and the distinct count in
        // one pass.
        let mut distinct_count = 0;
        let mut stmt = self.conn.prepare(&format!(
            "SELECT CAST(v AS VARCHAR), n, count(*) OVER () FROM \
             (SELECT {q} AS v, count(*) AS n FROM {from} WHERE {q} IS NOT NULL GROUP BY {q}) \
             ORDER BY n DESC, v LIMIT {TOP_VALUES}"
        ))?;
        let top_values = stmt
            .query_map([], |r| {
                distinct_count = r.get::<_, i64>(2)? as u64;
                Ok(ValueCount {
                    value: r.get(0)?,
                    count: r.get::<_, i64>(1)? as u64,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let histogram = match low.zip(high) {
            Some((low, high)) if low.is_finite() && high.is_finite() => {
                self.histogram(&from, &q, kind, low, high, non_null)?
            }
            _ => Vec::new(),
        };

        Ok(ColumnProfile {
            rows,
            null_count: rows - non_null,
            distinct_count,
            min,
            max,
            mean: mean.filter(|v| v.is_finite()),
            std_dev: std_dev.filter(|v| v.is_finite()),
            top_values,
            histogram,
        })
    }

    /// Equal-width bins over `low..=high` for the numeric column `q`.
    /// Integers get at most one bin per value.
    fn histogram(
        &self,
        from: &str,
        q: &str,
        kind: Kind,
        low: f64,
        high: f64,
        non_null: u64,
    ) -> AppResult<Vec<Bin>> {
        if low == high {
            return Ok(vec![Bin {
                lower: low,
                upper: high,
                count: non_null,
            }]);
        }
        let (span, bins) = if kind.is_integer() {
            let span = high - low + 1.0;
            (span, span.min(HISTOGRAM_BINS as f64) as u64)
        } else {
            (high - low, HISTOGRAM_BINS)
        };
        let width = span / bins as f64;
        let mut counts = vec![0u64; bins as usize];
        let mut stmt = self.conn.prepare(&format!(
            "SELECT CAST(floor((CAST({q} AS DOUBLE) - ?) / ?) AS BIGINT), count(*) \
             FROM {from} WHERE {q} IS NOT NULL GROUP BY ALL"
        ))?;
        let rows = stmt.query_map(duckdb::params![low, width], |r| {
            Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)? as u64))
        })?;
        for row in rows {
            let (bin, count) = row?;
            // For floats, the maximum lands one past the last bin.
            counts[bin.clamp(0, bins as i64 - 1) as usize] += count;
        }
        Ok(counts
            .into_iter()
            .enumerate()
            .map(|(i, count)| Bin {
                lower: low + i as f64 * width,
                upper: low + (i + 1) as f64 * width,
                count,
            })
            .collect())
    }

    /// Writes `view` with the values of `columns` (indices into the schema)
    /// to a new file at `path`, as Parquet or CSV by its extension. Never
    /// writes over the open file itself.
    pub fn export(
        &mut self,
        id: FileId,
        view: &View,
        columns: &[usize],
        path: &str,
    ) -> AppResult<()> {
        let f = self.file(id)?;
        let extension = std::path::Path::new(path)
            .extension()
            .map(|e| e.to_string_lossy().to_ascii_lowercase());
        let options = match extension.as_deref() {
            Some("parquet") => "FORMAT parquet",
            Some("csv") => "FORMAT csv, HEADER true",
            _ => {
                return Err(AppError::Io(
                    "Choose a file name ending in .parquet or .csv".into(),
                ));
            }
        };
        let same_file = std::fs::canonicalize(path)
            .ok()
            .zip(std::fs::canonicalize(&f.info.path).ok())
            .is_some_and(|(a, b)| a == b);
        if same_file {
            return Err(AppError::Io(
                "Cannot export over the open file; choose another name".into(),
            ));
        }
        // A column list is exported from its materialized rows, the only
        // place its columns exist.
        let own = match view.projection() {
            Some(_) => Some(self.source_for(id, view)?.0),
            None => None,
        };
        let f = self.file(id)?;
        let shown = self.columns_of(id, view)?;
        let select = columns
            .iter()
            .map(|&i| {
                shown
                    .list
                    .get(i)
                    .map(|c| quote_ident(&c.name))
                    .ok_or_else(|| AppError::UnknownColumn(i.to_string()))
            })
            .collect::<AppResult<Vec<_>>>()?
            .join(", ");
        let query = match own {
            // The table holds the rows in view order.
            Some(Source::Materialized(table)) if shadows_rowid(&shown.list) => {
                format!("SELECT {select} FROM {table}")
            }
            Some(Source::Materialized(table)) => {
                format!("SELECT {select} FROM {table} ORDER BY rowid")
            }
            _ => {
                let query = format!("SELECT {select} FROM {} {}", f.src, view.clause.trim());
                check_clause(&self.conn, &f.src, &query)?;
                query
            }
        };
        // The newline ends a trailing `--` comment in the clause, which
        // would otherwise swallow the rest of the statement.
        self.conn.execute_batch(&format!(
            "COPY ({query}\n) TO {} ({options})",
            sql_string(path)
        ))?;
        Ok(())
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
    /// A table with all columns of the view.
    Materialized(String),
    /// A table with the view's `file_row_number`s.
    RowNumbers(String),
}

impl Source {
    /// The view's rows as a SQL relation, given the file's view `src`.
    fn relation(self, src: &str) -> String {
        match self {
            Source::File => src.to_string(),
            Source::Materialized(table) => table,
            Source::RowNumbers(table) => format!(
                "(SELECT * FROM {src} WHERE {FILE_ROW} IN (SELECT {FILE_ROW} FROM {table}))"
            ),
        }
    }
}

struct PhysicalColumn {
    name: String,
    physical_type: Option<String>,
    logical_type: Option<String>,
    nullable: bool,
}

const ONE_STATEMENT: &str = "Only a WHERE / ORDER BY clause is allowed, without `;`";

/// Parses and binds a query over `src` with the user's column list and
/// clause without running it, and rejects anything but exactly one SELECT.
/// This matters because duckdb-rs's `prepare` silently executes every
/// statement before the last, so `WHERE true; DROP …` would otherwise run.
/// Errors name the source `file`, as the query bar shows it. Returns whether
/// the query has an ORDER BY.
fn check_clause(conn: &Connection, src: &str, query: &str) -> AppResult<bool> {
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
    let sorted = parsed["statements"][0]["node"]["modifiers"]
        .as_array()
        .is_some_and(|m| m.iter().any(|m| m["type"] == "ORDER_MODIFIER"));
    Ok(sorted)
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

/// Parses a DuckDB memory setting such as `12.7 GiB` into bytes.
fn setting_bytes(setting: &str) -> Option<u64> {
    let (value, unit) = setting.trim().split_once(' ')?;
    let value: f64 = value.parse().ok()?;
    let power = ["bytes", "KiB", "MiB", "GiB", "TiB", "PiB"]
        .iter()
        .position(|u| *u == unit)?;
    Some((value * 1024f64.powi(power as i32)) as u64)
}

/// The query for `view` over the file: `SELECT … FROM {src} {clause}`.
fn view_query(f: &OpenFile, view: &View) -> String {
    let clause = view.clause.trim();
    match view.projection() {
        // The newline ends a trailing `--` comment in the column list.
        Some(select) => format!("SELECT {select}\nFROM {} {clause}", f.src),
        None => format!("SELECT * FROM {} {clause}", f.src),
    }
}

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn sql_string(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}

fn column_index(columns: &[Column], name: &str) -> AppResult<usize> {
    columns
        .iter()
        .position(|c| c.name == name)
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
    /// Fetched as text, like `Text`, but numeric.
    Decimal,
    /// Everything else (dates, timestamps, UUIDs, ...) as text.
    Text,
}

impl Kind {
    fn is_integer(self) -> bool {
        matches!(self, Kind::Int | Kind::BigInt)
    }

    fn is_numeric(self) -> bool {
        self.is_integer() || matches!(self, Kind::Float | Kind::Decimal)
    }
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
        _ if t.starts_with("DECIMAL") => Kind::Decimal,
        _ => Kind::Text,
    }
}

fn select_expr(col: &Column, kind: Kind) -> String {
    let q = format!("s.{}", quote_ident(&col.name));
    match kind {
        Kind::Bool | Kind::Int | Kind::Float | Kind::Blob => q,
        Kind::BigInt => format!("CAST({q} AS VARCHAR)"),
        Kind::Json => format!("CAST(to_json({q}) AS VARCHAR)"),
        // `2024-01-02 03:04:05+00` -> `2024-01-02T03:04:05+00` (ISO 8601).
        Kind::Text if col.duckdb_type.starts_with("TIMESTAMP") => {
            format!("replace(CAST({q} AS VARCHAR), ' ', 'T')")
        }
        Kind::Text | Kind::Decimal => format!("CAST({q} AS VARCHAR)"),
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
        Kind::Text | Kind::Decimal => row
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
        columns: Vec<usize>,
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
            engine.rows(id, offset, limit, &view, &columns)
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
