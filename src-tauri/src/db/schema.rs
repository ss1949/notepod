use rusqlite::Connection;

/// 初始化数据库 schema
pub fn init_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS notes (
            id           TEXT PRIMARY KEY,
            title        TEXT NOT NULL DEFAULT '',
            content      TEXT NOT NULL DEFAULT '',
            folder_id    TEXT REFERENCES folders(id),
            status       TEXT NOT NULL DEFAULT 'todo'
                           CHECK(status IN ('todo', 'done')),
            priority     TEXT NOT NULL DEFAULT 'medium'
                           CHECK(priority IN ('high', 'medium', 'low')),
            starred      INTEGER NOT NULL DEFAULT 0,
            pinned       INTEGER NOT NULL DEFAULT 0,
            is_encrypted INTEGER NOT NULL DEFAULT 0,
            created_at   INTEGER NOT NULL,
            updated_at   INTEGER NOT NULL,
            deleted_at   INTEGER,
            due_date     INTEGER,
            reminder     INTEGER,
            parent_task_id TEXT REFERENCES notes(id) ON DELETE SET NULL
        );

        CREATE TABLE IF NOT EXISTS folders (
            id         TEXT PRIMARY KEY,
            name       TEXT NOT NULL,
            parent_id  TEXT REFERENCES folders(id),
            color      TEXT DEFAULT '#888888',
            sort_order INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS tags (
            id    TEXT PRIMARY KEY,
            name  TEXT UNIQUE NOT NULL,
            color TEXT DEFAULT '#888888'
        );

        CREATE TABLE IF NOT EXISTS note_tags (
            note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            tag_id  TEXT NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
            PRIMARY KEY(note_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS attachments (
            id       TEXT PRIMARY KEY,
            note_id  TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            filename TEXT NOT NULL,
            mime     TEXT NOT NULL,
            size     INTEGER NOT NULL,
            blob     BLOB
        );

        CREATE TABLE IF NOT EXISTS git_config (
            id            TEXT PRIMARY KEY,
            repo_url      TEXT NOT NULL,
            username      TEXT NOT NULL,
            credential    TEXT NOT NULL,
            author_name   TEXT,
            author_email  TEXT,
            last_sync_at  TEXT
        );

        CREATE TABLE IF NOT EXISTS lock_config (
            id       TEXT PRIMARY KEY,
            password TEXT NOT NULL,
            hint     TEXT NOT NULL,
            -- 加密相关字段（合并后单密码方案：锁屏密码即加密密码）
            salt            TEXT,
            wrapped_key     TEXT,
            verify          TEXT,
            kdf_m_cost      INTEGER,
            kdf_t_cost      INTEGER,
            kdf_p_cost      INTEGER,
            enc_version     INTEGER
        );

        CREATE TABLE IF NOT EXISTS enc_config (
            id              TEXT PRIMARY KEY DEFAULT 'default',
            version         INTEGER NOT NULL DEFAULT 1,
            kdf_algorithm   TEXT NOT NULL DEFAULT 'Argon2id',
            salt            TEXT NOT NULL,
            kdf_m_cost      INTEGER NOT NULL DEFAULT 65536,
            kdf_t_cost      INTEGER NOT NULL DEFAULT 3,
            kdf_p_cost      INTEGER NOT NULL DEFAULT 4,
            wrapped_key     TEXT NOT NULL,
            verify          TEXT NOT NULL
        );
        ",
    )?;

    // 迁移：为已有数据库添加新字段（必须在创建索引之前）
    migrate_add_columns(conn)?;

    // 迁移：合并 enc_config 到 lock_config（单密码方案）
    migrate_merge_enc_into_lock(conn)?;

    // 创建索引
    conn.execute_batch(
        "
        CREATE INDEX IF NOT EXISTS idx_notes_status   ON notes(status);
        CREATE INDEX IF NOT EXISTS idx_notes_priority ON notes(priority);
        CREATE INDEX IF NOT EXISTS idx_notes_starred  ON notes(starred);
        CREATE INDEX IF NOT EXISTS idx_notes_pinned   ON notes(pinned);
        CREATE INDEX IF NOT EXISTS idx_notes_created  ON notes(created_at);
        CREATE INDEX IF NOT EXISTS idx_notes_updated  ON notes(updated_at);
        CREATE INDEX IF NOT EXISTS idx_notes_due_date ON notes(due_date);
        CREATE INDEX IF NOT EXISTS idx_notes_parent   ON notes(parent_task_id);
        CREATE INDEX IF NOT EXISTS idx_notes_journal  ON notes(journal_date) WHERE journal_date IS NOT NULL;
        CREATE INDEX IF NOT EXISTS idx_note_tags_note ON note_tags(note_id);
        CREATE INDEX IF NOT EXISTS idx_note_tags_tag  ON note_tags(tag_id);
        ",
    )?;

    // 迁移：每日日志按日期去重并添加唯一索引，防止同一日期出现多条日志
    migrate_daily_note_unique(conn)?;

    // 插入默认文件夹（如果不存在）
    conn.execute(
        "INSERT OR IGNORE INTO folders (id, name, color, sort_order) VALUES (?, ?, ?, ?)",
        rusqlite::params!["default", "默认", "#4A90D9", 0],
    )?;

    Ok(())
}

/// 迁移：每日日志按日期去重，并建立唯一索引
fn migrate_daily_note_unique(conn: &Connection) -> Result<(), rusqlite::Error> {
    // 删除同一日期的重复 daily 记录（按 deleted_at 分组，保留 rowid 最大的一条）
    conn.execute(
        "DELETE FROM notes
         WHERE note_type = 'daily'
           AND rowid NOT IN (
             SELECT MAX(rowid) FROM notes
             WHERE note_type = 'daily'
             GROUP BY journal_date, deleted_at
           )",
        [],
    )?;
    // 建立部分唯一索引，防止后续再次产生重复
    conn.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_notes_journal_unique
         ON notes(note_type, journal_date, deleted_at)
         WHERE note_type = 'daily'",
        [],
    )?;
    Ok(())
}

/// 迁移：添加新字段（如果不存在）
fn migrate_add_columns(conn: &Connection) -> Result<(), rusqlite::Error> {
    let columns = [
        ("deleted_at", "INTEGER"),
        ("due_date", "INTEGER"),
        ("reminder", "INTEGER"),
        ("parent_task_id", "TEXT REFERENCES notes(id) ON DELETE SET NULL"),
        ("note_type", "TEXT NOT NULL DEFAULT 'note'"),
        ("journal_date", "TEXT"),
    ];

    for (col, def) in columns {
        // 检查列是否存在
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_xinfo('notes') WHERE name = ?",
                rusqlite::params![col],
                |row| row.get::<_, i32>(0),
            )
            .unwrap_or(0) > 0;

        if !exists {
            conn.execute(&format!("ALTER TABLE notes ADD COLUMN {} {}", col, def), [])?;
        }
    }

    // 迁移：为 lock_config 添加加密相关字段（旧表可能不存在这些列）
    let lock_columns = [
        ("salt", "TEXT"),
        ("wrapped_key", "TEXT"),
        ("verify", "TEXT"),
        ("kdf_m_cost", "INTEGER"),
        ("kdf_t_cost", "INTEGER"),
        ("kdf_p_cost", "INTEGER"),
        ("enc_version", "INTEGER"),
    ];

    for (col, def) in lock_columns {
        let exists: bool = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_xinfo('lock_config') WHERE name = ?",
                rusqlite::params![col],
                |row| row.get::<_, i32>(0),
            )
            .unwrap_or(0) > 0;

        if !exists {
            conn.execute(&format!("ALTER TABLE lock_config ADD COLUMN {} {}", col, def), [])?;
        }
    }

    Ok(())
}

/// 迁移：合并 enc_config 到 lock_config（单密码方案）
/// 如果 lock_config 已有密码但 salt 为空，且 enc_config 存在，则复制加密字段过来
fn migrate_merge_enc_into_lock(conn: &Connection) -> Result<(), rusqlite::Error> {
    // 检查 lock_config 是否有密码但没 salt（需要迁移）
    let need_migrate: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM lock_config
             WHERE id = 'default' AND password IS NOT NULL
               AND (salt IS NULL OR salt = '')",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) > 0;

    if !need_migrate {
        return Ok(());
    }

    // 检查 enc_config 是否存在
    let enc_exists: bool = conn
        .query_row(
            "SELECT COUNT(*) FROM enc_config WHERE id = 'default'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .unwrap_or(0) > 0;

    if !enc_exists {
        // enc_config 不存在：用户只设了锁屏密码没启用加密，无需迁移
        return Ok(());
    }

    // 从 enc_config 复制加密字段到 lock_config
    let enc_data = conn.query_row(
        "SELECT version, salt, kdf_m_cost, kdf_t_cost, kdf_p_cost, wrapped_key, verify
         FROM enc_config WHERE id = 'default'",
        [],
        |row| {
            Ok((
                row.get::<_, i32>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i32>(2)?,
                row.get::<_, i32>(3)?,
                row.get::<_, i32>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        },
    );

    if let Ok((version, salt, m_cost, t_cost, p_cost, wrapped_key, verify)) = enc_data {
        conn.execute(
            "UPDATE lock_config SET
                salt = ?, wrapped_key = ?, verify = ?,
                kdf_m_cost = ?, kdf_t_cost = ?, kdf_p_cost = ?,
                enc_version = ?
             WHERE id = 'default'",
            rusqlite::params![salt, wrapped_key, verify, m_cost, t_cost, p_cost, version],
        )?;
        log::info!("已将 enc_config 加密字段迁移到 lock_config");
    }

    Ok(())
}

/// 获取 schema 版本
#[allow(dead_code)]
pub fn get_schema_version(conn: &Connection) -> u32 {
    conn.query_row(
        "SELECT value FROM schema_version WHERE key = 'version'",
        [],
        |row| {
            let s: String = row.get(0)?;
            s.parse::<u32>().map_err(|e| rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(e)))
        },
    )
    .unwrap_or(1)
}

/// 设置 schema 版本
#[allow(dead_code)]
pub fn set_schema_version(conn: &Connection, version: u32) -> Result<(), rusqlite::Error> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_version (key TEXT PRIMARY KEY, value TEXT)",
        [],
    )?;
    conn.execute(
        "INSERT OR REPLACE INTO schema_version (key, value) VALUES ('version', ?)",
        rusqlite::params![version.to_string()],
    )?;
    Ok(())
}
