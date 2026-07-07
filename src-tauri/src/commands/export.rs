use std::io::Write;
use tauri::State;
use crate::crypto;
use crate::models::*;
use crate::error::AppError;
use crate::AppState;
use crate::db::repo::{note_repo, query_repo};
use csv::WriterBuilder;

/// 从 .md 文件导入笔记
/// 解析 YAML Front Matter（如有）提取元数据，正文作为笔记内容
#[tauri::command]
pub async fn import_note_from_md(
    state: State<'_, AppState>,
    file_path: String,
    folder_id: Option<String>,
) -> Result<Note, AppError> {
    let content = std::fs::read_to_string(&file_path)
        .map_err(|e| AppError::Internal(format!("读取文件失败: {}", e)))?;

    let (meta, body) = parse_front_matter(&content);
    let file_name = std::path::Path::new(&file_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("导入的笔记")
        .to_string();

    let title = meta.get("title").cloned().unwrap_or(file_name);
    let status = meta.get("status").cloned().unwrap_or_else(|| "todo".to_string());
    let priority = meta.get("priority").cloned().unwrap_or_else(|| "medium".to_string());
    let starred = meta.get("starred")
        .map(|s| s == "true" || s == "1")
        .unwrap_or(false);
    let pinned = meta.get("pinned")
        .map(|s| s == "true" || s == "1")
        .unwrap_or(false);
    let tags: Vec<String> = meta.get("tags")
        .map(|s| s.split(',').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect())
        .unwrap_or_default();

    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    // 检查加密是否已启用且已解锁（单密码方案：检查 lock_config 表）
    let has_enc_config = {
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM lock_config WHERE id = 'default' AND salt IS NOT NULL AND salt != ''",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        count > 0
    };

    let mk_available = {
        let mk = state.master_key.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        mk.is_some()
    };

    // 如果加密已启用但未解锁，拒绝导入
    if has_enc_config && !mk_available {
        return Err(AppError::Internal("加密已启用但未解锁，请先解锁加密后再导入笔记".to_string()));
    }

    // 加密 content（和 create_note 命令一样的逻辑）
    let (encrypted_content, is_enc) = {
        let mk_opt = state.master_key.lock()
            .map_err(|e| AppError::Internal(e.to_string()))?
            .clone();
        match mk_opt {
            Some(ref mk) => (crypto::encrypt_content(&body, mk)?, true),
            None => (body.clone(), false),
        }
    };

    let req = CreateNoteRequest {
        title,
        content: encrypted_content,
        folder_id,
        priority: Some(priority),
        status: Some(status),
    };

    let mut note = note_repo::create_note(&conn, req)?;

    if is_enc {
        conn.execute(
            "UPDATE notes SET is_encrypted = 1 WHERE id = ?",
            rusqlite::params![note.id],
        )?;
        note.is_encrypted = true;
    }

    // 返回解密后的内容（和 create_note 命令一致）
    if note.is_encrypted {
        let mk_opt = state.master_key.lock()
            .map_err(|e| AppError::Internal(e.to_string()))?
            .clone();
        if let Some(ref mk) = mk_opt {
            note.content = crypto::decrypt_content(&note.content, mk)?;
        }
    }

    // 设置 starred / pinned
    if starred {
        note = note_repo::set_note_starred(&conn, &note.id, true)?;
    }
    if pinned {
        note = note_repo::set_note_pinned(&conn, &note.id, true)?;
    }
    if !tags.is_empty() {
        note = note_repo::set_note_tags(&conn, &note.id, &tags)?;
    }

    Ok(note)
}

/// 解析 YAML Front Matter，返回 (元数据 map, 正文)
fn parse_front_matter(content: &str) -> (std::collections::HashMap<String, String>, String) {
    let mut meta = std::collections::HashMap::new();
    let trimmed = content.trim_start();

    if !trimmed.starts_with("---") {
        return (meta, content.to_string());
    }

    // 找到第二个 ---
    let rest = &trimmed[3..]; // skip first ---
    if let Some(end) = rest.find("\n---") {
        let front_matter = &rest[..end];

        // 简单解析 key: value
        for line in front_matter.lines() {
            if let Some(colon_pos) = line.find(':') {
                let key = line[..colon_pos].trim().to_string();
                let value = line[colon_pos + 1..].trim().to_string();
                // 去除引号
                let value = value.trim_matches('"').trim_matches('\'').to_string();
                meta.insert(key, value);
            }
        }

        // body 需要从原始内容中正确截取
        let body = find_body_after_front_matter(content);
        return (meta, body);
    }

    (meta, content.to_string())
}

/// 从原始内容中找到 Front Matter 之后的正文
fn find_body_after_front_matter(content: &str) -> String {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return content.to_string();
    }
    // 找第一个换行后的 ---
    let after_first = &trimmed[3..]; // skip first ---
    let lines: Vec<&str> = after_first.lines().collect();
    let mut found_end = false;
    let mut body_lines = Vec::new();

    for (i, line) in lines.iter().enumerate() {
        if line.trim() == "---" && !found_end {
            found_end = true;
            // Body starts from the next line
            body_lines = lines[i + 1..].to_vec();
            break;
        }
    }

    if found_end {
        body_lines.join("\n").trim_start().to_string()
    } else {
        content.to_string()
    }
}

/// 导出查询结果为 CSV（含 UTF-8 BOM）
#[tauri::command]
pub async fn export_csv(
    state: State<'_, AppState>,
    params: QueryParams,
    dest_path: String,
) -> Result<usize, AppError> {
    let rows = {
        let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        query_repo::query_notes(&conn, &params)?
    };

    let mut file = std::fs::File::create(&dest_path)?;
    // 写入 UTF-8 BOM
    file.write_all(b"\xEF\xBB\xBF")?;

    let mut wtr = WriterBuilder::new().from_writer(file);
    wtr.write_record(&["标题", "内容摘要", "标签", "优先级", "状态", "加星", "置顶", "创建时间", "更新时间"])?;

    for row in &rows {
        let starred_str = if row.starred { "是" } else { "否" };
        let pinned_str = if row.pinned { "是" } else { "否" };
        let tags_str = row.tags.join(", ");
        let created_str = format_ts(row.created_at);
        let updated_str = format_ts(row.updated_at);
        wtr.write_record(&[
            row.title.as_str(),
            row.content_preview.as_str(),
            tags_str.as_str(),
            row.priority.as_str(),
            row.status.as_str(),
            starred_str,
            pinned_str,
            created_str.as_str(),
            updated_str.as_str(),
        ])?;
    }
    wtr.flush()?;
    Ok(rows.len())
}

/// 导出单篇笔记为 Markdown（含 YAML Front Matter）
#[tauri::command]
pub async fn export_note_md(
    state: State<'_, AppState>,
    note_id: String,
    dest_path: String,
) -> Result<(), AppError> {
    let note = {
        let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        note_repo::get_note(&conn, &note_id)?
    };

    // 如果 content 已加密，解密后再写入
    let plain_content = if note.is_encrypted {
        let mk = state.master_key.lock()
            .map_err(|e| AppError::Internal(e.to_string()))?
            .clone();
        if let Some(ref master_key) = mk {
            crypto::decrypt_content(&note.content, master_key)?
        } else {
            return Err(AppError::Internal("加密未解锁，无法导出".to_string()));
        }
    } else {
        note.content.clone()
    };

    let mut md = String::new();
    md.push_str("---\n");
    md.push_str(&format!("title: {}\n", yaml_escape(&note.title)));
    md.push_str(&format!("created_at: {}\n", iso_ts(note.created_at)));
    md.push_str(&format!("updated_at: {}\n", iso_ts(note.updated_at)));
    md.push_str(&format!("status: {}\n", note.status));
    md.push_str(&format!("priority: {}\n", note.priority));
    md.push_str(&format!("starred: {}\n", note.starred));
    md.push_str(&format!("pinned: {}\n", note.pinned));
    md.push_str(&format!("tags: [{}]\n", note.tags.join(", ")));
    md.push_str("---\n\n");
    md.push_str(&plain_content);

    std::fs::write(&dest_path, md.as_bytes())?;
    Ok(())
}

fn format_ts(ts: i64) -> String {
    let dt = chrono::DateTime::from_timestamp_millis(ts).unwrap_or_default();
    dt.format("%Y-%m-%d %H:%M").to_string()
}

fn iso_ts(ts: i64) -> String {
    let dt = chrono::DateTime::from_timestamp_millis(ts).unwrap_or_default();
    dt.to_rfc3339()
}

fn yaml_escape(s: &str) -> String {
    // 简单 YAML 转义：如果包含特殊字符，用双引号包裹
    if s.contains(':') || s.contains('#') || s.contains('"') || s.contains('\'') {
        format!("\"{}\"", s.replace('"', "\\\""))
    } else {
        s.to_string()
    }
}
