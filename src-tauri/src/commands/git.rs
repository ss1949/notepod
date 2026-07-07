use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::io::Read;
use std::thread;
use tauri::Emitter;
use std::time::{Duration, Instant};
use tauri::State;
use tauri::Manager;
use crate::crypto;
use crate::models::*;
use crate::error::AppError;
use crate::AppState;
use crate::db::repo::note_repo;
use super::gix_ops::GixOps;

/// Git 命令超时时间（秒）（旧 CLI 方式保留）
const GIT_TIMEOUT_SECS: u64 = 60;

/// 运行带超时的 git 命令，禁用交互式凭据提示（旧 CLI 方式，保留用于回退）
#[allow(dead_code)]
fn run_git_with_timeout(cmd: &mut Command) -> Result<std::process::Output, AppError> {
    // 禁用交互式凭据提示
    cmd.env("GIT_TERMINAL_PROMPT", "0")
       .env("GCM_INTERACTIVE", "never")
       .stdout(Stdio::piped())
       .stderr(Stdio::piped());

    // eprintln!("[git] 启动命令: {:?}", cmd);

    let mut child = cmd.spawn()
        .map_err(|e| AppError::Internal(format!("执行 {:?} 失败: {}", cmd.get_program(), e)))?;

    let start = Instant::now();
    let timeout = Duration::from_secs(GIT_TIMEOUT_SECS);

    // 在后台线程读取 stdout 和 stderr，防止死锁
    let mut stdout = child.stdout.take().unwrap();
    let mut stderr = child.stderr.take().unwrap();

    let stdout_handle = thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stdout.read_to_end(&mut buffer);
        buffer
    });

    let stderr_handle = thread::spawn(move || {
        let mut buffer = Vec::new();
        let _ = stderr.read_to_end(&mut buffer);
        buffer
    });

    // 等待子进程完成或超时
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                // eprintln!("[git] 命令完成: {:?} 退出码={}", cmd.get_program(), status.code().unwrap_or(-1));
                let stdout_bytes = stdout_handle.join().unwrap_or_default();
                let stderr_bytes = stderr_handle.join().unwrap_or_default();

                return Ok(std::process::Output {
                    status,
                    stdout: stdout_bytes,
                    stderr: stderr_bytes,
                });
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    // eprintln!("[git] 命令超时: {:?}，杀死进程", cmd.get_program());
                    let _ = child.kill();
                    let _ = child.wait();
                    // 超时不等待读取线程，直接返回错误
                    return Err(AppError::Internal(format!(
                        "Git 命令执行超时（{}秒），请检查网络连接或仓库地址", GIT_TIMEOUT_SECS
                    )));
                }
                thread::sleep(Duration::from_millis(100));
            }
            Err(e) => {
                // eprintln!("[git] 等待进程失败: {:?}", e);
                return Err(AppError::Internal(format!("等待 Git 进程失败: {}", e)));
            }
        }
    }
}

/// 保存 Git 配置
#[tauri::command]
pub async fn save_git_config(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    config: GitConfig,
) -> Result<GitConfigSaveResult, AppError> {
    let mk_opt = {
        let mk = state.master_key.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        mk.clone()
    };

    let stored_credential = match &mk_opt {
        Some(mk) => crypto::encrypt_credential(&config.credential, mk)?,
        None => config.credential.clone(),
    };

    let auth_url = build_authenticated_url(&config.repo_url, &config.username, &config.credential);

    let work_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Internal(format!("获取应用数据目录失败: {}", e)))?;

    GixOps::ls_remote(&auth_url, &config.username, &config.credential, &work_dir)?;

    {
        let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        conn.execute(
            "INSERT OR REPLACE INTO git_config (id, repo_url, username, credential, author_name, author_email, last_sync_at)
             VALUES ('default', ?, ?, ?, ?, ?, ?)",
            rusqlite::params![
                config.repo_url,
                config.username,
                stored_credential,
                config.author_name,
                config.author_email,
                config.last_sync_at,
            ],
        )?;
    }

    let repo_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Internal(format!("获取应用数据目录失败: {}", e)))?
        .join("git-backup");

    let has_encryption = if !repo_dir.exists() {
        match GixOps::clone_repo(&auth_url, &repo_dir, &config.username, &config.credential) {
            Ok(_) => {
                let key_path = repo_dir.join(".notepod").join("key.json");
                key_path.exists()
            }
            Err(_) => false,
        }
    } else {
        let repo = GixOps::open_repo(&repo_dir)?;
        let _ = GixOps::set_remote_url(&repo, "origin", &auth_url);
        let _ = git_pull(&repo_dir, &config.username, &config.credential);
        let key_path = repo_dir.join(".notepod").join("key.json");
        key_path.exists()
    };

    Ok(GitConfigSaveResult { has_encryption })
}

/// 获取 Git 配置
#[tauri::command]
pub async fn get_git_config(
    state: State<'_, AppState>,
) -> Result<Option<GitConfig>, AppError> {
    let config_opt = {
        let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let result = conn.query_row(
            "SELECT repo_url, username, credential, author_name, author_email, last_sync_at FROM git_config WHERE id = 'default'",
            [],
            |row| {
                Ok(GitConfig {
                    repo_url: row.get(0)?,
                    username: row.get(1)?,
                    credential: row.get(2)?,
                    author_name: row.get(3)?,
                    author_email: row.get(4)?,
                    last_sync_at: row.get(5)?,
                })
            },
        );
        match result {
            Ok(config) => Some(config),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(AppError::Db(e)),
        }
    };

    match config_opt {
        Some(mut config) => {
            config.credential = decrypt_credential_with_mk(&state, &config.credential)?;
            Ok(Some(config))
        }
        None => Ok(None),
    }
}

/// Git 备份（上传）
#[tauri::command]
pub async fn git_backup(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<GitSyncResult, AppError> {
    let config = get_git_config_inner(&state)?
        .ok_or_else(|| AppError::Internal("Git 配置未保存，请先配置仓库信息".to_string()))?;

    let mk = require_master_key(&state)?;
    let plain_credential = crypto::decrypt_credential(&config.credential, &mk)?;
    let plain_config = GitConfig {
        credential: plain_credential.clone(),
        ..config.clone()
    };

    let repo_dir = ensure_repo_dir(&app, &plain_config)?;

    let notes_dir = repo_dir.join("notes");
    let journals_dir = repo_dir.join("journals");
    std::fs::create_dir_all(&notes_dir)?;
    std::fs::create_dir_all(&journals_dir)?;

    check_and_require_enc_config_sync(&app, &state)?;

    // 先 pull，把远程新笔记拉到本地工作目录 + 导入 DB
    let _pull_result = git_pull(&repo_dir, &plain_config.username, &plain_config.credential)?;

    // 导入远程拉取的文件到 DB
    {
        let import_dirs = [&notes_dir, &journals_dir];
        for dir in &import_dirs {
            if !dir.exists() { continue; }
            for entry in std::fs::read_dir(dir)? {
                let entry = entry?;
                let path = entry.path();
                if path.is_dir() { continue; }
                let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
                if name.starts_with('.') || !is_note_file(&path) { continue; }
                let file_content = std::fs::read_to_string(&path)?;
                let plain_md = if is_encrypted_file(&path) {
                    match crypto::decrypt_file_content(file_content.trim(), &mk) {
                        Ok(md) => md,
                        Err(_) => continue,
                    }
                } else { file_content };
                if let Ok(note_data) = parse_markdown_note_from_str(&plain_md) {
                    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
                    if note_data.note_type == "daily" || note_data.journal_date.is_some() {
                        let date = note_data.journal_date.as_deref().unwrap_or(&note_data.id);
                        match note_repo::get_daily_note(&conn, date) {
                            Ok(None) => { import_note_to_db_encrypted(&conn, &note_data, &*state)?; }
                            Ok(Some(existing)) if note_data.updated_at > existing.updated_at => {
                                import_note_to_db_encrypted(&conn, &note_data, &*state)?;
                            }
                            _ => {}
                        }
                    } else {
                        match note_repo::get_note_with_deleted(&conn, &note_data.id) {
                            Err(_) => { import_note_to_db_encrypted(&conn, &note_data, &*state)?; }
                            Ok(existing) if note_data.updated_at > existing.updated_at => {
                                import_note_to_db_encrypted(&conn, &note_data, &*state)?;
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }
    eprintln!("[backup] import done, notes in repo dir: {}",
        std::fs::read_dir(&notes_dir).map(|d| d.count()).unwrap_or(0));
    // 通知前端刷新数据
    let _ = app.emit("sync-completed", ());

    // 重新读取 DB（包含刚拉到的远程笔记）
    let (notes, journals, changed_notes, changed_journals, deleted_count) = {
        let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let notes = note_repo::list_notes(&conn, None)?;
        let journals = note_repo::list_daily_notes(&conn)?;

        let local_count = notes.len() + journals.len();
        if local_count == 0 {
            let remote_has_data = (notes_dir.exists() && std::fs::read_dir(&notes_dir)?.any(|e| e.is_ok()))
                || (journals_dir.exists() && std::fs::read_dir(&journals_dir)?.any(|e| e.is_ok()));
            if remote_has_data {
                return Err(AppError::Internal("本地无数据但云端有数据，不允许备份（避免冲掉云端数据）".to_string()));
            }
        }

        let mut changed_notes = 0;
        for note in &notes {
            let path = notes_dir.join(format!("{}.md.enc", note.id));
            let plain_content = crypto::decrypt_content(&note.content, &mk)?;
            let md_content = note_to_markdown_with_content(note, &plain_content)?;
            if write_if_plain_changed(&path, &md_content, &mk)? { changed_notes += 1; }
        }

        let mut changed_journals = 0;
        for journal in &journals {
            if let Some(date) = &journal.journal_date {
                let path = journals_dir.join(format!("{}.md.enc", date));
                let plain_content = crypto::decrypt_content(&journal.content, &mk)?;
                let md_content = note_to_markdown_with_content(journal, &plain_content)?;
                if write_if_plain_changed(&path, &md_content, &mk)? { changed_journals += 1; }
            }
        }

        let active_note_ids: HashSet<String> = notes.iter().map(|n| n.id.clone()).collect();
        let active_journal_dates: HashSet<String> = journals.iter().filter_map(|n| n.journal_date.clone()).collect();
        let deleted_count = cleanup_deleted_files(&notes_dir, &active_note_ids, &active_journal_dates)?
            + cleanup_deleted_files(&journals_dir, &active_note_ids, &active_journal_dates)?;

        export_key_json(&conn, &repo_dir)?;

        let total_changes = changed_notes + changed_journals + deleted_count;
        if total_changes == 0 {
            let now = chrono::Utc::now().to_rfc3339();
            conn.execute(
                "UPDATE git_config SET last_sync_at = ? WHERE id = 'default'",
                rusqlite::params![now],
            )?;
            return Ok(GitSyncResult {
                success: true,
                message: format!("已是最新状态！共 {} 篇笔记和 {} 篇日志，无需更新", notes.len(), journals.len()),
                synced_at: Some(now),
            });
        }

        (notes, journals, changed_notes, changed_journals, deleted_count)
    };

    let git_config_for_push = GitConfig {
        credential: plain_credential,
        ..config
    };
    tokio::task::spawn_blocking(move || {
        git_add_commit_push(&repo_dir, &git_config_for_push, "backup")
    }).await
        .map_err(|e| AppError::Internal(format!("备份任务异常: {}", e)))?
        .map_err(|e| AppError::Internal(format!("备份任务异常: {}", e)))?;

    let now = {
        let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE git_config SET last_sync_at = ? WHERE id = 'default'",
            rusqlite::params![now],
        )?;
        now
    };

    let _ = app.emit("sync-completed", ());

    Ok(GitSyncResult {
        success: true,
        message: format!("备份成功（已加密）！更新 {} 篇笔记、{} 篇日志，删除 {} 篇（共 {} 篇笔记、{} 篇日志）",
            changed_notes, changed_journals, deleted_count, notes.len(), journals.len()),
        synced_at: Some(now),
    })
}
fn check_and_require_enc_config_sync(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
) -> Result<(), AppError> {
    let repo_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Internal(format!("获取应用数据目录失败: {}", e)))?
        .join("git-backup");
    let key_path = repo_dir.join(".notepod").join("key.json");
    if !key_path.exists() { return Ok(()); }

    let key_json = std::fs::read_to_string(&key_path)
        .map_err(|e| AppError::Internal(format!("读取 key.json 失败: {}", e)))?;
    let key_data: serde_json::Value = serde_json::from_str(&key_json)
        .map_err(|e| AppError::Internal(format!("解析 key.json 失败: {}", e)))?;
    let remote_verify = key_data["verify"].as_str().unwrap_or("");
    if remote_verify.is_empty() { return Ok(()); }

    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let local_verify: String = conn.query_row(
        "SELECT verify FROM lock_config WHERE id = 'default'",
        [],
        |row| row.get(0),
    ).unwrap_or_default();

    if remote_verify != local_verify {
        return Err(AppError::Internal("KEY_JSON_MISMATCH:检测到 Git 仓库有加密配置(key.json)，请输入密码以同步加密配置并覆盖本地锁定密码".to_string()));
    }
    Ok(())
}

#[tauri::command]
pub async fn git_sync(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<GitSyncResult, AppError> {
    let config = get_git_config_inner(&state)?
        .ok_or_else(|| AppError::Internal("Git 配置未保存，请先配置仓库信息".to_string()))?;

    let mk = require_master_key(&state)?;
    let plain_credential = crypto::decrypt_credential(&config.credential, &mk)?;
    let plain_config = GitConfig {
        credential: plain_credential.clone(),
        ..config.clone()
    };

    let repo_dir = ensure_repo_dir(&app, &plain_config)?;

    let notes_dir = repo_dir.join("notes");
    let journals_dir = repo_dir.join("journals");
    std::fs::create_dir_all(&notes_dir)?;
    std::fs::create_dir_all(&journals_dir)?;

    // ========== Phase 1: 先导出本地变更（pull 前计数，只计用户本地修改）==========
    let (notes, journals, changed_notes, changed_journals, deleted_count, local_changes) = {
        let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let notes = note_repo::list_notes(&conn, None)?;
        let journals = note_repo::list_daily_notes(&conn)?;

        let mut changed_notes = 0;
        for note in &notes {
            let path = notes_dir.join(format!("{}.md.enc", note.id));
            let plain_content = crypto::decrypt_content(&note.content, &mk)?;
            let md_content = note_to_markdown_with_content(note, &plain_content)?;
            if write_if_plain_changed(&path, &md_content, &mk)? { changed_notes += 1; }
        }

        let mut changed_journals = 0;
        for journal in &journals {
            if let Some(date) = &journal.journal_date {
                let path = journals_dir.join(format!("{}.md.enc", date));
                let plain_content = crypto::decrypt_content(&journal.content, &mk)?;
                let md_content = note_to_markdown_with_content(journal, &plain_content)?;
                if write_if_plain_changed(&path, &md_content, &mk)? { changed_journals += 1; }
            }
        }

        // 本地 DB 为空时跳过 cleanup，避免误删云端已有文件（首次同步场景）
        let active_note_ids: HashSet<String> = notes.iter().map(|n| n.id.clone()).collect();
        let active_journal_dates: HashSet<String> = journals.iter().filter_map(|n| n.journal_date.clone()).collect();
        let deleted_count = if notes.is_empty() && journals.is_empty() {
            eprintln!("[sync] DB空的,跳过cleanup");
            0
        } else {
            cleanup_deleted_files(&notes_dir, &active_note_ids, &active_journal_dates)?
                + cleanup_deleted_files(&journals_dir, &active_note_ids, &active_journal_dates)?
        };
        eprintln!("[sync] Phase1: notes={}, journals={}, changed_n={}, changed_j={}, del={}",
            notes.len(), journals.len(), changed_notes, changed_journals, deleted_count);

        export_key_json(&conn, &repo_dir)?;

        let local_changes = changed_notes + changed_journals + deleted_count;
        (notes, journals, changed_notes, changed_journals, deleted_count, local_changes)
    };
    // conn 锁已释放 ✓

    // ========== Phase 2: 拉取远程最新内容 ==========
    let pull_result = git_pull(&repo_dir, &plain_config.username, &plain_config.credential)?;
    check_and_require_enc_config_sync(&app, &state)?;

    // ========== Phase 3: 导入拉取的文件到 DB ==========
    let mut imported_count = 0;
    let mut updated_count = 0;

    let import_dirs = [&notes_dir, &journals_dir];
    for dir in &import_dirs {
        if !dir.exists() { continue; }
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() { continue; }
            let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if name.starts_with('.') || !is_note_file(&path) { continue; }

            let file_content = std::fs::read_to_string(&path)?;
            let plain_md = if is_encrypted_file(&path) {
                match crypto::decrypt_file_content(file_content.trim(), &mk) {
                    Ok(md) => md,
                    Err(e) => {
                        eprintln!("[sync] 解密文件失败(跳过): {} 错误={}", path.display(), e);
                        continue;
                    }
                }
            } else { file_content };

            if let Ok(note_data) = parse_markdown_note_from_str(&plain_md) {
                eprintln!("[sync] 导入: id={} title={}", note_data.id, note_data.title);
                let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

                if note_data.note_type == "daily" || note_data.journal_date.is_some() {
                    let date = note_data.journal_date.as_deref().unwrap_or(&note_data.id);
                    match note_repo::get_daily_note(&conn, date)? {
                        Some(existing) if note_data.updated_at > existing.updated_at => {
                            import_note_to_db_encrypted(&conn, &note_data, &*state)?;
                            updated_count += 1;
                        }
                        None => {
                            import_note_to_db_encrypted(&conn, &note_data, &*state)?;
                            imported_count += 1;
                        }
                        _ => {}
                    }
                } else {
                    match note_repo::get_note_with_deleted(&conn, &note_data.id) {
                        Ok(existing) if note_data.updated_at > existing.updated_at => {
                            import_note_to_db_encrypted(&conn, &note_data, &*state)?;
                            updated_count += 1;
                        }
                        Err(_) => {
                            import_note_to_db_encrypted(&conn, &note_data, &*state)?;
                            imported_count += 1;
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    // ========== Phase 4: 只有本地有实际变更时才 commit+push ==========
    if local_changes > 0 {
        let git_config_for_push = GitConfig {
            credential: plain_credential,
            ..config
        };
        tokio::task::spawn_blocking(move || {
            git_add_commit_push(&repo_dir, &git_config_for_push, "sync")
        }).await
            .map_err(|e| AppError::Internal(format!("同步任务异常: {}", e)))?
            .map_err(|e| AppError::Internal(format!("同步任务异常: {}", e)))?;
    }

    // ========== Phase 5: 更新同步时间 ==========
    let now = {
        let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let now = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE git_config SET last_sync_at = ? WHERE id = 'default'",
            rusqlite::params![now],
        )?;
        now
    };

    // ========== Phase 6: 构建返回消息 ==========
    let mut parts = Vec::new();
    if pull_result != "Already up to date." {
        parts.push(format!("云端拉取: {}", pull_result));
    }
    if imported_count > 0 || updated_count > 0 {
        parts.push(format!("云端导入 {} 篇，更新 {} 篇", imported_count, updated_count));
    }
    if local_changes > 0 {
        let mut change_parts = Vec::new();
        if changed_notes > 0 { change_parts.push(format!("{} 篇笔记", changed_notes)); }
        if changed_journals > 0 { change_parts.push(format!("{} 篇日志", changed_journals)); }
        if deleted_count > 0 { change_parts.push(format!("删除 {} 篇", deleted_count)); }
        parts.push(format!("本地导出: {}", change_parts.join("、")));
    }

    let message = if parts.is_empty() {
        format!("已是最新！云端和本地完全一致（共 {} 篇笔记、{} 篇日志）", notes.len(), journals.len())
    } else {
        format!("同步成功！{}", parts.join("；"))
    };

    let _ = app.emit("sync-completed", ());

    Ok(GitSyncResult {
        success: true,
        message,
        synced_at: Some(now),
    })
}

// ============================================================
// 辅助函数
// ============================================================

fn require_master_key(state: &State<'_, AppState>) -> Result<Vec<u8>, AppError> {
    let has_config = {
        let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM lock_config WHERE id = 'default' AND salt IS NOT NULL AND salt != ''",
            [],
            |row| row.get(0),
        ).unwrap_or(0);
        count > 0
    };
    if !has_config {
        return Err(AppError::Internal("请先设置锁屏密码（同时启用加密），再使用 Git 备份同步".to_string()));
    }
    let mk_opt = state.master_key.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    match *mk_opt {
        Some(ref mk) => Ok(mk.clone()),
        None => Err(AppError::Internal("加密未解锁，请先解锁加密".to_string())),
    }
}

fn export_key_json(conn: &rusqlite::Connection, repo_dir: &PathBuf) -> Result<(), AppError> {
    let result = conn.query_row(
        "SELECT enc_version, salt, kdf_m_cost, kdf_t_cost, kdf_p_cost, wrapped_key, verify
         FROM lock_config WHERE id = 'default' AND salt IS NOT NULL AND salt != ''",
        [],
        |row| {
            Ok(serde_json::json!({
                "version": row.get::<_, i32>(0)?,
                "kdf_algorithm": "Argon2id",
                "salt": row.get::<_, String>(1)?,
                "kdf_params": {
                    "m_cost": row.get::<_, i32>(2)?,
                    "t_cost": row.get::<_, i32>(3)?,
                    "p_cost": row.get::<_, i32>(4)?,
                },
                "wrapped_key": row.get::<_, String>(5)?,
                "verify": row.get::<_, String>(6)?,
            }))
        },
    );
    match result {
        Ok(key_data) => {
            let key_dir = repo_dir.join(".notepod");
            std::fs::create_dir_all(&key_dir)?;
            let key_path = key_dir.join("key.json");
            let json_str = serde_json::to_string_pretty(&key_data)?;
            write_if_changed(&key_path, &json_str)?;
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {}
        Err(e) => return Err(AppError::Db(e)),
    }
    Ok(())
}

fn decrypt_credential_with_mk(state: &State<'_, AppState>, credential: &str) -> Result<String, AppError> {
    if !credential.starts_with("ENC:") { return Ok(credential.to_string()); }
    let mk = require_master_key(&state)?;
    crypto::decrypt_credential(credential, &mk)
}

fn get_git_config_inner(state: &State<'_, AppState>) -> Result<Option<GitConfig>, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let result = conn.query_row(
        "SELECT repo_url, username, credential, author_name, author_email, last_sync_at FROM git_config WHERE id = 'default'",
        [],
        |row| {
            Ok(GitConfig {
                repo_url: row.get(0)?,
                username: row.get(1)?,
                credential: row.get(2)?,
                author_name: row.get(3)?,
                author_email: row.get(4)?,
                last_sync_at: row.get(5)?,
            })
        },
    );
    match result {
        Ok(config) => Ok(Some(config)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Db(e)),
    }
}

fn build_authenticated_url(repo_url: &str, username: &str, credential: &str) -> String {
    if repo_url.starts_with("https://") {
        let url = repo_url.replace("https://", "");
        format!("https://{}:{}@{}", username, credential, url)
    } else { repo_url.to_string() }
}

fn ensure_repo_dir(app: &tauri::AppHandle, config: &GitConfig) -> Result<PathBuf, AppError> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Internal(format!("获取应用数据目录失败: {}", e)))?;
    let repo_dir = app_data_dir.join("git-backup");
    if !repo_dir.exists() {
        let auth_url = build_authenticated_url(&config.repo_url, &config.username, &config.credential);
        GixOps::clone_repo(&auth_url, &repo_dir, &config.username, &config.credential)?;
    } else {
        let repo = GixOps::open_repo(&repo_dir)?;
        let auth_url = build_authenticated_url(&config.repo_url, &config.username, &config.credential);
        let _ = GixOps::set_remote_url(&repo, "origin", &auth_url);
    }
    Ok(repo_dir)
}

fn is_note_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|s| s.to_str())
        .map(|n| n.ends_with(".md.enc") || n.ends_with(".md"))
        .unwrap_or(false)
}

fn is_encrypted_file(path: &Path) -> bool {
    path.file_name()
        .and_then(|s| s.to_str())
        .map(|n| n.ends_with(".md.enc"))
        .unwrap_or(false)
}

fn file_base_name(name: &str) -> Option<&str> {
    if name.ends_with(".md.enc") { Some(&name[..name.len() - 7]) }
    else if name.ends_with(".md") { Some(&name[..name.len() - 3]) }
    else { None }
}

fn note_to_markdown_with_content(note: &Note, content: &str) -> Result<String, AppError> {
    let mut md = String::new();
    md.push_str("---\n");
    md.push_str(&format!("id: \"{}\"\n", note.id));
    md.push_str(&format!("title: \"{}\"\n", note.title.replace("\"", "\\\"")));
    md.push_str(&format!("note_type: \"{}\"\n", note.note_type));
    md.push_str(&format!("journal_date: \"{}\"\n", note.journal_date.as_deref().unwrap_or("")));
    md.push_str(&format!("folder_id: \"{}\"\n", note.folder_id.as_deref().unwrap_or("")));
    md.push_str(&format!("status: \"{}\"\n", note.status));
    md.push_str(&format!("priority: \"{}\"\n", note.priority));
    md.push_str(&format!("starred: {}\n", note.starred));
    md.push_str(&format!("pinned: {}\n", note.pinned));
    let tags_str = note.tags.iter().map(|t| format!("\"{}\"", t)).collect::<Vec<_>>().join(", ");
    md.push_str(&format!("tags: [{}]\n", tags_str));
    let created_dt = chrono::DateTime::from_timestamp_millis(note.created_at).unwrap_or_default();
    let updated_dt = chrono::DateTime::from_timestamp_millis(note.updated_at).unwrap_or_default();
    md.push_str(&format!("created_at: \"{}\"\n", created_dt.to_rfc3339()));
    md.push_str(&format!("updated_at: \"{}\"\n", updated_dt.to_rfc3339()));
    md.push_str("---\n\n");
    md.push_str(content);
    Ok(md)
}

fn parse_markdown_note_from_str(content: &str) -> Result<Note, AppError> {
    let mut note = Note {
        id: String::new(), title: String::new(), content: String::new(),
        folder_id: None, status: "todo".to_string(), priority: "medium".to_string(),
        starred: false, pinned: false, is_encrypted: false,
        created_at: 0, updated_at: 0, deleted_at: None,
        tags: vec![], due_date: None, reminder: None, parent_task_id: None,
        note_type: "note".to_string(), journal_date: None,
    };
    if !content.starts_with("---") {
        return Err(AppError::Internal("无效的 Markdown 格式".to_string()));
    }
    let rest = &content[3..];
    if let Some(end) = rest.find("\n---") {
        let front_matter = &rest[..end];
        for line in front_matter.lines() {
            if let Some(colon_pos) = line.find(':') {
                let key = line[..colon_pos].trim();
                let value = line[colon_pos + 1..].trim().trim_matches('"').to_string();
                match key {
                    "id" => note.id = value,
                    "title" => note.title = value,
                    "note_type" => note.note_type = value,
                    "journal_date" => { if !value.is_empty() { note.journal_date = Some(value); } }
                    "folder_id" => { if !value.is_empty() { note.folder_id = Some(value); } }
                    "status" => note.status = value,
                    "priority" => note.priority = value,
                    "starred" => note.starred = value == "true",
                    "pinned" => note.pinned = value == "true",
                    "tags" => {
                        let tags_str = value.trim_start_matches('[').trim_end_matches(']');
                        note.tags = tags_str.split(',').map(|s| s.trim().trim_matches('"').to_string()).filter(|s| !s.is_empty()).collect();
                    }
                    "created_at" => { if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&value) { note.created_at = dt.timestamp_millis(); } }
                    "updated_at" => { if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(&value) { note.updated_at = dt.timestamp_millis(); } }
                    _ => {}
                }
            }
        }
        let body_start = end + 4;
        note.content = content[body_start..].trim_start().to_string();
    }
    Ok(note)
}

fn import_note_to_db(conn: &rusqlite::Connection, note: &Note) -> Result<(), AppError> {
    let safe_folder_id = match note.folder_id {
        Some(ref fid) => {
            let exists: bool = conn.query_row(
                "SELECT COUNT(*) FROM folders WHERE id = ?", rusqlite::params![fid], |row| row.get::<_, i64>(0),
            ).unwrap_or(0) > 0;
            if exists { Some(fid.clone()) } else { None }
        }
        None => None,
    };
    let exists = conn.query_row(
        "SELECT COUNT(*) FROM notes WHERE id = ?", rusqlite::params![note.id], |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0;

    if exists {
        conn.execute(
            "UPDATE notes SET title = ?, content = ?, folder_id = ?, status = ?, priority = ?, starred = ?, pinned = ?, is_encrypted = ?, note_type = ?, journal_date = ?, created_at = ?, updated_at = ? WHERE id = ?",
            rusqlite::params![note.title, note.content, safe_folder_id, note.status, note.priority, if note.starred { 1 } else { 0 }, if note.pinned { 1 } else { 0 }, if note.is_encrypted { 1 } else { 0 }, note.note_type, note.journal_date, note.created_at, note.updated_at, note.id],
        )?;
    } else {
        conn.execute(
            "INSERT INTO notes (id, title, content, folder_id, status, priority, starred, pinned, is_encrypted, created_at, updated_at, note_type, journal_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            rusqlite::params![note.id, note.title, note.content, safe_folder_id, note.status, note.priority, if note.starred { 1 } else { 0 }, if note.pinned { 1 } else { 0 }, if note.is_encrypted { 1 } else { 0 }, note.created_at, note.updated_at, note.note_type, note.journal_date],
        )?;
    }
    if !note.tags.is_empty() { note_repo::set_note_tags(conn, &note.id, &note.tags)?; }
    Ok(())
}

fn import_note_to_db_encrypted(conn: &rusqlite::Connection, note: &Note, app_state: &AppState) -> Result<(), AppError> {
    let mk_opt = app_state.master_key.lock()
        .map_err(|e| AppError::Internal(e.to_string()))?.clone();
    let (enc_content, is_enc) = match mk_opt {
        Some(ref mk) => (crypto::encrypt_content(&note.content, mk)?, true),
        None => (note.content.clone(), false),
    };
    let enc_note = Note { content: enc_content, is_encrypted: is_enc, ..note.clone() };
    import_note_to_db(conn, &enc_note)
}

fn cleanup_deleted_files(repo_dir: &PathBuf, active_note_ids: &HashSet<String>, active_journal_dates: &HashSet<String>) -> Result<usize, AppError> {
    if !repo_dir.exists() { return Ok(0); }
    let mut deleted_count = 0;
    for entry in std::fs::read_dir(repo_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() { continue; }
        let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if name.starts_with('.') || !is_note_file(&path) { continue; }
        if let Some(base) = file_base_name(name) {
            if !active_note_ids.contains(base) && !active_journal_dates.contains(base) {
                std::fs::remove_file(&path)?;
                deleted_count += 1;
            }
        }
    }
    Ok(deleted_count)
}

fn git_add_commit_push(repo_dir: &PathBuf, config: &GitConfig, action: &str) -> Result<(), AppError> {
    let repo = GixOps::open_repo(repo_dir)?;
    let auth_url = build_authenticated_url(&config.repo_url, &config.username, &config.credential);
    let _ = GixOps::set_remote_url(&repo, "origin", &auth_url);
    GixOps::add_all(&repo)?;
    let timestamp = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let commit_msg = format!("{}: {}", action, timestamp);
    let author_name = config.author_name.as_deref().filter(|s| !s.is_empty());
    let author_email = config.author_email.as_deref().filter(|s| !s.is_empty());
    match GixOps::commit(&repo, &commit_msg, author_name, author_email) {
        Ok(_) => {}
        Err(e) => { if !e.to_string().contains("nothing to commit") { return Err(e); } }
    }
    // push 前先 pull，避免远程有新提交导致 push rejected
    git_pull(repo_dir, &config.username, &config.credential)?;
    GixOps::push(&repo, "origin", &config.username, &config.credential)?;
    Ok(())
}

fn git_pull(repo_dir: &PathBuf, username: &str, password: &str) -> Result<String, AppError> {
    let repo = GixOps::open_repo(repo_dir)?;
    GixOps::pull(&repo, "origin", username, password)
}

fn write_if_changed(path: &PathBuf, content: &str) -> Result<bool, AppError> {
    if let Ok(existing) = std::fs::read_to_string(path) {
        if existing == content { return Ok(false); }
    }
    std::fs::write(path, content)?;
    Ok(true)
}

fn write_if_plain_changed(path: &PathBuf, plain_content: &str, mk: &[u8]) -> Result<bool, AppError> {
    if let Ok(existing_enc) = std::fs::read_to_string(path) {
        if let Ok(existing_plain) = crypto::decrypt_file_content(existing_enc.trim(), mk) {
            if existing_plain == plain_content {
                return Ok(false);
            } else {
                eprintln!("[sync] 文件内容不同: {}", path.display());
            }
        } else {
            eprintln!("[sync] 解密失败(key变了?): {}", path.display());
        }
    } else {
        eprintln!("[sync] 文件不存在(新文件): {}", path.display());
    }
    let enc_content = crypto::encrypt_file_content(plain_content, mk)?;
    std::fs::write(path, &enc_content)?;
    Ok(true)
}
