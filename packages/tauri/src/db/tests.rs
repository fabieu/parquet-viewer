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
        ..View::default()
    }
}

fn projected(select: &str, clause: &str) -> View {
    View {
        select: select.into(),
        clause: clause.into(),
    }
}

/// Rows of `view` with every column.
fn all_rows(e: &mut Engine, id: FileId, offset: u64, limit: u64, view: &View) -> AppResult<Page> {
    let all: Vec<usize> = (0..e.files[&id].columns.exprs.len()).collect();
    e.rows(id, offset, limit, view, &all)
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
fn lists_functions_for_autocomplete() {
    let names = engine().functions().unwrap();
    for name in ["abs", "count", "lower", "strftime"] {
        assert!(names.iter().any(|n| n == name), "missing {name}");
    }
    assert!(
        names
            .iter()
            .all(|n| !n.starts_with('_') && !n.contains('+'))
    );
    assert!(names.windows(2).all(|w| w[0] < w[1]));
}

#[test]
fn maps_every_type_to_json() {
    let dir = tempfile::tempdir().unwrap();
    let path = fixture(dir.path(), "types.parquet", ALL_TYPES);
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let schema = e.schema(id).unwrap();
    let page = all_rows(&mut e, id, 0, 10, &View::default()).unwrap();
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
    let page = all_rows(&mut e, id, 2500, 3, &View::default()).unwrap();
    assert_eq!(ids(&page), [2500, 2501, 2502]);
    let tail = all_rows(&mut e, id, 4998, 500, &View::default()).unwrap();
    assert_eq!(ids(&tail), [4998, 4999]);
}

#[test]
fn sorts_and_filters() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;

    let desc = all_rows(&mut e, id, 0, 3, &view("ORDER BY id DESC")).unwrap();
    assert_eq!(ids(&desc), [4999, 4998, 4997]);
    assert_eq!(desc.total_rows, 5000);

    // A filter on one column plus ORDER BY another used to trip a
    // DuckDB compressed-materialization assertion; see Engine::new.
    let v = view("WHERE bucket = 3 AND id >= 100 ORDER BY id");
    let page = all_rows(&mut e, id, 0, 3, &v).unwrap();
    assert_eq!(ids(&page), [101, 108, 115]);
    let expected = (100..5000).filter(|i| i % 7 == 3).count() as u64;
    assert_eq!(page.total_rows, expected);
    let deep = all_rows(&mut e, id, expected - 1, 10, &v).unwrap();
    assert_eq!(deep.rows.len(), 1);

    // Without ORDER BY, rows keep file order.
    let contains = all_rows(&mut e, id, 0, 100, &view("WHERE label ILIKE '%row 499%'")).unwrap();
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
    all_rows(&mut e, id, 0, 10, &good).unwrap();

    for bad in ["WHERE", "WHERE nope = 1", "ORDER BY", "id > 1"] {
        let err = all_rows(&mut e, id, 0, 10, &view(bad)).unwrap_err();
        assert!(matches!(err, AppError::QueryFailed(_)), "{bad}: {err:?}");
    }
    let err = all_rows(&mut e, id, 0, 10, &view("WHERE nope = 1")).unwrap_err();
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
    assert_eq!(ids(&all_rows(&mut e, id, 0, 10, &good).unwrap()), [2, 1, 0]);
}

#[test]
fn computes_projected_columns() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    // Aliases work in WHERE and ORDER BY; a duplicate name gets a suffix.
    let v = projected(
        "id, id * 2 AS double, label, id",
        "WHERE double < 8 ORDER BY double DESC",
    );
    let schema = e.view_schema(id, &v).unwrap();
    let names: Vec<_> = schema.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["id", "double", "label", "id_1"]);
    assert_eq!(schema[1].duckdb_type, "BIGINT");
    // Reading the schema runs nothing.
    assert!(e.files[&id].view.is_none());

    let page = e.rows(id, 0, 10, &v, &[3, 1, 2]).unwrap();
    assert_eq!(page.total_rows, 4);
    assert_eq!(
        page.rows,
        [
            vec![
                serde_json::json!(3),
                serde_json::json!(6),
                serde_json::json!("row 3")
            ],
            vec![
                serde_json::json!(2),
                serde_json::json!(4),
                serde_json::json!("row 2")
            ],
            vec![
                serde_json::json!(1),
                serde_json::json!(2),
                serde_json::json!("row 1")
            ],
            vec![
                serde_json::json!(0),
                serde_json::json!(0),
                serde_json::json!("row 0")
            ],
        ]
    );
    // Once materialized, the schema comes from the table.
    assert_eq!(e.view_schema(id, &v).unwrap().len(), 4);
    let err = e.rows(id, 0, 10, &v, &[4]).unwrap_err();
    assert!(matches!(err, AppError::UnknownColumn(_)), "{err:?}");
}

#[test]
fn selects_distinct_values_and_profiles_them() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    // A column list without a clause, and `*`, which is no column list.
    let v = projected("DISTINCT bucket", "");
    assert_eq!(e.rows(id, 0, 100, &v, &[0]).unwrap().total_rows, 7);
    let sorted = projected("DISTINCT bucket % 3 AS b", "ORDER BY b");
    assert_eq!(ids(&e.rows(id, 0, 10, &sorted, &[0]).unwrap()), [0, 1, 2]);
    let profile = e.column_profile(id, "b", &sorted).unwrap();
    assert_eq!((profile.rows, profile.distinct_count), (3, 3));
    let all = projected(" * ", "WHERE id < 2");
    assert_eq!(e.view_schema(id, &all).unwrap().len(), 3);
    assert_eq!(all_rows(&mut e, id, 0, 10, &all).unwrap().total_rows, 2);
}

#[test]
fn rejects_bad_column_lists() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let side = dir.path().join("side.csv");
    let copy = format!(
        "1; COPY (SELECT 1) TO {} --",
        sql_string(side.to_str().unwrap())
    );
    for bad in ["nope", "id +", "1; DROP VIEW src_1", copy.as_str()] {
        let v = projected(bad, "");
        let err = e.view_schema(id, &v).unwrap_err();
        assert!(matches!(err, AppError::QueryFailed(_)), "{bad}: {err:?}");
        let err = e.rows(id, 0, 1, &v, &[0]).unwrap_err();
        assert!(matches!(err, AppError::QueryFailed(_)), "{bad}: {err:?}");
    }
    assert!(!side.exists());
    // A trailing comment in the column list does not swallow the FROM.
    let v = projected("id -- the id", "WHERE id = 7");
    assert_eq!(ids(&e.rows(id, 0, 10, &v, &[0]).unwrap()), [7]);
    let AppError::QueryFailed(message) = e.view_schema(id, &projected("nope", "")).unwrap_err()
    else {
        unreachable!()
    };
    assert!(!message.contains("src_"), "{message}");
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
        let err = all_rows(&mut e, id, 0, 10, &view(bad)).unwrap_err();
        assert!(matches!(err, AppError::QueryFailed(_)), "{bad}: {err:?}");
    }
    assert_eq!(
        all_rows(&mut e, id, 0, 1, &View::default())
            .unwrap()
            .rows
            .len(),
        1
    );
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
        let page = all_rows(&mut e, opened.file_id, 98, 10, &View::default()).unwrap();
        assert_eq!(ids(&page), [98, 99], "{codec}");
    }
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
    let page = all_rows(&mut e, id, 0, 10, &view("ORDER BY \"we\"\"ird col\" DESC")).unwrap();
    assert_eq!(page.rows, vec![vec![Json::from(1), Json::from(2)]]);
}

#[test]
fn reads_footer_stats() {
    let dir = tempfile::tempdir().unwrap();
    let path = fixture(
        dir.path(),
        "footer.parquet",
        "SELECT i AS id, CASE WHEN i % 10 <> 0 THEN 'row ' || i END AS label, [i] AS list          FROM range(5000) t(i)",
    );
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let stats = e.footer_stats(id, "id").unwrap().unwrap();
    assert_eq!(stats.min.as_deref(), Some("0"));
    // Compared as numbers across row groups, not as text.
    assert_eq!(stats.max.as_deref(), Some("4999"));
    assert_eq!(stats.null_count, Some(0));
    let stats = e.footer_stats(id, "label").unwrap().unwrap();
    assert_eq!(stats.min.as_deref(), Some("row 1"));
    assert_eq!(stats.max.as_deref(), Some("row 999"));
    assert_eq!(stats.null_count, Some(500));
    assert!(e.footer_stats(id, "list").unwrap().is_none());
    assert!(matches!(
        e.footer_stats(id, "nope"),
        Err(AppError::UnknownColumn(_))
    ));
}

#[test]
fn profiles_a_column() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let p = e.column_profile(id, "bucket", &View::default()).unwrap();
    assert_eq!((p.rows, p.null_count, p.distinct_count), (5000, 0, 7));
    assert_eq!(p.min.as_deref(), Some("0"));
    assert_eq!(p.max.as_deref(), Some("6"));
    assert!((p.mean.unwrap() - 2.999).abs() < 1e-9);
    assert!(p.std_dev.unwrap() > 0.0);
    let top: Vec<_> = p
        .top_values
        .iter()
        .map(|v| (v.value.as_str(), v.count))
        .collect();
    assert_eq!(
        top,
        [("0", 715), ("1", 715), ("2", 714), ("3", 714), ("4", 714)]
    );
    // Integers get one bin per value while there are few values.
    let bins: Vec<_> = p
        .histogram
        .iter()
        .map(|b| (b.lower, b.upper, b.count))
        .collect();
    assert_eq!(bins[0], (0.0, 1.0, 715));
    assert_eq!(bins[6], (6.0, 7.0, 714));
    assert_eq!(bins.len(), 7);

    let p = e.column_profile(id, "id", &View::default()).unwrap();
    assert_eq!(p.histogram.len(), 20);
    assert!(p.histogram.iter().all(|b| b.count == 250));

    let p = e.column_profile(id, "label", &View::default()).unwrap();
    assert_eq!(p.distinct_count, 5000);
    assert!(p.mean.is_none() && p.histogram.is_empty());
}

#[test]
fn profiles_the_current_view() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    // A filter keeps row numbers, a sort copies all columns.
    for clause in [
        "WHERE id < 10 AND bucket <> 3",
        "WHERE id < 10 ORDER BY id DESC",
    ] {
        let p = e.column_profile(id, "id", &view(clause)).unwrap();
        assert_eq!(p.min.as_deref(), Some("0"), "{clause}");
        assert_eq!(p.max.as_deref(), Some("9"), "{clause}");
        assert_eq!(p.histogram.iter().map(|b| b.count).sum::<u64>(), p.rows);
    }
    let p = e
        .column_profile(id, "id", &view("WHERE id < 10 AND bucket <> 3"))
        .unwrap();
    assert_eq!((p.rows, p.distinct_count), (9, 9));
    let p = e.column_profile(id, "id", &view("WHERE false")).unwrap();
    assert_eq!((p.rows, p.distinct_count), (0, 0));
    assert!(p.min.is_none() && p.mean.is_none() && p.histogram.is_empty());
    assert!(matches!(
        e.column_profile(id, "id", &view("WHERE nope")),
        Err(AppError::QueryFailed(_))
    ));
}

#[test]
fn profiles_every_type() {
    let dir = tempfile::tempdir().unwrap();
    let path = fixture(dir.path(), "types.parquet", ALL_TYPES);
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let profiles: serde_json::Map<String, Json> = e
        .schema(id)
        .unwrap()
        .iter()
        .map(|c| {
            let footer = e.footer_stats(id, &c.name).unwrap();
            let profile = e.column_profile(id, &c.name, &View::default()).unwrap();
            let value = serde_json::json!({ "footer": footer, "profile": profile });
            (c.name.clone(), value)
        })
        .collect();
    insta::assert_json_snapshot!("all_types_profiles", profiles);
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
    all_rows(&mut e, id, 0, 1, &view("ORDER BY id DESC")).unwrap();
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
        let old = db.get_rows(id, Some(1), 0, 10, View::default(), vec![0]);
        let new = db.get_rows(id, Some(2), 10, 10, View::default(), vec![0]);
        let copy = db.get_rows(id, None, 20, 10, View::default(), vec![0]);
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
    let page = all_rows(&mut e, id, 2, 3, &view("ORDER BY id DESC")).unwrap();
    assert_eq!(ids(&page), [7, 6, 5]);

    e.full_copy_budget = 0;
    let page = all_rows(&mut e, id, 2, 3, &view("WHERE true ORDER BY id DESC")).unwrap();
    assert!(e.files[&id].view.as_ref().unwrap().row_numbers);
    assert_eq!(page.rows[0], [Json::from(7), Json::from(93)]);
    assert_eq!(ids(&page), [7, 6, 5]);
}

#[test]
fn keeps_row_numbers_for_filters_and_large_sorts() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let row_numbers = |e: &Engine| e.files[&id].view.as_ref().unwrap().row_numbers;

    // Filters keep file order, so they only ever store row numbers.
    let page = all_rows(&mut e, id, 1, 3, &view("WHERE bucket = 3")).unwrap();
    assert_eq!(ids(&page), [10, 17, 24]);
    assert!(row_numbers(&e));

    // Sorts are copied in full while the estimate fits the budget...
    all_rows(&mut e, id, 0, 1, &view("ORDER BY id DESC")).unwrap();
    assert!(!row_numbers(&e));

    // ...including filtered sorts whose result fits, though the file does not.
    e.full_copy_budget = e.files[&id].uncompressed_bytes / 2;
    let v = view("WHERE bucket = 3 ORDER BY id DESC");
    assert_eq!(ids(&all_rows(&mut e, id, 0, 2, &v).unwrap()), [4994, 4987]);
    assert!(!row_numbers(&e));
    all_rows(&mut e, id, 0, 1, &view("ORDER BY id")).unwrap();
    assert!(row_numbers(&e));

    // Pages of row numbers come back in view order, across row groups.
    e.full_copy_budget = 0;
    let v = view("WHERE bucket = 3 ORDER BY id % 2, id DESC");
    let page = all_rows(&mut e, id, 0, 1000, &v).unwrap();
    assert!(row_numbers(&e));
    let mut expected: Vec<i64> = (0..5000).filter(|i| i % 7 == 3).collect();
    expected.sort_by_key(|i| (i % 2, -i));
    assert_eq!(page.total_rows, expected.len() as u64);
    assert_eq!(ids(&page), expected);
    let deep = all_rows(&mut e, id, 400, 5, &v).unwrap();
    assert_eq!(ids(&deep), expected[400..405]);
}

#[test]
fn returns_only_the_requested_columns() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let page = e.rows(id, 7, 1, &View::default(), &[2, 0]).unwrap();
    assert_eq!(page.rows, [[Json::from("row 7"), Json::from(7)]]);

    // Without columns the rows are empty, but the row count still loads.
    let page = e.rows(id, 0, 2, &view("WHERE bucket = 3"), &[]).unwrap();
    assert_eq!(page.rows, [[], []] as [[Json; 0]; 2]);
    assert_eq!(page.total_rows, 714);

    let err = e.rows(id, 0, 1, &View::default(), &[3]).unwrap_err();
    assert!(matches!(err, AppError::UnknownColumn(_)), "{err:?}");
}

#[test]
fn exports_the_view_as_csv() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let out = dir.path().join("out.csv");
    let out = out.to_str().unwrap();
    // A trailing line comment must not swallow the rest of the COPY.
    let v = view("WHERE id < 30 AND bucket = 3 ORDER BY id DESC -- newest first");
    e.export(id, &v, &[2, 0], out).unwrap();
    let csv = std::fs::read_to_string(out).unwrap();
    assert_eq!(
        csv.lines().collect::<Vec<_>>(),
        ["label,id", "row 24,24", "row 17,17", "row 10,10", "row 3,3"]
    );
}

#[test]
fn exports_the_view_as_parquet() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let out = dir.path().join("out.parquet");
    let out = out.to_str().unwrap();
    e.export(id, &view("WHERE bucket = 3"), &[0, 1], out)
        .unwrap();

    let opened = e.open(out).unwrap();
    assert_eq!(opened.info.row_count, 714);
    let names: Vec<_> = e
        .schema(opened.file_id)
        .unwrap()
        .into_iter()
        .map(|c| c.name)
        .collect();
    assert_eq!(names, ["id", "bucket"]);
    let page = all_rows(&mut e, opened.file_id, 0, 2, &View::default()).unwrap();
    assert_eq!(ids(&page), [3, 10]);
}

#[test]
fn exports_projected_columns_in_view_order() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let out = dir.path().join("out.csv");
    let out = out.to_str().unwrap();
    let v = projected("id * 10 AS tens, label", "WHERE id < 3 ORDER BY id DESC");
    e.export(id, &v, &[1, 0], out).unwrap();
    let csv = std::fs::read_to_string(out).unwrap();
    assert_eq!(
        csv.lines().collect::<Vec<_>>(),
        ["label,tens", "row 2,20", "row 1,10", "row 0,0"]
    );
}

#[test]
fn export_never_overwrites_the_open_file_or_runs_other_statements() {
    let dir = tempfile::tempdir().unwrap();
    let path = numbers(dir.path());
    let mut e = engine();
    let id = e.open(&path).unwrap().file_id;
    let before = std::fs::read(&path).unwrap();
    let err = e.export(id, &View::default(), &[0], &path).unwrap_err();
    assert!(matches!(err, AppError::Io(_)), "{err:?}");
    let txt = dir.path().join("out.txt");
    let err = e
        .export(id, &View::default(), &[0], txt.to_str().unwrap())
        .unwrap_err();
    assert!(matches!(err, AppError::Io(_)) && !txt.exists(), "{err:?}");

    let side = dir.path().join("side.csv");
    let bad = format!(
        "WHERE true; COPY (SELECT 1) TO {}",
        sql_string(side.to_str().unwrap())
    );
    let out = dir.path().join("out.csv");
    let err = e
        .export(id, &view(&bad), &[0], out.to_str().unwrap())
        .unwrap_err();
    assert!(matches!(err, AppError::QueryFailed(_)), "{err:?}");
    assert!(!side.exists() && !out.exists());
    assert_eq!(std::fs::read(&path).unwrap(), before);
}

#[test]
fn parses_memory_settings() {
    assert_eq!(setting_bytes("1.5 KiB"), Some(1536));
    assert_eq!(setting_bytes("2.0 GiB"), Some(2 << 30));
    assert_eq!(setting_bytes("512 bytes"), Some(512));
    assert_eq!(setting_bytes("lots"), None);
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
        let page = all_rows(&mut e, id, offset, 500, &unsorted).unwrap();
        assert_eq!(page.rows[0][0].as_i64().unwrap() as u64, offset);
        println!("unsorted page @ {offset}: {:?}", t.elapsed());
    }

    let sorted = view("ORDER BY scrambled DESC");
    let t = Instant::now();
    all_rows(&mut e, id, 0, 500, &sorted).unwrap();
    println!("first sorted page (materialize): {:?}", t.elapsed());
    for offset in [0, rows / 2, rows - 500] {
        let t = Instant::now();
        all_rows(&mut e, id, offset, 500, &sorted).unwrap();
        println!("sorted page @ {offset}: {:?}", t.elapsed());
    }

    // Force the row-number mode used for sorts over the copy budget.
    e.full_copy_budget = 0;
    let sorted = view("ORDER BY scrambled");
    let t = Instant::now();
    all_rows(&mut e, id, 0, 500, &sorted).unwrap();
    println!("first sorted page (row numbers): {:?}", t.elapsed());
    for offset in [rows / 2, rows - 500] {
        let t = Instant::now();
        all_rows(&mut e, id, offset, 500, &sorted).unwrap();
        println!("sorted page @ {offset} (row numbers): {:?}", t.elapsed());
    }

    let filtered = view("WHERE contains(label, '99')");
    let t = Instant::now();
    let page = all_rows(&mut e, id, 0, 500, &filtered).unwrap();
    println!(
        "first filtered page: {:?} ({} matches)",
        t.elapsed(),
        page.total_rows
    );
}
