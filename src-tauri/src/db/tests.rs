use super::*;
use std::path::Path;

/// Writes `select` to a Parquet file with DuckDB and returns its path.
fn fixture(dir: &Path, name: &str, select: &str) -> String {
    let path = dir.join(name);
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(&format!(
        "COPY ({select}) TO {} (FORMAT parquet, ROW_GROUP_SIZE 1000)",
        sql_string(path.to_str().unwrap())
    ))
    .unwrap();
    path.to_string_lossy().into_owned()
}

const ALL_TYPES: &str = "SELECT * FROM (VALUES
    (true, 1::TINYINT, 2::SMALLINT, 3::INTEGER, 42::BIGINT, 9007199254740993::BIGINT,
     170141183460469231731687303715884105727::HUGEINT, 18446744073709551615::UBIGINT,
     1.5::FLOAT, 2.25::DOUBLE, 123.45::DECIMAL(10,2), 'text', '\\x00\\xFF'::BLOB,
     DATE '2024-02-29', TIME '13:14:15', TIMESTAMP '2024-01-02 03:04:05.123456',
     TIMESTAMPTZ '2024-01-02 03:04:05+00', '0b1f9a0e-2c3d-4e5f-8a9b-0c1d2e3f4a5b'::UUID,
     [1, 2, 3], {'a': 1, 'b': 'x'}, MAP {'k': 1.5}, 'NaN'::DOUBLE),
    (NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
     NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)
) t(bool_col, tinyint_col, smallint_col, int_col, bigint_col, bigint_unsafe, hugeint_stored_as_double,
    ubigint_col, float_col, double_col, decimal_col, varchar_col, blob_col, date_col,
    time_col, ts_col, tstz_col, uuid_col, list_col, struct_col, map_col, nan_col)";

fn numbers(dir: &Path) -> String {
    fixture(
        dir,
        "numbers.parquet",
        "SELECT i AS id, i % 7 AS bucket, 'row ' || i AS label FROM range(5000) t(i)",
    )
}

fn engine() -> Engine {
    Engine::new().unwrap()
}

fn view(clause: &str) -> View {
    View {
        clause: clause.into(),
    }
}

fn ids(page: &Page) -> Vec<i64> {
    page.rows.iter().map(|r| r[0].as_i64().unwrap()).collect()
}

#[test]
fn opens_file_and_reads_metadata() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let opened = e.open(&path).unwrap();
    assert_eq!(opened.info.row_count, 5000);
    // DuckDB rounds ROW_GROUP_SIZE up to its 2048-row vector size.
    assert_eq!(opened.info.row_groups, 3);
    assert!(opened.info.size_bytes > 0);
    assert!(opened.info.created_by.is_some());

    let schema = e.schema(opened.file_id).unwrap();
    let names: Vec<_> = schema.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["id", "bucket", "label"]);
    assert_eq!(schema[0].duckdb_type, "BIGINT");
    assert_eq!(schema[0].physical_type.as_deref(), Some("INT64"));
}

#[test]
fn maps_every_type_to_json() {
    let dir = tempfile::tempdir().unwrap();
    let path = fixture(dir.path(), "types.parquet", ALL_TYPES);
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let schema = e.schema(id).unwrap();
    let page = e.rows(id, 0, 10, &View::default()).unwrap();
    assert_eq!(page.total_rows, 2);

    let named: Vec<serde_json::Map<String, Json>> = page
        .rows
        .iter()
        .map(|row| {
            schema
                .iter()
                .map(|c| c.name.clone())
                .zip(row.iter().cloned())
                .collect()
        })
        .collect();
    insta::assert_json_snapshot!("all_types_rows", named);
    let types: Vec<_> = schema.iter().map(|c| (&c.name, &c.duckdb_type)).collect();
    insta::assert_json_snapshot!("all_types_schema", types);
}

#[test]
fn pages_through_unsorted_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let page = e.rows(id, 2500, 3, &View::default()).unwrap();
    assert_eq!(ids(&page), [2500, 2501, 2502]);
    let tail = e.rows(id, 4998, 500, &View::default()).unwrap();
    assert_eq!(ids(&tail), [4998, 4999]);
}

#[test]
fn sorts_and_filters() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;

    let desc = e.rows(id, 0, 3, &view("ORDER BY id DESC")).unwrap();
    assert_eq!(ids(&desc), [4999, 4998, 4997]);
    assert_eq!(desc.total_rows, 5000);

    // A filter on one column plus ORDER BY another used to trip a
    // DuckDB compressed-materialization assertion; see Engine::new.
    let v = view("WHERE bucket = 3 AND id >= 100 ORDER BY id");
    let page = e.rows(id, 0, 3, &v).unwrap();
    assert_eq!(ids(&page), [101, 108, 115]);
    let expected = (100..5000).filter(|i| i % 7 == 3).count() as u64;
    assert_eq!(page.total_rows, expected);
    let deep = e.rows(id, expected - 1, 10, &v).unwrap();
    assert_eq!(deep.rows.len(), 1);

    // Without ORDER BY, rows keep file order.
    let contains = e
        .rows(id, 0, 100, &view("WHERE label ILIKE '%row 499%'"))
        .unwrap();
    assert_eq!(
        ids(&contains),
        [
            499, 4990, 4991, 4992, 4993, 4994, 4995, 4996, 4997, 4998, 4999
        ]
    );
}

#[test]
fn invalid_sql_fails_and_keeps_the_previous_view() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let good = view("WHERE id < 3 ORDER BY id DESC");
    e.rows(id, 0, 10, &good).unwrap();

    for bad in ["WHERE", "WHERE nope = 1", "ORDER BY", "id > 1"] {
        let err = e.rows(id, 0, 10, &view(bad)).unwrap_err();
        assert!(matches!(err, AppError::QueryFailed(_)), "{bad}: {err:?}");
    }
    let err = e.rows(id, 0, 10, &view("WHERE nope = 1")).unwrap_err();
    let AppError::QueryFailed(message) = err else {
        unreachable!()
    };
    assert!(
        message.contains("SELECT * FROM file  WHERE nope = 1"),
        "{message}"
    );
    assert!(!message.contains("src_"), "{message}");
    // The last valid view is still materialized.
    assert_eq!(e.files[&id].view.as_ref().unwrap().key, good);
    assert_eq!(ids(&e.rows(id, 0, 10, &good).unwrap()), [2, 1, 0]);
}

#[test]
fn rejects_multiple_statements() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    for bad in [
        "WHERE true; DROP VIEW src_1",
        "WHERE true; SELECT 1",
        "WHERE true; COPY (SELECT 1) TO 'x.csv'",
    ] {
        let err = e.rows(id, 0, 10, &view(bad)).unwrap_err();
        assert!(matches!(err, AppError::QueryFailed(_)), "{bad}: {err:?}");
    }
    assert_eq!(e.rows(id, 0, 1, &View::default()).unwrap().rows.len(), 1);
}

#[test]
fn reports_missing_and_non_parquet_files() {
    let dir = tempfile::tempdir().unwrap();
    let mut e = engine();
    let missing = dir.path().join("missing.parquet");
    assert!(matches!(
        e.open(missing.to_str().unwrap()),
        Err(AppError::FileNotFound(_))
    ));

    let text = dir.path().join("notes.parquet");
    std::fs::write(&text, "definitely not parquet").unwrap();
    assert!(matches!(
        e.open(text.to_str().unwrap()),
        Err(AppError::NotParquet(_))
    ));
}

#[test]
fn reads_every_codec_duckdb_writes() {
    let dir = tempfile::tempdir().unwrap();
    for (option, codec) in [
        ("uncompressed", "UNCOMPRESSED"),
        ("snappy", "SNAPPY"),
        ("gzip", "GZIP"),
        ("brotli", "BROTLI"),
        ("zstd", "ZSTD"),
        ("lz4_raw", "LZ4_RAW"),
    ] {
        let path = dir.path().join(format!("{option}.parquet"));
        Connection::open_in_memory()
            .unwrap()
            .execute_batch(&format!(
                "COPY (SELECT i AS id FROM range(100) t(i)) TO {}                  (FORMAT parquet, COMPRESSION '{option}')",
                sql_string(path.to_str().unwrap())
            ))
            .unwrap();
        let mut e = engine();
        let opened = e.open(path.to_str().unwrap()).unwrap();
        assert_eq!(opened.info.compression, [codec]);
        let page = e.rows(opened.file_id, 98, 10, &View::default()).unwrap();
        assert_eq!(ids(&page), [98, 99], "{codec}");
    }
}

#[test]
fn rejects_codecs_duckdb_cannot_read() {
    // From apache/parquet-testing: the deprecated, Hadoop-framed LZ4 codec.
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/src/db/testdata/hadoop_lz4_compressed.parquet"
    );
    let err = engine().open(path).unwrap_err();
    assert!(
        matches!(&err, AppError::UnsupportedCompression(c) if c == "LZ4"),
        "{err:?}"
    );
}

#[test]
fn handles_quotes_in_paths_and_names() {
    let dir = tempfile::tempdir().unwrap();
    let path = fixture(
        dir.path(),
        "it's here.parquet",
        "SELECT 1 AS \"we\"\"ird col\", 2 AS file_row_number",
    );
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let schema = e.schema(id).unwrap();
    assert_eq!(schema[0].name, "we\"ird col");
    assert_eq!(schema[1].name, "file_row_number");
    let page = e
        .rows(id, 0, 10, &view("ORDER BY \"we\"\"ird col\" DESC"))
        .unwrap();
    assert_eq!(page.rows, vec![vec![Json::from(1), Json::from(2)]]);
}

#[test]
fn computes_column_stats() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let stats = e.column_stats(id, "bucket").unwrap();
    assert_eq!(stats.min.as_deref(), Some("0"));
    assert_eq!(stats.max.as_deref(), Some("6"));
    assert_eq!(stats.null_count, 0);
}

#[test]
fn spills_to_the_os_temp_directory() {
    let e = engine();
    let dir: String = e
        .conn
        .query_row("SELECT current_setting('temp_directory')", [], |r| r.get(0))
        .unwrap();
    assert!(dir.ends_with("parquet-viewer-duckdb"), "{dir}");
}

#[test]
fn close_releases_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    e.rows(id, 0, 1, &view("ORDER BY id DESC")).unwrap();
    e.close(id).unwrap();
    assert!(matches!(e.schema(id), Err(AppError::UnknownFile(_))));
}

#[test]
fn worker_skips_superseded_requests() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let db = Db::start().unwrap();
    tauri::async_runtime::block_on(async {
        let id = db.run(move |e| e.open(&path)).await.unwrap().file_id;
        // Hold the worker busy so both requests queue up behind it.
        let (release, wait) = std::sync::mpsc::channel::<()>();
        let busy = db.run(move |_| {
            wait.recv().ok();
            Ok(())
        });
        // join! polls in order, so both requests are queued before release.
        let old = db.get_rows(id, Some(1), 0, 10, View::default());
        let new = db.get_rows(id, Some(2), 10, 10, View::default());
        let copy = db.get_rows(id, None, 20, 10, View::default());
        let (busy, old, new, copy, ()) = tokio::join!(busy, old, new, copy, async {
            release.send(()).unwrap();
        });
        busy.unwrap();
        assert!(matches!(old, Err(AppError::Cancelled)));
        assert_eq!(ids(&new.unwrap())[0], 10);
        assert_eq!(ids(&copy.unwrap())[0], 20);
    });
}

#[test]
fn pages_sorted_view_with_a_rowid_column() {
    let dir = tempfile::tempdir().unwrap();
    let path = fixture(
        dir.path(),
        "rowid.parquet",
        "SELECT i AS id, 100 - i AS rowid FROM range(10) t(i)",
    );
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let page = e.rows(id, 2, 3, &view("ORDER BY id DESC")).unwrap();
    assert_eq!(ids(&page), [7, 6, 5]);
}

/// Timing check for the plan's performance gates. Run with
/// `cargo test bench_large_file -- --ignored --nocapture`; set
/// `PV_BENCH_ROWS` to change the size (default 100M rows).
#[test]
#[ignore]
fn bench_large_file() {
    use std::time::Instant;
    let rows: u64 = std::env::var("PV_BENCH_ROWS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(100_000_000);
    let path = std::env::temp_dir().join(format!("pv-bench-{rows}.parquet"));
    if !path.exists() {
        // Unlike `fixture`, keep DuckDB's default (realistic) row group size.
        let t = Instant::now();
        Connection::open_in_memory()
            .unwrap()
            .execute_batch(&format!(
                "COPY (SELECT i AS id, (i * 7919) % 1000003 AS scrambled, random() AS value, \
                 'row ' || i AS label, TIMESTAMP '2020-01-01' + to_seconds(i) AS ts \
                 FROM range({rows}) t(i)) TO {} (FORMAT parquet)",
                sql_string(path.to_str().unwrap())
            ))
            .unwrap();
        println!("generated {} in {:?}", path.display(), t.elapsed());
    }
    let size = std::fs::metadata(&path).unwrap().len();
    println!("file: {rows} rows, {:.2} GB", size as f64 / 1e9);

    let mut e = engine();
    let t = Instant::now();
    let id = e.open(path.to_str().unwrap()).unwrap().file_id;
    e.schema(id).unwrap();
    println!("open + schema: {:?}", t.elapsed());

    let unsorted = View::default();
    for offset in [0, rows / 2, rows - 500] {
        let t = Instant::now();
        let page = e.rows(id, offset, 500, &unsorted).unwrap();
        assert_eq!(page.rows[0][0].as_i64().unwrap() as u64, offset);
        println!("unsorted page @ {offset}: {:?}", t.elapsed());
    }

    let sorted = view("ORDER BY scrambled DESC");
    let t = Instant::now();
    e.rows(id, 0, 500, &sorted).unwrap();
    println!("first sorted page (materialize): {:?}", t.elapsed());
    for offset in [0, rows / 2, rows - 500] {
        let t = Instant::now();
        e.rows(id, offset, 500, &sorted).unwrap();
        println!("sorted page @ {offset}: {:?}", t.elapsed());
    }

    let filtered = view("WHERE contains(label, '99')");
    let t = Instant::now();
    let page = e.rows(id, 0, 500, &filtered).unwrap();
    println!(
        "first filtered page: {:?} ({} matches)",
        t.elapsed(),
        page.total_rows
    );
}
