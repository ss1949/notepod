use rusqlite::{Connection};
use crate::models::*;
use crate::error::AppError;

/// 动态查询笔记（多维度筛选）
pub fn query_notes(conn: &Connection, params: &QueryParams) -> Result<Vec<NoteRow>, AppError> {
    let mut sql = String::from(
        "SELECT DISTINCT n.id, n.title, n.content, n.status, n.priority, n.starred, n.pinned, n.created_at, n.updated_at, n.note_type
         FROM notes n
         LEFT JOIN note_tags nt ON n.id = nt.note_id
         LEFT JOIN tags t ON nt.tag_id = t.id
         WHERE n.deleted_at IS NULL"
    );

    let mut param_values: Vec<Box<dyn rusqlite::ToSql>> = vec![];

    // 关键词搜索（标题 + 内容）
    if let Some(keyword) = &params.keyword {
        if !keyword.is_empty() {
            sql.push_str(" AND (n.title LIKE ? OR n.content LIKE ?)");
            let pattern = format!("%{}%", keyword);
            param_values.push(Box::new(pattern.clone()));
            param_values.push(Box::new(pattern));
        }
    }

    // 日期范围
    if let Some(date_from) = params.date_from {
        sql.push_str(" AND n.created_at >= ?");
        param_values.push(Box::new(date_from));
    }
    if let Some(date_to) = params.date_to {
        sql.push_str(" AND n.created_at <= ?");
        param_values.push(Box::new(date_to));
    }

    // 标签筛选（OR 逻辑）
    if !params.tag_ids.is_empty() {
        let placeholders: Vec<&str> = params.tag_ids.iter().map(|_| "?").collect();
        sql.push_str(&format!(" AND t.id IN ({})", placeholders.join(", ")));
        for tid in &params.tag_ids {
            param_values.push(Box::new(tid.clone()));
        }
    }

    // 优先级筛选
    if !params.priorities.is_empty() {
        let placeholders: Vec<&str> = params.priorities.iter().map(|_| "?").collect();
        sql.push_str(&format!(" AND n.priority IN ({})", placeholders.join(", ")));
        for p in &params.priorities {
            param_values.push(Box::new(p.clone()));
        }
    }

    // 状态筛选
    if let Some(status) = &params.status {
        if status != "all" && !status.is_empty() {
            sql.push_str(" AND n.status = ?");
            param_values.push(Box::new(status.clone()));
        }
    }

    // 笔记类型筛选
    if let Some(note_type) = &params.note_type {
        if note_type != "all" && !note_type.is_empty() {
            sql.push_str(" AND n.note_type = ?");
            param_values.push(Box::new(note_type.clone()));
        }
    }

    // 仅加星
    if params.starred_only {
        sql.push_str(" AND n.starred = 1");
    }

    // 排序：置顶优先，然后按更新时间降序
    sql.push_str(" ORDER BY n.pinned DESC, n.updated_at DESC");

    // 分页
    if let Some(limit) = params.limit {
        sql.push_str(&format!(" LIMIT {}", limit));
        if let Some(offset) = params.offset {
            sql.push_str(&format!(" OFFSET {}", offset));
        }
    }

    let mut stmt = conn.prepare(&sql)?;
    let param_refs: Vec<&dyn rusqlite::ToSql> = param_values.iter().map(|p| p.as_ref()).collect();

    let rows = stmt.query_map(param_refs.as_slice(), |row| {
        let title: String = row.get(1)?;
        let content: String = row.get(2)?;
        let preview: String = content.chars().take(120).collect();

        Ok(NoteRow {
            id: row.get(0)?,
            title,
            content_preview: preview,
            tags: vec![],
            priority: row.get(4)?,
            status: row.get(3)?,
            starred: row.get::<_, i64>(5)? != 0,
            pinned: row.get::<_, i64>(6)? != 0,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            note_type: row.get::<_, Option<String>>(9)?.unwrap_or_else(|| "note".to_string()),
        })
    })?;

    let mut result = vec![];
    for row in rows {
        let mut r = row?;
        // 获取每条笔记的标签
        let mut tag_stmt = conn.prepare(
            "SELECT t.name FROM tags t JOIN note_tags nt ON t.id = nt.tag_id WHERE nt.note_id = ?"
        )?;
        let tags: Vec<String> = tag_stmt.query_map(rusqlite::params![r.id], |t| t.get::<_, String>(0))?
            .filter_map(|t| t.ok())
            .collect();
        r.tags = tags;
        result.push(r);
    }

    Ok(result)
}
