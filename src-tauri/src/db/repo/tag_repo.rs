use rusqlite::{params, Connection};
use crate::models::*;
use crate::error::AppError;

pub fn list_tags(conn: &Connection) -> Result<Vec<Tag>, AppError> {
    let mut stmt = conn.prepare("SELECT id, name, color FROM tags ORDER BY name")?;
    let tags = stmt.query_map([], |row| {
        Ok(Tag {
            id: row.get(0)?,
            name: row.get(1)?,
            color: row.get(2)?,
        })
    })?.filter_map(|r| r.ok()).collect();
    Ok(tags)
}

pub fn create_tag(conn: &Connection, name: &str, color: &str) -> Result<Tag, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO tags (id, name, color) VALUES (?, ?, ?)",
        params![id, name, color],
    )?;
    Ok(Tag { id, name: name.to_string(), color: color.to_string() })
}

pub fn delete_tag(conn: &Connection, tag_id: &str) -> Result<(), AppError> {
    conn.execute("DELETE FROM tags WHERE id = ?", params![tag_id])?;
    Ok(())
}

pub fn list_folders(conn: &Connection) -> Result<Vec<Folder>, AppError> {
    let mut stmt = conn.prepare("SELECT id, name, parent_id, color, sort_order FROM folders ORDER BY sort_order")?;
    let folders = stmt.query_map([], |row| {
        Ok(Folder {
            id: row.get(0)?,
            name: row.get(1)?,
            parent_id: row.get(2)?,
            color: row.get(3)?,
            sort_order: row.get(4)?,
        })
    })?.filter_map(|r| r.ok()).collect();
    Ok(folders)
}

pub fn create_folder(conn: &Connection, name: &str, color: &str, parent_id: Option<&str>) -> Result<Folder, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    // 查找同级最大 sort_order
    let max_sort: i64 = match parent_id {
        Some(pid) => conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM folders WHERE parent_id = ?",
            params![pid], |row| row.get(0),
        ).unwrap_or(-1),
        None => conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) FROM folders WHERE parent_id IS NULL",
            [], |row| row.get(0),
        ).unwrap_or(-1),
    };
    let sort_order = max_sort + 1;
    conn.execute(
        "INSERT INTO folders (id, name, parent_id, color, sort_order) VALUES (?, ?, ?, ?, ?)",
        params![id, name, parent_id, color, sort_order],
    )?;
    Ok(Folder {
        id,
        name: name.to_string(),
        parent_id: parent_id.map(|s| s.to_string()),
        color: color.to_string(),
        sort_order,
    })
}

pub fn delete_folder(conn: &Connection, folder_id: &str) -> Result<(), AppError> {
    // 将该文件夹下的笔记移到默认文件夹
    conn.execute("UPDATE notes SET folder_id = 'default' WHERE folder_id = ?", params![folder_id])?;
    conn.execute("DELETE FROM folders WHERE id = ?", params![folder_id])?;
    Ok(())
}

pub fn update_folder(
    conn: &Connection,
    folder_id: &str,
    name: Option<&str>,
    color: Option<&str>,
    parent_id: Option<Option<&str>>,
) -> Result<(), AppError> {
    if let Some(n) = name {
        conn.execute("UPDATE folders SET name = ? WHERE id = ?", params![n, folder_id])?;
    }
    if let Some(c) = color {
        conn.execute("UPDATE folders SET color = ? WHERE id = ?", params![c, folder_id])?;
    }
    if let Some(pid) = parent_id {
        // 防止把文件夹移动到自己或自己的后代
        if let Some(p) = pid {
            if p == folder_id {
                return Err(AppError::Internal("不能将文件夹移动到自身".into()));
            }
            // 检查是否为后代
            let mut current: Option<String> = Some(p.to_string());
            while let Some(cur) = current {
                if cur == folder_id {
                    return Err(AppError::Internal("不能将文件夹移动到自己的后代".into()));
                }
                let parent: Option<String> = conn
                    .query_row(
                        "SELECT parent_id FROM folders WHERE id = ?",
                        params![cur],
                        |row| row.get::<_, Option<String>>(0),
                    )
                    .unwrap_or(None);
                current = parent;
            }
        }
        // 更新 sort_order 为同级最大 + 1
        let max_sort: i64 = match pid {
            Some(p) => conn
                .query_row(
                    "SELECT COALESCE(MAX(sort_order), -1) FROM folders WHERE parent_id = ? AND id != ?",
                    params![p, folder_id],
                    |row| row.get(0),
                )
                .unwrap_or(-1),
            None => conn
                .query_row(
                    "SELECT COALESCE(MAX(sort_order), -1) FROM folders WHERE parent_id IS NULL AND id != ?",
                    params![folder_id],
                    |row| row.get(0),
                )
                .unwrap_or(-1),
        };
        conn.execute(
            "UPDATE folders SET parent_id = ?, sort_order = ? WHERE id = ?",
            params![pid, max_sort + 1, folder_id],
        )?;
    }
    Ok(())
}
