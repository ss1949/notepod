use tauri::State;
use rusqlite::Connection;
use crate::models::*;
use crate::crypto;
use crate::error::AppError;
use crate::AppState;
use crate::db::repo::note_repo;

/// 如果加密已解锁，加密笔记 content
fn maybe_encrypt(state: &State<'_, AppState>, content: &str) -> Result<(String, bool), AppError> {
    let mk_opt = state.master_key.lock()
        .map_err(|e| AppError::Internal(e.to_string()))?
        .clone();

    match mk_opt {
        Some(mk) => {
            let encrypted = crypto::encrypt_content(content, &mk)?;
            Ok((encrypted, true))
        }
        None => Ok((content.to_string(), false)),
    }
}

/// 如果 content 是加密格式，用 Master Key 解密
fn maybe_decrypt(state: &State<'_, AppState>, content: &str) -> Result<String, AppError> {
    if !content.starts_with("ENC:") {
        return Ok(content.to_string());
    }

    let mk_opt = state.master_key.lock()
        .map_err(|e| AppError::Internal(e.to_string()))?
        .clone();

    match mk_opt {
        Some(mk) => crypto::decrypt_content(content, &mk),
        None => Err(AppError::Internal("加密未解锁，无法解密笔记内容".to_string())),
    }
}

/// 批量解密 Note，失败时显示占位符（不阻断流程）
fn decrypt_note(state: &State<'_, AppState>, note: &mut Note) {
    if note.is_encrypted {
        note.content = maybe_decrypt(state, &note.content).unwrap_or_else(|_| "[加密内容]".to_string());
    }
}

#[tauri::command]
pub async fn create_note(state: State<'_, AppState>, req: CreateNoteRequest) -> Result<Note, AppError> {
    let (encrypted_content, is_enc) = maybe_encrypt(&state, &req.content)?;

    let enc_req = CreateNoteRequest {
        content: encrypted_content,
        ..req
    };

    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut note = note_repo::create_note(&conn, enc_req)?;

    // 如果启用了加密，标记 is_encrypted
    if is_enc {
        conn.execute(
            "UPDATE notes SET is_encrypted = 1 WHERE id = ?",
            rusqlite::params![note.id],
        )?;
        note.is_encrypted = true;
    }

    // 返回时解密内容
    decrypt_note(&state, &mut note);
    Ok(note)
}

#[tauri::command]
pub async fn get_note(state: State<'_, AppState>, note_id: String) -> Result<Note, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut note = note_repo::get_note(&conn, &note_id)?;
    decrypt_note(&state, &mut note);
    Ok(note)
}

#[tauri::command]
pub async fn list_notes(state: State<'_, AppState>, folder_id: Option<String>) -> Result<Vec<Note>, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut notes = note_repo::list_notes(&conn, folder_id.as_deref())?;
    for note in &mut notes {
        if note.is_encrypted {
            note.content = maybe_decrypt(&state, &note.content).unwrap_or_else(|_| "[加密内容]".to_string());
        }
    }
    Ok(notes)
}

#[tauri::command]
pub async fn update_note(state: State<'_, AppState>, req: UpdateNoteRequest) -> Result<Note, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    // 如果更新包含 content，需要处理加密保护
    let enc_req = if let Some(ref new_content) = req.content {
        let mk_available = {
            let mk = state.master_key.lock().map_err(|e| AppError::Internal(e.to_string()))?;
            mk.is_some()
        };

        if !mk_available {
            // MK 不可用：检查原笔记是否已加密
            if let Ok(existing) = note_repo::get_note_with_deleted(&conn, &req.id) {
                if existing.is_encrypted {
                    // 已加密笔记在 MK 不可用时，跳过 content 更新，保留原密文
                    log::warn!("加密未解锁，跳过笔记 {} 的 content 更新", req.id);
                    let non_content_req = UpdateNoteRequest {
                        content: None, // 不修改 content
                        ..req
                    };
                    let mut note = note_repo::update_note(&conn, non_content_req)?;
                    // 恢复原始加密 content
                    note.content = existing.content;
                    note.is_encrypted = true;
                    // 返回时给前端显示提示
                    note.content = "[加密内容（请先解锁加密）]".to_string();
                    return Ok(note);
                }
            }
        }

        // MK 可用 或 笔记未加密 → 正常加密后保存
        let (encrypted, _is_enc) = maybe_encrypt(&state, new_content)?;
        UpdateNoteRequest { content: Some(encrypted), ..req }
    } else {
        req
    };

    let mut note = note_repo::update_note(&conn, enc_req)?;

    // 如果加密已启用但笔记标记为未加密，更新标记
    let mk_exists = {
        let mk = state.master_key.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        mk.is_some()
    };

    if mk_exists && !note.is_encrypted {
        conn.execute(
            "UPDATE notes SET is_encrypted = 1 WHERE id = ? AND content LIKE 'ENC:%'",
            rusqlite::params![note.id],
        )?;
        note.is_encrypted = true;
    }

    decrypt_note(&state, &mut note);
    Ok(note)
}

#[tauri::command]
pub async fn delete_note(state: State<'_, AppState>, note_id: String) -> Result<(), AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    note_repo::delete_note(&conn, &note_id)
}

#[tauri::command]
pub async fn restore_note(state: State<'_, AppState>, note_id: String) -> Result<Note, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut note = note_repo::restore_note(&conn, &note_id)?;
    decrypt_note(&state, &mut note);
    Ok(note)
}

#[tauri::command]
pub async fn toggle_note_status(state: State<'_, AppState>, note_id: String) -> Result<Note, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut note = note_repo::toggle_note_status(&conn, &note_id)?;
    decrypt_note(&state, &mut note);
    Ok(note)
}

#[tauri::command]
pub async fn set_note_priority(state: State<'_, AppState>, note_id: String, priority: String) -> Result<Note, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut note = note_repo::set_note_priority(&conn, &note_id, &priority)?;
    decrypt_note(&state, &mut note);
    Ok(note)
}

#[tauri::command]
pub async fn set_note_starred(state: State<'_, AppState>, note_id: String, starred: bool) -> Result<Note, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut note = note_repo::set_note_starred(&conn, &note_id, starred)?;
    decrypt_note(&state, &mut note);
    Ok(note)
}

#[tauri::command]
pub async fn set_note_pinned(state: State<'_, AppState>, note_id: String, pinned: bool) -> Result<Note, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut note = note_repo::set_note_pinned(&conn, &note_id, pinned)?;
    decrypt_note(&state, &mut note);
    Ok(note)
}

#[tauri::command]
pub async fn set_note_tags(state: State<'_, AppState>, note_id: String, tags: Vec<String>) -> Result<Note, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut note = note_repo::set_note_tags(&conn, &note_id, &tags)?;
    decrypt_note(&state, &mut note);
    Ok(note)
}

#[tauri::command]
pub async fn set_note_due_date(state: State<'_, AppState>, note_id: String, due_date: Option<i64>) -> Result<Note, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute("UPDATE notes SET due_date = ?, updated_at = ? WHERE id = ?", rusqlite::params![due_date, now, note_id])
        .map_err(|e| AppError::Internal(e.to_string()))?;
    let mut note = note_repo::get_note(&conn, &note_id)?;
    decrypt_note(&state, &mut note);
    Ok(note)
}

#[tauri::command]
pub async fn count_notes_by_folder(state: State<'_, AppState>) -> Result<Vec<FolderNoteCount>, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    note_repo::count_notes_by_folder(&conn)
}

#[tauri::command]
pub async fn get_activity_heatmap(state: State<'_, AppState>, days: i64) -> Result<Vec<note_repo::ActivityDay>, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    note_repo::get_activity_heatmap(&conn, days)
}

// ============================================================
// 每日日志
// ============================================================

#[tauri::command]
pub async fn get_daily_note(state: State<'_, AppState>, date: String) -> Result<Option<Note>, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut result = note_repo::get_daily_note(&conn, &date)?;
    if let Some(ref mut note) = result {
        decrypt_note(&state, note);
    }
    Ok(result)
}

#[tauri::command]
pub async fn create_daily_note(state: State<'_, AppState>, date: String) -> Result<Note, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut note = note_repo::create_daily_note(&conn, &date)?;

    // 如果加密已启用，加密初始空内容
    let mk_exists = {
        let mk = state.master_key.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        mk.is_some()
    };

    if mk_exists && !note.is_encrypted && !note.content.is_empty() {
        let (encrypted, _) = maybe_encrypt(&state, &note.content)?;
        conn.execute(
            "UPDATE notes SET content = ?, is_encrypted = 1 WHERE id = ?",
            rusqlite::params![encrypted, note.id],
        )?;
        note.is_encrypted = true;
    }

    decrypt_note(&state, &mut note);
    Ok(note)
}

#[tauri::command]
pub async fn get_or_create_daily_note(state: State<'_, AppState>, date: String) -> Result<Note, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut note = note_repo::get_or_create_daily_note(&conn, &date)?;

    let mk_exists = {
        let mk = state.master_key.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        mk.is_some()
    };

    if mk_exists && !note.is_encrypted && !note.content.is_empty() {
        let (encrypted, _) = maybe_encrypt(&state, &note.content)?;
        conn.execute(
            "UPDATE notes SET content = ?, is_encrypted = 1 WHERE id = ?",
            rusqlite::params![encrypted, note.id],
        )?;
        note.is_encrypted = true;
    }

    decrypt_note(&state, &mut note);
    Ok(note)
}

#[tauri::command]
pub async fn list_daily_notes(state: State<'_, AppState>) -> Result<Vec<Note>, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut notes = note_repo::list_daily_notes(&conn)?;
    for note in &mut notes {
        if note.is_encrypted {
            note.content = maybe_decrypt(&state, &note.content).unwrap_or_else(|_| "[加密内容]".to_string());
        }
    }
    Ok(notes)
}

/// 列出笔记摘要（用于列表/侧边栏，含 task_lines）
#[tauri::command]
pub async fn list_notes_summary(state: State<'_, AppState>, folder_id: Option<String>) -> Result<Vec<NoteSummary>, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut summaries = note_repo::list_notes_summary(&conn, folder_id.as_deref())?;
    // 为加密笔记解密内容并提取 task_lines / block_ids / wiki_links
    fill_encrypted_summary_fields(&state, &conn, &mut summaries)?;
    Ok(summaries)
}

/// 列出日志摘要（用于瀑布流视图，含 task_lines）
#[tauri::command]
pub async fn list_daily_notes_summary(state: State<'_, AppState>) -> Result<Vec<NoteSummary>, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let mut summaries = note_repo::list_daily_notes_summary(&conn)?;
    // 为加密笔记解密内容并提取 task_lines / block_ids / wiki_links
    fill_encrypted_summary_fields(&state, &conn, &mut summaries)?;
    Ok(summaries)
}

/// 为加密笔记解密内容并填充 task_lines / block_ids / wiki_links
fn fill_encrypted_summary_fields(state: &State<'_, AppState>, conn: &Connection, summaries: &mut [NoteSummary]) -> Result<(), AppError> {
    let encrypted_ids: Vec<String> = summaries.iter()
        .filter(|s| s.is_encrypted)
        .map(|s| s.id.clone())
        .collect();
    if encrypted_ids.is_empty() {
        return Ok(());
    }
    for summary in summaries.iter_mut() {
        if !summary.is_encrypted {
            continue;
        }
        let content = note_repo::get_note_content(conn, &summary.id)?;
        match maybe_decrypt(state, &content) {
            Ok(decrypted) => {
                summary.task_lines = note_repo::extract_task_lines(&decrypted);
                summary.block_ids = note_repo::extract_block_ids(&decrypted);
                summary.wiki_links = note_repo::extract_wiki_links(&decrypted);
            }
            Err(e) => {
                log::warn!("解密笔记 {} 失败 (MK 不可用): {}，返回空摘要字段", summary.id, e);
                summary.task_lines = vec![];
                summary.block_ids = vec![];
                summary.wiki_links = vec![];
            }
        }
    }
    Ok(())
}

/// 按需加载笔记内容（用于编辑器打开笔记时）
#[tauri::command]
pub async fn get_note_content(state: State<'_, AppState>, note_id: String) -> Result<String, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let content = note_repo::get_note_content(&conn, &note_id)?;
    // 检查是否需要解密
    let is_encrypted: bool = conn.query_row(
        "SELECT is_encrypted FROM notes WHERE id = ?",
        rusqlite::params![note_id],
        |row| Ok(row.get::<_, i64>(0)? != 0),
    ).unwrap_or(false);

    if is_encrypted {
        maybe_decrypt(&state, &content)
    } else {
        Ok(content)
    }
}
