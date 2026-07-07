use tauri::State;
use crate::models::*;
use crate::error::AppError;
use crate::AppState;
use crate::db::repo::query_repo;

#[tauri::command]
pub async fn query_notes(state: State<'_, AppState>, params: QueryParams) -> Result<Vec<NoteRow>, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    query_repo::query_notes(&conn, &params)
}
