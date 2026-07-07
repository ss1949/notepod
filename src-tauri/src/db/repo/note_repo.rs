use rusqlite::{params, Connection};
use chrono::Datelike;
use crate::models::*;
use crate::error::AppError;

/// 从内容中提取任务行
pub fn extract_task_lines(content: &str) -> Vec<String> {
    let mut tasks = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        // 匹配: [-*+]? (TODO|DOING|NOW|LATER|WAITING|DONE|CANCELLED) ...
        if trimmed.starts_with("TODO ") || trimmed.starts_with("DOING ") || trimmed.starts_with("NOW ")
            || trimmed.starts_with("LATER ") || trimmed.starts_with("WAITING ")
            || trimmed.starts_with("DONE ") || trimmed.starts_with("CANCELLED ")
            || trimmed.starts_with("- TODO ") || trimmed.starts_with("- DOING ")
            || trimmed.starts_with("- NOW ") || trimmed.starts_with("- LATER ")
            || trimmed.starts_with("- WAITING ") || trimmed.starts_with("- DONE ")
            || trimmed.starts_with("- CANCELLED ")
            || trimmed.starts_with("* TODO ") || trimmed.starts_with("* DOING ")
            || trimmed.starts_with("* NOW ") || trimmed.starts_with("* LATER ")
            || trimmed.starts_with("* WAITING ") || trimmed.starts_with("* DONE ")
            || trimmed.starts_with("* CANCELLED ")
            || trimmed.starts_with("+ TODO ") || trimmed.starts_with("+ DOING ")
            || trimmed.starts_with("+ NOW ") || trimmed.starts_with("+ LATER ")
            || trimmed.starts_with("+ WAITING ") || trimmed.starts_with("+ DONE ")
            || trimmed.starts_with("+ CANCELLED ")
        {
            tasks.push(line.to_string());
        }
    }
    tasks
}

/// 从内容中提取块 ID 映射 (block_id -> 行内容，去掉 block id)
pub fn extract_block_ids(content: &str) -> Vec<(String, String)> {
    let mut blocks = Vec::new();
    let re = regex::Regex::new(r"\s*\^([a-zA-Z0-9_-]+)$").unwrap();
    let list_re = regex::Regex::new(r"^\s*[-*+]\s+").unwrap();
    for line in content.lines() {
        if !list_re.is_match(line) { continue; }
        if let Some(cap) = re.captures(line) {
            let id = cap[1].to_string();
            let text = re.replace(line, "").trim().to_string();
            blocks.push((id, text));
        }
    }
    blocks
}

/// 从内容中提取 [[wiki]] 链接标题
pub fn extract_wiki_links(content: &str) -> Vec<String> {
    let mut links = Vec::new();
    let re = regex::Regex::new(r"\[\[([^\]]+)\]\]").unwrap();
    for cap in re.captures_iter(content) {
        let title = cap[1].trim().to_string();
        if !title.is_empty() && !links.contains(&title) {
            links.push(title);
        }
    }
    links
}

/// 热力图活动数据（用于返回）
#[derive(Debug, Clone, serde::Serialize)]
pub struct ActivityDay {
    pub date: String,
    pub count: i64,
}

pub fn create_note(conn: &Connection, req: CreateNoteRequest) -> Result<Note, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let status = req.status.as_deref().unwrap_or("todo");
    let priority = req.priority.as_deref().unwrap_or("medium");

    conn.execute(
        "INSERT INTO notes (id, title, content, folder_id, status, priority, starred, pinned, is_encrypted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 0, 0, ?, ?)",
        params![id, req.title, req.content, req.folder_id, status, priority, now, now],
    )?;

    get_note(conn, &id)
}

pub fn get_note(conn: &Connection, note_id: &str) -> Result<Note, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, content, folder_id, status, priority, starred, pinned, is_encrypted, created_at, updated_at, deleted_at, due_date, reminder, parent_task_id, note_type, journal_date
         FROM notes WHERE id = ? AND deleted_at IS NULL"
    )?;

    let note = stmt.query_row(params![note_id], |row| {
        Ok(Note {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            folder_id: row.get(3)?,
            status: row.get(4)?,
            priority: row.get(5)?,
            starred: row.get::<_, i64>(6)? != 0,
            pinned: row.get::<_, i64>(7)? != 0,
            is_encrypted: row.get::<_, i64>(8)? != 0,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
            deleted_at: row.get(11)?,
            tags: vec![],
            due_date: row.get(12)?,
            reminder: row.get(13)?,
            parent_task_id: row.get(14)?,
            note_type: row.get::<_, Option<String>>(15)?.unwrap_or_else(|| "note".to_string()),
            journal_date: row.get(16)?,
        })
    }).map_err(|_| AppError::NotFound(note_id.to_string()))?;

    let tags = get_note_tags(conn, note_id)?;
    let mut note = note;
    note.tags = tags;
    Ok(note)
}

/// 获取笔记（包括已删除的）
pub fn get_note_with_deleted(conn: &Connection, note_id: &str) -> Result<Note, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, content, folder_id, status, priority, starred, pinned, is_encrypted, created_at, updated_at, deleted_at, due_date, reminder, parent_task_id, note_type, journal_date
         FROM notes WHERE id = ?"
    )?;

    let note = stmt.query_row(params![note_id], |row| {
        Ok(Note {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            folder_id: row.get(3)?,
            status: row.get(4)?,
            priority: row.get(5)?,
            starred: row.get::<_, i64>(6)? != 0,
            pinned: row.get::<_, i64>(7)? != 0,
            is_encrypted: row.get::<_, i64>(8)? != 0,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
            deleted_at: row.get(11)?,
            tags: vec![],
            due_date: row.get(12)?,
            reminder: row.get(13)?,
            parent_task_id: row.get(14)?,
            note_type: row.get::<_, Option<String>>(15)?.unwrap_or_else(|| "note".to_string()),
            journal_date: row.get(16)?,
        })
    }).map_err(|_| AppError::NotFound(note_id.to_string()))?;

    let tags = get_note_tags(conn, note_id)?;
    let mut note = note;
    note.tags = tags;
    Ok(note)
}

pub fn list_notes(conn: &Connection, folder_id: Option<&str>) -> Result<Vec<Note>, AppError> {
    let mut sql = String::from(
        "SELECT n.id, n.title, n.content, n.folder_id, n.status, n.priority, n.starred, n.pinned, n.is_encrypted, n.created_at, n.updated_at, n.deleted_at, n.due_date, n.reminder, n.parent_task_id, n.note_type, n.journal_date
         FROM notes n WHERE (n.note_type IS NULL OR n.note_type != 'daily')"
    );
    let mut param_values: Vec<Box<dyn rusqlite::ToSql>> = vec![];

    if let Some(fid) = folder_id {
        sql.push_str(" AND n.folder_id = ?");
        param_values.push(Box::new(fid.to_string()));
    }
    sql.push_str(" ORDER BY n.pinned DESC, n.updated_at DESC LIMIT 500");

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let notes = stmt.query_map(param_refs.as_slice(), |row| {
        Ok(Note {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            folder_id: row.get(3)?,
            status: row.get(4)?,
            priority: row.get(5)?,
            starred: row.get::<_, i64>(6)? != 0,
            pinned: row.get::<_, i64>(7)? != 0,
            is_encrypted: row.get::<_, i64>(8)? != 0,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
            deleted_at: row.get(11)?,
            tags: vec![],
            due_date: row.get(12)?,
            reminder: row.get(13)?,
            parent_task_id: row.get(14)?,
            note_type: row.get::<_, Option<String>>(15)?.unwrap_or_else(|| "note".to_string()),
            journal_date: row.get(16)?,
        })
    })?;

    let mut result = vec![];
    for note in notes {
        let n = note?;
        result.push(n);
    }

    // 批量加载 tags（避免 N+1 查询）
    batch_load_tags(conn, &mut result)?;

    Ok(result)
}

/// 批量加载 tags（单次查询替代 N+1）
fn batch_load_tags(conn: &Connection, notes: &mut [Note]) -> Result<(), AppError> {
    if notes.is_empty() {
        return Ok(());
    }
    let ids: Vec<String> = notes.iter().map(|n| n.id.clone()).collect();
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT nt.note_id, t.name FROM note_tags nt JOIN tags t ON nt.tag_id = t.id WHERE nt.note_id IN ({})",
        placeholders
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
    let tag_rows = stmt.query_map(params.as_slice(), |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut tag_map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for row in tag_rows {
        let (note_id, tag_name) = row?;
        tag_map.entry(note_id).or_default().push(tag_name);
    }

    for note in notes.iter_mut() {
        note.tags = tag_map.remove(&note.id).unwrap_or_default();
    }

    Ok(())
}

/// 批量加载 tags 到 NoteSummary（单次查询替代 N+1）
fn batch_load_tags_summary(conn: &Connection, notes: &mut [NoteSummary]) -> Result<(), AppError> {
    if notes.is_empty() {
        return Ok(());
    }
    let ids: Vec<String> = notes.iter().map(|n| n.id.clone()).collect();
    let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
    let sql = format!(
        "SELECT nt.note_id, t.name FROM note_tags nt JOIN tags t ON nt.tag_id = t.id WHERE nt.note_id IN ({})",
        placeholders
    );
    let mut stmt = conn.prepare(&sql)?;
    let params: Vec<&dyn rusqlite::ToSql> = ids.iter().map(|id| id as &dyn rusqlite::ToSql).collect();
    let tag_rows = stmt.query_map(params.as_slice(), |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut tag_map: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for row in tag_rows {
        let (note_id, tag_name) = row?;
        tag_map.entry(note_id).or_default().push(tag_name);
    }

    for note in notes.iter_mut() {
        note.tags = tag_map.remove(&note.id).unwrap_or_default();
    }

    Ok(())
}

/// 列出笔记摘要（不含 content，用于列表/侧边栏视图）
pub fn list_notes_summary(conn: &Connection, folder_id: Option<&str>) -> Result<Vec<NoteSummary>, AppError> {
    let mut sql = String::from(
        "SELECT n.id, n.title, n.folder_id, n.status, n.priority, n.starred, n.pinned, n.is_encrypted, n.created_at, n.updated_at, n.deleted_at, n.due_date, n.reminder, n.parent_task_id, n.note_type, n.journal_date, n.content
         FROM notes n WHERE (n.note_type IS NULL OR n.note_type != 'daily') AND n.deleted_at IS NULL"
    );
    let mut param_values: Vec<Box<dyn rusqlite::ToSql>> = vec![];

    if let Some(fid) = folder_id {
        sql.push_str(" AND n.folder_id = ?");
        param_values.push(Box::new(fid.to_string()));
    }
    sql.push_str(" ORDER BY n.pinned DESC, n.updated_at DESC LIMIT 500");

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let notes = stmt.query_map(param_refs.as_slice(), |row| {
        let is_encrypted: i64 = row.get(7)?;
        let content: String = row.get(16)?;
        // 加密内容的提取在命令层解密后再做，这里先给空
        let (task_lines, block_ids, wiki_links) = if is_encrypted != 0 {
            (vec![], vec![], vec![])
        } else {
            (extract_task_lines(&content), extract_block_ids(&content), extract_wiki_links(&content))
        };
        Ok(NoteSummary {
            id: row.get(0)?,
            title: row.get(1)?,
            folder_id: row.get(2)?,
            status: row.get(3)?,
            priority: row.get(4)?,
            starred: row.get::<_, i64>(5)? != 0,
            pinned: row.get::<_, i64>(6)? != 0,
            is_encrypted: is_encrypted != 0,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
            deleted_at: row.get(10)?,
            tags: vec![],
            due_date: row.get(11)?,
            reminder: row.get(12)?,
            parent_task_id: row.get(13)?,
            note_type: row.get::<_, Option<String>>(14)?.unwrap_or_else(|| "note".to_string()),
            journal_date: row.get(15)?,
            task_lines,
            block_ids,
            wiki_links,
        })
    })?;

    let mut result = vec![];
    for note in notes {
        result.push(note?);
    }

    batch_load_tags_summary(conn, &mut result)?;

    Ok(result)
}

/// 获取笔记内容（按需加载，用于编辑器打开笔记时）
pub fn get_note_content(conn: &Connection, note_id: &str) -> Result<String, AppError> {
    let content: String = conn.query_row(
        "SELECT content FROM notes WHERE id = ?",
        params![note_id],
        |row| row.get(0),
    ).map_err(|_| AppError::NotFound(note_id.to_string()))?;
    Ok(content)
}

/// 列出日志摘要（用于瀑布流视图，含 task_lines）
pub fn list_daily_notes_summary(conn: &Connection) -> Result<Vec<NoteSummary>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, folder_id, status, priority, starred, pinned, is_encrypted, \
         created_at, updated_at, deleted_at, due_date, reminder, parent_task_id, note_type, journal_date, content \
         FROM notes \
         WHERE note_type = 'daily' AND deleted_at IS NULL \
         ORDER BY journal_date DESC \
         LIMIT 100"
    )?;

    let notes = stmt.query_map([], |row| {
        let is_encrypted: i64 = row.get(7)?;
        let content: String = row.get(16)?;
        let (task_lines, block_ids, wiki_links) = if is_encrypted != 0 {
            (vec![], vec![], vec![])
        } else {
            (extract_task_lines(&content), extract_block_ids(&content), extract_wiki_links(&content))
        };
        Ok(NoteSummary {
            id: row.get(0)?,
            title: row.get(1)?,
            folder_id: row.get(2)?,
            status: row.get(3)?,
            priority: row.get(4)?,
            starred: row.get::<_, i64>(5)? != 0,
            pinned: row.get::<_, i64>(6)? != 0,
            is_encrypted: is_encrypted != 0,
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
            deleted_at: row.get(10)?,
            tags: vec![],
            due_date: row.get(11)?,
            reminder: row.get(12)?,
            parent_task_id: row.get(13)?,
            note_type: row.get::<_, Option<String>>(14)?.unwrap_or_else(|| "note".to_string()),
            journal_date: row.get(15)?,
            task_lines,
            block_ids,
            wiki_links,
        })
    })?;

    let mut result = vec![];
    for note in notes {
        result.push(note?);
    }

    batch_load_tags_summary(conn, &mut result)?;

    Ok(result)
}

pub fn update_note(conn: &Connection, req: UpdateNoteRequest) -> Result<Note, AppError> {
    let now = chrono::Utc::now().timestamp_millis();

    // 使用 get_note_with_deleted 以支持恢复已删除笔记
    let _existing = get_note_with_deleted(conn, &req.id)?;

    if let Some(title) = &req.title {
        conn.execute("UPDATE notes SET title = ?, updated_at = ? WHERE id = ?",
            params![title, now, req.id])?;
    }
    if let Some(content) = &req.content {
        conn.execute("UPDATE notes SET content = ?, updated_at = ? WHERE id = ?",
            params![content, now, req.id])?;
    }
    if let Some(folder_id) = &req.folder_id {
        conn.execute("UPDATE notes SET folder_id = ?, updated_at = ? WHERE id = ?",
            params![folder_id, now, req.id])?;
    }
    if let Some(created_at) = req.created_at {
        conn.execute("UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?",
            params![created_at, now, req.id])?;
    }
    if let Some(due_date) = &req.due_date {
        conn.execute("UPDATE notes SET due_date = ?, updated_at = ? WHERE id = ?",
            params![due_date, now, req.id])?;
    }
    if let Some(deleted_at) = req.deleted_at {
        conn.execute("UPDATE notes SET deleted_at = ?, updated_at = ? WHERE id = ?",
            params![deleted_at, now, req.id])?;
        // 软删除后 get_note 会因 deleted_at IS NULL 条件查不到，直接返回
        return get_note_with_deleted(conn, &req.id);
    }

    get_note(conn, &req.id)
}

pub fn delete_note(conn: &Connection, note_id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM notes WHERE id = ?", params![note_id])?;
    Ok(())
}

pub fn restore_note(conn: &Connection, note_id: &str) -> Result<Note, AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute("UPDATE notes SET deleted_at = NULL, updated_at = ? WHERE id = ?",
        params![now, note_id])?;
    get_note_with_deleted(conn, note_id)
}

pub fn toggle_note_status(conn: &Connection, note_id: &str) -> Result<Note, AppError> {
    let note = get_note(conn, note_id)?;
    let new_status = if note.status == "todo" { "done" } else { "todo" };
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute("UPDATE notes SET status = ?, updated_at = ? WHERE id = ?",
        params![new_status, now, note_id])?;
    get_note(conn, note_id)
}

pub fn set_note_priority(conn: &Connection, note_id: &str, priority: &str) -> Result<Note, AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute("UPDATE notes SET priority = ?, updated_at = ? WHERE id = ?",
        params![priority, now, note_id])?;
    get_note(conn, note_id)
}

pub fn set_note_starred(conn: &Connection, note_id: &str, starred: bool) -> Result<Note, AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute("UPDATE notes SET starred = ?, updated_at = ? WHERE id = ?",
        params![if starred { 1 } else { 0 }, now, note_id])?;
    get_note(conn, note_id)
}

pub fn set_note_pinned(conn: &Connection, note_id: &str, pinned: bool) -> Result<Note, AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute("UPDATE notes SET pinned = ?, updated_at = ? WHERE id = ?",
        params![if pinned { 1 } else { 0 }, now, note_id])?;
    get_note(conn, note_id)
}

pub fn set_note_tags(conn: &Connection, note_id: &str, tag_names: &[String]) -> Result<Note, AppError> {
    // 先删除旧的关联
    conn.execute("DELETE FROM note_tags WHERE note_id = ?", params![note_id])?;

    // 为每个标签名查找或创建 tag，然后关联
    for name in tag_names {
        let tag_id: String = match conn.query_row(
            "SELECT id FROM tags WHERE name = ?", params![name],
            |row| row.get(0),
        ) {
            Ok(id) => id,
            Err(_) => {
                let new_id = uuid::Uuid::new_v4().to_string();
                conn.execute(
                    "INSERT INTO tags (id, name, color) VALUES (?, ?, '#4A90D9')",
                    params![new_id, name],
                )?;
                new_id
            }
        };
        conn.execute(
            "INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)",
            params![note_id, tag_id],
        )?;
    }

    get_note(conn, note_id)
}

pub fn get_note_tags(conn: &Connection, note_id: &str) -> Result<Vec<String>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT t.name FROM tags t
         JOIN note_tags nt ON t.id = nt.tag_id
         WHERE nt.note_id = ?"
    )?;
    let tags = stmt.query_map(params![note_id], |row| row.get::<_, String>(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(tags)
}

pub fn count_notes(conn: &Connection) -> Result<usize, AppError> {
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM notes WHERE deleted_at IS NULL", [], |row| row.get(0)
    )?;
    Ok(count as usize)
}

pub fn count_notes_by_folder(conn: &Connection) -> Result<Vec<FolderNoteCount>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT folder_id, COUNT(*) as cnt FROM notes WHERE deleted_at IS NULL AND (note_type IS NULL OR note_type != 'daily') GROUP BY folder_id"
    )?;
    let counts = stmt.query_map([], |row| {
        Ok(FolderNoteCount {
            folder_id: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
            count: row.get(1)?,
        })
    })?.filter_map(|r| r.ok()).collect();
    Ok(counts)
}

/// 热力图数据：按日期统计笔记活动（创建+编辑）
pub fn get_activity_heatmap(conn: &Connection, days: i64) -> Result<Vec<ActivityDay>, AppError> {
    let now = chrono::Utc::now().timestamp_millis();
    let start = now - days * 24 * 60 * 60 * 1000;

    let mut stmt = conn.prepare(
        "SELECT date(created_at / 1000, 'unixepoch') as day, COUNT(*) as cnt FROM notes
         WHERE created_at >= ? AND deleted_at IS NULL
         GROUP BY day
         UNION ALL
         SELECT date(updated_at / 1000, 'unixepoch') as day, COUNT(*) as cnt FROM notes
         WHERE updated_at >= ? AND deleted_at IS NULL AND updated_at != created_at
         GROUP BY day"
    )?;

    let rows = stmt.query_map(params![start, start], |row| {
        Ok(ActivityDay {
            date: row.get(0)?,
            count: row.get(1)?,
        })
    })?.filter_map(|r| r.ok()).collect();
    Ok(rows)
}

/// 获取每日日志笔记（仅获取，不自动创建）
pub fn get_daily_note(conn: &Connection, date: &str) -> Result<Option<Note>, AppError> {
    let existing = conn.query_row(
        "SELECT id FROM notes WHERE journal_date = ? AND note_type = 'daily' AND deleted_at IS NULL",
        params![date],
        |row| row.get::<_, String>(0),
    );

    match existing {
        Ok(id) => {
            let note = get_note(conn, &id)?;
            Ok(Some(note))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Db(e)),
    }
}

/// 创建每日日志笔记
pub fn create_daily_note(conn: &Connection, date: &str) -> Result<Note, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let title = date.to_string();
    let content = generate_daily_template(date);

    conn.execute(
        "INSERT INTO notes (id, title, content, folder_id, status, priority, starred, pinned, is_encrypted, created_at, updated_at, note_type, journal_date)
         VALUES (?, ?, ?, NULL, 'todo', 'medium', 0, 0, 0, ?, ?, 'daily', ?)",
        params![id, title, content, now, now, date],
    )?;

    get_note(conn, &id)
}

/// 获取或创建每日日志笔记（用于兼容旧接口）
pub fn get_or_create_daily_note(conn: &Connection, date: &str) -> Result<Note, AppError> {
    // 先查找是否已存在（包括已软删除的），优先返回未删除且最新的一条
    let existing = conn.query_row(
        "SELECT id, deleted_at FROM notes
         WHERE journal_date = ? AND note_type = 'daily'
         ORDER BY deleted_at IS NULL DESC, updated_at DESC
         LIMIT 1",
        params![date],
        |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?)),
    );

    if let Ok((id, deleted_at)) = existing {
        // 如果已软删除，恢复它
        if deleted_at.is_some() {
            conn.execute(
                "UPDATE notes SET deleted_at = NULL, updated_at = ? WHERE id = ?",
                params![chrono::Utc::now().timestamp_millis(), id],
            )?;
        }
        return get_note(conn, &id);
    }

    // 不存在，创建新的每日日志
    let id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Utc::now().timestamp_millis();
    let title = date.to_string();
    let content = generate_daily_template(date);

    conn.execute(
        "INSERT INTO notes (id, title, content, folder_id, status, priority, starred, pinned, is_encrypted, created_at, updated_at, note_type, journal_date)
         VALUES (?, ?, ?, NULL, 'todo', 'medium', 0, 0, 0, ?, ?, 'daily', ?)",
        params![id, title, content, now, now, date],
    )?;

    get_note(conn, &id)
}

/// 生成每日日志模板内容（含 Logseq 风格待办示例）
fn generate_daily_template(date: &str) -> String {
    use chrono::NaiveDate;

    let weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

    let header = if let Ok(d) = NaiveDate::parse_from_str(date, "%Y-%m-%d") {
        let year = d.format("%Y").to_string();
        let month = d.format("%m").to_string().trim_start_matches('0').parse::<u32>().unwrap_or(0).to_string();
        let day = d.format("%d").to_string().trim_start_matches('0').parse::<u32>().unwrap_or(0).to_string();
        let weekday = weekdays[d.weekday().num_days_from_sunday() as usize];
        format!("# {}年{}月{}日 {}", year, month, day, weekday)
    } else {
        format!("# {}", date)
    };

    format!(
        "{}\n\n## 今日待办\n\n- TODO 重要且紧急的任务\n- NOW 今天必须完成的事项\n- LATER 重要但不紧急\n\n## 进行中\n\n- DOING 正在处理的工作\n\n## 笔记\n\n",
        header
    )
}

/// 列出所有待办任务（用于每日日志的待办提醒）
#[allow(dead_code)]
pub fn list_pending_tasks(conn: &Connection) -> Result<Vec<PendingTask>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT n.id, n.title, n.status, n.priority, n.due_date, f.name
         FROM notes n
         LEFT JOIN folders f ON n.folder_id = f.id
         WHERE n.status = 'todo'
           AND (n.note_type IS NULL OR n.note_type != 'daily')
           AND n.deleted_at IS NULL
         ORDER BY
           CASE n.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
           n.due_date ASC NULLS LAST"
    )?;

    let tasks = stmt.query_map([], |row| {
        Ok(PendingTask {
            id: row.get(0)?,
            title: row.get(1)?,
            status: row.get(2)?,
            priority: row.get(3)?,
            due_date: row.get(4)?,
            folder_name: row.get(5)?,
        })
    })?.filter_map(|r| r.ok()).collect();

    Ok(tasks)
}

pub fn list_daily_notes(conn: &Connection) -> Result<Vec<Note>, AppError> {
    let mut stmt = conn.prepare(
        "SELECT id, title, content, folder_id, status, priority, starred, pinned, is_encrypted, \
         created_at, updated_at, deleted_at, due_date, reminder, parent_task_id, note_type, journal_date \
         FROM notes \
         WHERE note_type = 'daily' AND deleted_at IS NULL \
         ORDER BY journal_date DESC \
         LIMIT 100"
    )?;

    let notes = stmt.query_map([], |row| {
        Ok(Note {
            id: row.get(0)?,
            title: row.get(1)?,
            content: row.get(2)?,
            folder_id: row.get(3)?,
            status: row.get(4)?,
            priority: row.get(5)?,
            starred: row.get::<_, i64>(6)? != 0,
            pinned: row.get::<_, i64>(7)? != 0,
            is_encrypted: row.get::<_, i64>(8)? != 0,
            created_at: row.get(9)?,
            updated_at: row.get(10)?,
            deleted_at: row.get(11)?,
            tags: vec![],
            due_date: row.get(12)?,
            reminder: row.get(13)?,
            parent_task_id: row.get(14)?,
            note_type: row.get::<_, Option<String>>(15)?.unwrap_or_else(|| "note".to_string()),
            journal_date: row.get(16)?,
        })
    })?;

    let mut result = vec![];
    for note in notes {
        let n = note?;
        result.push(n);
    }

    // 批量加载 tags
    batch_load_tags(conn, &mut result)?;

    Ok(result)
}
