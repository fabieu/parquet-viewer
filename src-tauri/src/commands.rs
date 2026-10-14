use std::sync::Mutex;

use tauri::State;

use crate::db::Db;
use crate::model::{AppResult, Column, ColumnStats, FileId, OpenedFile, Page, View};

/// A file passed on the command line or through the OS "open with" event,
/// waiting for the UI to pick it up.
#[derive(Default)]
pub struct PendingOpen(pub Mutex<Option<String>>);

#[tauri::command]
pub async fn open_file(db: State<'_, Db>, path: String) -> AppResult<OpenedFile> {
    db.run(move |e| e.open(&path)).await
}

#[tauri::command]
pub async fn get_schema(db: State<'_, Db>, file_id: FileId) -> AppResult<Vec<Column>> {
    db.run(move |e| e.schema(file_id)).await
}

#[tauri::command]
pub async fn get_rows(
    db: State<'_, Db>,
    file_id: FileId,
    offset: u64,
    limit: u64,
    view: View,
    columns: Vec<usize>,
    seq: Option<u64>,
) -> AppResult<Page> {
    db.get_rows(file_id, seq, offset, limit, view, columns)
        .await
}

#[tauri::command]
pub async fn get_column_stats(
    db: State<'_, Db>,
    file_id: FileId,
    column: String,
) -> AppResult<ColumnStats> {
    db.run(move |e| e.column_stats(file_id, &column)).await
}

#[tauri::command]
pub async fn export_view(
    db: State<'_, Db>,
    file_id: FileId,
    view: View,
    columns: Vec<usize>,
    path: String,
) -> AppResult<()> {
    db.run(move |e| e.export(file_id, &view, &columns, &path))
        .await
}

#[tauri::command]
pub async fn close_file(db: State<'_, Db>, file_id: FileId) -> AppResult<()> {
    db.close(file_id).await
}

#[tauri::command]
pub fn take_pending_open(pending: State<'_, PendingOpen>) -> Option<String> {
    pending.0.lock().unwrap().take()
}
