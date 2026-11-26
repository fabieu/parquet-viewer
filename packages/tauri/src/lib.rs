mod commands;
mod db;
mod model;

use commands::PendingOpen;
#[cfg(any(target_os = "macos", target_os = "ios"))]
use tauri::Emitter;
use tauri::Manager;

/// Starts DuckDB and runs the app until it exits.
///
/// # Panics
///
/// Panics if DuckDB or the Tauri app fails to start.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = db::Db::start().expect("failed to start DuckDB");
    // Windows and Linux pass a double-clicked file as the first argument.
    let launch_path = std::env::args().skip(1).find(|a| !a.starts_with('-'));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(db)
        .manage(PendingOpen::new(launch_path))
        .setup(|app| {
            // The title shows the app and its version, never the open file.
            let info = app.package_info();
            if let Some(window) = app.get_webview_window("main") {
                window.set_title(&format!("{} {}", info.name, info.version))?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::open_file,
            commands::get_schema,
            commands::get_view_schema,
            commands::list_functions,
            commands::get_rows,
            commands::get_footer_stats,
            commands::get_column_profile,
            commands::export_view,
            commands::close_file,
            commands::take_pending_open,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // macOS delivers file associations as an event instead of an argument.
            #[cfg(any(target_os = "macos", target_os = "ios"))]
            if let tauri::RunEvent::Opened { urls } = event
                && let Some(path) = urls.into_iter().find_map(|u| u.to_file_path().ok())
            {
                let path = path.to_string_lossy().into_owned();
                app.state::<PendingOpen>().set(path.clone());
                let _ = app.emit("open-file", path);
            }
            #[cfg(not(any(target_os = "macos", target_os = "ios")))]
            let _ = (app, event);
        });
}
