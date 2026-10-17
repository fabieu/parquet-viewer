use serde::{Deserialize, Serialize};

pub type FileId = u32;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileInfo {
    pub path: String,
    pub size_bytes: u64,
    pub row_count: u64,
    pub row_groups: u64,
    pub created_by: Option<String>,
    pub compression: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenedFile {
    pub file_id: FileId,
    pub info: FileInfo,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Column {
    pub name: String,
    pub duckdb_type: String,
    pub physical_type: Option<String>,
    pub logical_type: Option<String>,
    pub nullable: bool,
}

/// What the grid shows: the columns of `select`, such as `a, b * 2 AS c`
/// or `DISTINCT a` (all if empty), of the file filtered and ordered by
/// `clause`, a user-written SQL suffix such as `WHERE x > 1 ORDER BY y DESC`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    #[serde(default)]
    pub select: String,
    #[serde(default)]
    pub clause: String,
}

impl View {
    /// The column list, unless it selects every column as is.
    pub fn projection(&self) -> Option<&str> {
        let select = self.select.trim();
        (!select.is_empty() && select != "*").then_some(select)
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub offset: u64,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub total_rows: u64,
}

/// A column's statistics from the Parquet footer, combined over all row
/// groups. A value is `None` if any row group lacks it.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FooterStats {
    pub min: Option<String>,
    pub max: Option<String>,
    pub null_count: Option<u64>,
}

/// A column's statistics over the rows of a view, from a scan.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnProfile {
    pub rows: u64,
    pub null_count: u64,
    pub distinct_count: u64,
    pub min: Option<String>,
    pub max: Option<String>,
    /// Numeric columns only.
    pub mean: Option<f64>,
    pub std_dev: Option<f64>,
    /// The most frequent non-null values, most frequent first.
    pub top_values: Vec<ValueCount>,
    /// Equal-width bins from min to max; numeric columns only.
    pub histogram: Vec<Bin>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValueCount {
    pub value: String,
    pub count: u64,
}

/// Values in `lower..upper`; the last bin also holds `upper`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bin {
    pub lower: f64,
    pub upper: f64,
    pub count: u64,
}

#[derive(Debug, thiserror::Error, Serialize)]
#[serde(tag = "kind", content = "message")]
pub enum AppError {
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

pub type AppResult<T> = Result<T, AppError>;
