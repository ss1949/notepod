use tauri::State;
use crate::models::*;
use crate::error::AppError;
use crate::AppState;
use crate::db::repo::tag_repo;

#[tauri::command]
pub async fn list_folders(state: State<'_, AppState>) -> Result<Vec<Folder>, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    tag_repo::list_folders(&conn)
}

#[tauri::command]
pub async fn create_folder(
    state: State<'_, AppState>,
    name: String,
    color: String,
    parent_id: Option<String>,
) -> Result<Folder, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    tag_repo::create_folder(&conn, &name, &color, parent_id.as_deref())
}

#[tauri::command]
pub async fn delete_folder(state: State<'_, AppState>, folder_id: String) -> Result<(), AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    tag_repo::delete_folder(&conn, &folder_id)
}

/// 重命名文件夹
#[tauri::command]
pub async fn rename_folder(
    state: State<'_, AppState>,
    folder_id: String,
    name: String,
) -> Result<(), AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    tag_repo::update_folder(&conn, &folder_id, Some(&name), None, None)
}

/// 更新文件夹（名称、颜色和父级）
#[tauri::command]
pub async fn update_folder(
    state: State<'_, AppState>,
    folder_id: String,
    name: Option<String>,
    color: Option<String>,
    parent_id: Option<Option<String>>,
) -> Result<(), AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    tag_repo::update_folder(
        &conn,
        &folder_id,
        name.as_deref(),
        color.as_deref(),
        parent_id.as_ref().map(|p| p.as_deref()),
    )
}
