use serde::{Deserialize, Serialize};

pub(crate) type FileId = u32;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileInfo {
    pub(crate) path: String,
    pub(crate) size_bytes: u64,
    pub(crate) row_count: u64,
    pub(crate) row_groups: u64,
    pub(crate) created_by: Option<String>,
    pub(crate) compression: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenedFile {
    pub(crate) file_id: FileId,
    pub(crate) info: FileInfo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Column {
    pub(crate) name: String,
    pub(crate) duckdb_type: String,
    pub(crate) physical_type: Option<String>,
    pub(crate) logical_type: Option<String>,
    pub(crate) nullable: bool,
}

/// What the grid shows: the columns of `select`, such as `a, b * 2 AS c`
/// or `DISTINCT a` (all if empty), of the file filtered and ordered by
/// `clause`, a user-written SQL suffix such as `WHERE x > 1 ORDER BY y DESC`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct View {
    #[serde(default)]
    pub(crate) select: String,
    #[serde(default)]
    pub(crate) clause: String,
}

impl View {
    /// The column list, unless it selects every column as is.
    pub(crate) fn projection(&self) -> Option<&str> {
        let select = self.select.trim();
        (!select.is_empty() && select != "*").then_some(select)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Page {
    pub(crate) offset: u64,
    pub(crate) rows: Vec<Vec<serde_json::Value>>,
    pub(crate) total_rows: u64,
}

/// A column's statistics from the Parquet footer, combined over all row
/// groups. A value is `None` if any row group lacks it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FooterStats {
    pub(crate) min: Option<String>,
    pub(crate) max: Option<String>,
    pub(crate) null_count: Option<u64>,
}

/// A column's statistics over the rows of a view, from a scan.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ColumnProfile {
    pub(crate) rows: u64,
    pub(crate) null_count: u64,
    pub(crate) distinct_count: u64,
    pub(crate) min: Option<String>,
    pub(crate) max: Option<String>,
    /// Numeric columns only.
    pub(crate) mean: Option<f64>,
    pub(crate) std_dev: Option<f64>,
    /// The most frequent non-null values, most frequent first.
    pub(crate) top_values: Vec<ValueCount>,
    /// Equal-width bins from min to max; numeric columns only.
    pub(crate) histogram: Vec<Bin>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ValueCount {
    pub(crate) value: String,
    pub(crate) count: u64,
}

/// Values in `lower..upper`; the last bin also holds `upper`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Bin {
    pub(crate) lower: f64,
    pub(crate) upper: f64,
    pub(crate) count: u64,
}

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub(crate) enum AppError {
    #[error("File not found: {0}")]
    FileNotFound(String),
    #[error("Not a Parquet file: {0}")]
    NotParquet(String),
    #[error("Unsupported compression codec: {0}")]
    UnsupportedCompression(String),
    #[error("Query failed: {0}")]
    QueryFailed(String),
    #[error("Unknown file id {0}")]
    UnknownFile(FileId),
    #[error("Unknown column: {0}")]
    UnknownColumn(String),
    #[error("Request was superseded by a newer one")]
    Cancelled,
    #[error("I/O error: {0}")]
    Io(String),
}

impl From<duckdb::Error> for AppError {
    fn from(e: duckdb::Error) -> Self {
        AppError::QueryFailed(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

pub(crate) type AppResult<T> = Result<T, AppError>;
