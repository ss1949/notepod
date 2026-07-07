mod commands;
mod crypto;
mod db;
mod models;
mod error;

use std::sync::Mutex;
use rusqlite::Connection;
use tauri::Manager;

/// 应用全局状态
pub struct AppState {
    pub conn: Mutex<Connection>,
    pub db_path: String,
    pub master_key: Mutex<Option<Vec<u8>>>,
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();

    {
        #[allow(unused_mut)]
        let mut b = tauri::Builder::default()
            .plugin(tauri_plugin_dialog::init())
            .plugin(tauri_plugin_os::init())
            .plugin(tauri_plugin_shell::init());
        #[cfg(not(target_os = "android"))]
        {
            b = b.plugin(tauri_plugin_global_shortcut::Builder::new().build());
        }
        b
    }
        .setup(|app| {
            // 获取应用数据目录
            let app_data_dir = app.path().app_data_dir()
                .expect("failed to get app data dir");
            std::fs::create_dir_all(&app_data_dir).expect("failed to create app data dir");

            let db_path = app_data_dir.join("notepod.db");
            let db_path_str = db_path.to_string_lossy().to_string();

            // 打开数据库连接
            let conn = Connection::open(&db_path)
                .expect("failed to open database");

            // 启用 WAL 模式和外键
            conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
                .expect("failed to set pragmas");

            // 初始化 schema
            db::schema::init_schema(&conn)
                .expect("failed to init schema");

            log::info!("Database initialized at: {}", db_path_str);

            // 管理状态
            app.manage(AppState {
                conn: Mutex::new(conn),
                db_path: db_path_str,
                master_key: Mutex::new(None),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // 笔记操作
            commands::note::create_note,
            commands::note::get_note,
            commands::note::list_notes,
            commands::note::list_notes_summary,
            commands::note::list_daily_notes_summary,
            commands::note::get_note_content,
            commands::note::update_note,
            commands::note::delete_note,
            commands::note::restore_note,
            commands::note::toggle_note_status,
            commands::note::set_note_priority,
            commands::note::set_note_starred,
            commands::note::set_note_pinned,
            commands::note::set_note_tags,
            commands::note::set_note_due_date,
            commands::note::count_notes_by_folder,
            commands::note::get_activity_heatmap,
            commands::note::get_daily_note,
            commands::note::create_daily_note,
            commands::note::get_or_create_daily_note,
            commands::note::list_daily_notes,
            // 文件夹操作
            commands::folder::list_folders,
            commands::folder::create_folder,
            commands::folder::delete_folder,
            commands::folder::rename_folder,
            commands::folder::update_folder,
            // 标签操作
            commands::tag::list_tags,
            commands::tag::create_tag,
            commands::tag::delete_tag,
            // 查询
            commands::query::query_notes,
            // 导出
            commands::export::export_csv,
            commands::export::export_note_md,
            commands::export::import_note_from_md,
            // 备份
            commands::backup::create_backup,
            commands::backup::restore_backup,
            // Git 备份同步（全平台，gix 纯 Rust 实现）
            commands::git::save_git_config,
            commands::git::get_git_config,
            commands::git::git_backup,
            commands::git::git_sync,
            commands::lock::restore_enc_from_git,
            // 锁屏 + 加密
            commands::lock::set_lock_password,
            commands::lock::change_lock_password,
            commands::lock::get_lock_config,
            commands::lock::verify_lock_password,
            commands::lock::remove_lock_password,
            commands::lock::get_enc_status,
            commands::lock::import_enc_config,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
