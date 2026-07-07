use tauri::State;
use crate::models::*;
use crate::error::AppError;
use crate::AppState;
use crate::db::repo::tag_repo;

#[tauri::command]
pub async fn list_tags(state: State<'_, AppState>) -> Result<Vec<Tag>, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    tag_repo::list_tags(&conn)
}

#[tauri::command]
pub async fn create_tag(state: State<'_, AppState>, name: String, color: String) -> Result<Tag, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    tag_repo::create_tag(&conn, &name, &color)
}

#[tauri::command]
pub async fn delete_tag(state: State<'_, AppState>, tag_id: String) -> Result<(), AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    tag_repo::delete_tag(&conn, &tag_id)
}
