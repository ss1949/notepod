use tauri::{State, Manager};
use crate::crypto;
use crate::models::*;
use crate::error::AppError;
use crate::AppState;
use crate::db::repo::note_repo;

/// 完整的锁屏+加密配置（存储在 lock_config 表）
#[allow(dead_code)]
#[derive(Debug, Clone)]
struct LockEncConfig {
    password_hash: String,   // Argon2id 哈希（旧版兼容）
    hint: String,
    salt: Option<String>,
    wrapped_key: Option<String>,
    verify: Option<String>,
    kdf_m_cost: Option<i32>,
    kdf_t_cost: Option<i32>,
    kdf_p_cost: Option<i32>,
    enc_version: Option<i32>,
}

/// 从 DB 读取锁屏+加密配置
fn read_lock_config(conn: &rusqlite::Connection) -> Result<Option<LockEncConfig>, AppError> {
    let result = conn.query_row(
        "SELECT password, hint, salt, wrapped_key, verify, kdf_m_cost, kdf_t_cost, kdf_p_cost, enc_version
         FROM lock_config WHERE id = 'default'",
        [],
        |row| {
            Ok(LockEncConfig {
                password_hash: row.get(0)?,
                hint: row.get(1)?,
                salt: row.get(2)?,
                wrapped_key: row.get(3)?,
                verify: row.get(4)?,
                kdf_m_cost: row.get(5)?,
                kdf_t_cost: row.get(6)?,
                kdf_p_cost: row.get(7)?,
                enc_version: row.get(8)?,
            })
        },
    );

    match result {
        Ok(cfg) => Ok(Some(cfg)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Db(e)),
    }
}

/// 设置锁屏密码（首次设置或修改密码）
/// 同时生成 Master Key 并包裹存储（启用加密）
#[tauri::command]
pub async fn set_lock_password(
    state: State<'_, AppState>,
    password: String,
    hint: String,
) -> Result<(), AppError> {
    if password.is_empty() {
        return Err(AppError::Internal("密码不能为空".to_string()));
    }
    if hint.is_empty() {
        return Err(AppError::Internal("密码提示不能为空".to_string()));
    }

    // 生成新 Master Key + 用密码包裹
    let master_key = crypto::generate_master_key();
    let enc_config = crypto::create_encryption_config(&password, &master_key)?;

    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    // 检查是否已有锁屏配置（修改密码场景）
    let existing = read_lock_config(&conn)?;

    if let Some(ref existing_cfg) = existing {
        // 修改密码场景：需要用旧密码解包旧 MK，再用新密码重新包裹同一个 MK
        // 但此处我们不知道旧密码，调用方应使用 change_lock_password
        // 这里直接用新 MK 覆盖（会丢失旧加密数据，调用方需保证已验证旧密码）
        // 为安全起见，如果已有加密配置，要求通过 change_lock_password 修改
        if existing_cfg.salt.is_some() {
            return Err(AppError::Internal("已启用加密，请使用修改密码功能".to_string()));
        }
    }

    // 如果首次设置密码，同时批量加密已有笔记
    let is_first_setup = existing.is_none();

    // 保存密码哈希 + 加密配置到 lock_config
    // 注意：单密码方案不再存储 Argon2id 哈希，直接用 verify token 校验密码
    // password 字段存占位符（向后兼容旧版读取）
    conn.execute(
        "INSERT OR REPLACE INTO lock_config
         (id, password, hint, salt, wrapped_key, verify, kdf_m_cost, kdf_t_cost, kdf_p_cost, enc_version)
         VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            "argon2id$single$password",  // 占位符，实际校验通过 verify token
            hint,
            enc_config.salt,
            enc_config.wrapped_key.data,
            enc_config.verify.data,
            enc_config.kdf_params.m_cost as i32,
            enc_config.kdf_params.t_cost as i32,
            enc_config.kdf_params.p_cost as i32,
            enc_config.version as i32,
        ],
    )?;

    // Master Key 存入内存
    {
        let mut mk = state.master_key.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        *mk = Some(master_key.clone());
    }

    // 首次设置：批量加密已有笔记
    if is_first_setup {
        let now = chrono::Utc::now().timestamp_millis();
        let notes = note_repo::list_notes(&conn, None)?;
        for note in &notes {
            if note.is_encrypted {
                continue;
            }
            match crypto::encrypt_content(&note.content, &master_key) {
                Ok(encrypted) => {
                    conn.execute(
                        "UPDATE notes SET content = ?, is_encrypted = 1, updated_at = ? WHERE id = ?",
                        rusqlite::params![encrypted, now, note.id],
                    )?;
                }
                Err(e) => log::warn!("加密笔记 {} 失败: {}", note.id, e),
            }
        }

        let daily_notes = note_repo::list_daily_notes(&conn)?;
        for note in &daily_notes {
            if note.is_encrypted {
                continue;
            }
            match crypto::encrypt_content(&note.content, &master_key) {
                Ok(encrypted) => {
                    conn.execute(
                        "UPDATE notes SET content = ?, is_encrypted = 1, updated_at = ? WHERE id = ?",
                        rusqlite::params![encrypted, now, note.id],
                    )?;
                }
                Err(e) => log::warn!("加密日志 {} 失败: {}", note.id, e),
            }
        }
    }

    Ok(())
}

/// 修改锁屏密码（需要验证旧密码）
/// 用旧密码解包 MK，再用新密码重新包裹同一个 MK（笔记无需重新加密）
#[tauri::command]
pub async fn change_lock_password(
    state: State<'_, AppState>,
    old_password: String,
    new_password: String,
    hint: String,
) -> Result<(), AppError> {
    if new_password.is_empty() {
        return Err(AppError::Internal("新密码不能为空".to_string()));
    }
    if hint.is_empty() {
        return Err(AppError::Internal("密码提示不能为空".to_string()));
    }

    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let existing = read_lock_config(&conn)?
        .ok_or_else(|| AppError::Internal("尚未设置锁屏密码".to_string()))?;

    // 用旧密码派生 KEK + 校验 + 解包 MK
    let master_key = verify_and_unwrap_mk(&existing, &old_password)?;

    // 用新密码重新包裹同一个 MK
    let new_enc_config = crypto::create_encryption_config(&new_password, &master_key)?;

    // 更新 lock_config
    conn.execute(
        "UPDATE lock_config SET
            hint = ?, salt = ?, wrapped_key = ?, verify = ?,
            kdf_m_cost = ?, kdf_t_cost = ?, kdf_p_cost = ?, enc_version = ?,
            password = ?
         WHERE id = 'default'",
        rusqlite::params![
            hint,
            new_enc_config.salt,
            new_enc_config.wrapped_key.data,
            new_enc_config.verify.data,
            new_enc_config.kdf_params.m_cost as i32,
            new_enc_config.kdf_params.t_cost as i32,
            new_enc_config.kdf_params.p_cost as i32,
            new_enc_config.version as i32,
            "argon2id$single$password",
        ],
    )?;

    // 更新内存中的 MK（同一个 MK，但确保已加载）
    {
        let mut mk = state.master_key.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        *mk = Some(master_key);
    }

    Ok(())
}

/// 获取锁屏配置（仅返回是否已设置密码和密码提示）
#[tauri::command]
pub async fn get_lock_config(
    state: State<'_, AppState>,
) -> Result<Option<LockConfigInfo>, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;

    let result = conn.query_row(
        "SELECT hint FROM lock_config WHERE id = 'default'",
        [],
        |row| {
            Ok(LockConfigInfo {
                has_password: true,
                hint: row.get(0)?,
            })
        },
    );

    match result {
        Ok(config) => Ok(Some(config)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(AppError::Db(e)),
    }
}

/// 验证锁屏密码（同时完成加密解锁）
/// 一次 Argon2id 派生同时完成：
/// 1. 校验密码（通过 verify token）
/// 2. 解包 Master Key 存入内存
#[tauri::command]
pub async fn verify_lock_password(
    state: State<'_, AppState>,
    password: String,
) -> Result<bool, AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    let existing = match read_lock_config(&conn)? {
        Some(cfg) => cfg,
        None => return Ok(false),
    };

    // 单密码方案：通过 verify token 校验 + 解包 MK
    match verify_and_unwrap_mk(&existing, &password) {
        Ok(master_key) => {
            // 存入内存
            let mut mk = state.master_key.lock().map_err(|e| AppError::Internal(e.to_string()))?;
            *mk = Some(master_key);
            Ok(true)
        }
        Err(_) => Ok(false),
    }
}

/// 删除锁屏密码（取消锁屏功能）
/// 注意：不删除已加密的笔记内容，但 MK 会从内存清除
#[tauri::command]
pub async fn remove_lock_password(
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    conn.execute("DELETE FROM lock_config WHERE id = 'default'", [])?;

    // 清除内存中的 MK
    let mut mk = state.master_key.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    *mk = None;
    Ok(())
}

/// 从 key.json 导入加密配置（用于新电脑恢复）
/// 需要用户提供密码来验证 key.json 并作为锁屏密码
#[tauri::command]
pub async fn import_enc_config(
    state: State<'_, AppState>,
    key_json: String,
    password: String,
) -> Result<(), AppError> {
    if password.is_empty() {
        return Err(AppError::Internal("密码不能为空".to_string()));
    }

    // 1. 解析 key.json
    let key_data: serde_json::Value = serde_json::from_str(&key_json)
        .map_err(|e| AppError::Internal(format!("key.json 格式错误: {}", e)))?;

    // 2. 提取字段
    let _version = key_data["version"]
        .as_i64()
        .ok_or_else(|| AppError::Internal("key.json 缺少 version 字段".to_string()))? as i32;
    let salt = key_data["salt"]
        .as_str()
        .ok_or_else(|| AppError::Internal("key.json 缺少 salt 字段".to_string()))?
        .to_string();
    let kdf_params = &key_data["kdf_params"];
    let m_cost = kdf_params["m_cost"]
        .as_i64()
        .ok_or_else(|| AppError::Internal("key.json 缺少 kdf_params.m_cost 字段".to_string()))?
        as i32;
    let t_cost = kdf_params["t_cost"]
        .as_i64()
        .ok_or_else(|| AppError::Internal("key.json 缺少 kdf_params.t_cost 字段".to_string()))?
        as i32;
    let p_cost = kdf_params["p_cost"]
        .as_i64()
        .ok_or_else(|| AppError::Internal("key.json 缺少 kdf_params.p_cost 字段".to_string()))?
        as i32;
    let wrapped_key = key_data["wrapped_key"]
        .as_str()
        .ok_or_else(|| AppError::Internal("key.json 缺少 wrapped_key 字段".to_string()))?
        .to_string();
    let verify = key_data["verify"]
        .as_str()
        .ok_or_else(|| AppError::Internal("key.json 缺少 verify 字段".to_string()))?
        .to_string();

    // 3. 验证密码
    let salt_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &salt)
        .map_err(|_| AppError::Internal("salt base64 解码失败".to_string()))?;
    let kek = crypto::kdf_derive_with_params(
        &password,
        &salt_bytes,
        m_cost as u32,
        t_cost as u32,
        p_cost as u32,
    )?;
    let verify_token = crypto::VerifyToken { data: verify.clone() };
    let valid = crypto::check_verify_token(&kek, &verify_token)?;
    if !valid {
        return Err(AppError::Internal("密码错误".to_string()));
    }

    // 4. 解包 Master Key
    let wrapped = crypto::WrappedMasterKey { data: wrapped_key.clone() };
    let master_key = crypto::unwrap_master_key(&wrapped, &kek)?;

    // 5. 保留 key.json 原有的 salt 和 verify token（确保和远程一致）
    // 注意：不能调用 create_encryption_config，因为它会生成新的随机 salt，
    // 导致 lock_config 的 verify 和 key.json 不一致，下次同步又会检测到不匹配

    // 6. 写入 lock_config 表（使用 key.json 原有的加密参数）
    let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
    conn.execute(
        "INSERT OR REPLACE INTO lock_config
         (id, password, hint, salt, wrapped_key, verify, kdf_m_cost, kdf_t_cost, kdf_p_cost, enc_version)
         VALUES ('default', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        rusqlite::params![
            "argon2id$single$password",
            "", // hint 为空，用户可以后续通过修改密码功能设置
            salt,           // 保留 key.json 的原始 salt
            wrapped_key,    // 保留 key.json 的原始 wrapped_key
            verify,         // 保留 key.json 的原始 verify token
            m_cost,
            t_cost,
            p_cost,
            _version,
        ],
    )?;

    // 7. 将 MK 存入内存
    {
        let mut mk = state.master_key.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        *mk = Some(master_key);
    }

    Ok(())
}

/// 从 Git 仓库的 key.json 恢复加密配置（新电脑场景）
/// 从克隆的仓库读取 key.json，验证密码，导入到本地数据库
#[tauri::command]
pub async fn restore_enc_from_git(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    password: String,
) -> Result<(), AppError> {
    if password.is_empty() {
        return Err(AppError::Internal("密码不能为空".to_string()));
    }

    // 1. 读取 Git 仓库中的 key.json
    let repo_dir = app.path().app_data_dir()
        .map_err(|e| AppError::Internal(format!("获取应用数据目录失败: {}", e)))?
        .join("git-backup");

    let key_path = repo_dir.join(".notepod").join("key.json");
    if !key_path.exists() {
        return Err(AppError::Internal("Git 仓库中没有 key.json 文件".to_string()));
    }

    let key_json = std::fs::read_to_string(&key_path)
        .map_err(|e| AppError::Internal(format!("读取 key.json 失败: {}", e)))?;

    // 2. 调用 import_enc_config 导入
    import_enc_config(state, key_json, password).await
}

/// 获取加密状态
/// 单密码方案：加密状态 = 锁屏密码已设置
#[tauri::command]
pub async fn get_enc_status(
    state: State<'_, AppState>,
) -> Result<EncStatus, AppError> {
    // 检查 lock_config 是否有 salt（即是否启用了加密）
    let has_config = {
        let conn = state.conn.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM lock_config WHERE id = 'default' AND salt IS NOT NULL AND salt != ''",
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);
        count > 0
    };

    let enabled = if has_config {
        let mk = state.master_key.lock().map_err(|e| AppError::Internal(e.to_string()))?;
        mk.is_some()
    } else {
        false
    };

    Ok(EncStatus { enabled, has_config })
}

// ============================================================
// 内部辅助函数
// ============================================================

/// 一次 Argon2id 派生同时完成：校验密码 + 解包 Master Key
/// 使用 DB 中存储的 KDF 参数（兼容旧密码）
fn verify_and_unwrap_mk(cfg: &LockEncConfig, password: &str) -> Result<Vec<u8>, AppError> {
    let salt_str = cfg.salt.as_ref()
        .ok_or_else(|| AppError::Internal("加密未配置（无 salt）".to_string()))?;
    let wrapped_str = cfg.wrapped_key.as_ref()
        .ok_or_else(|| AppError::Internal("加密未配置（无 wrapped_key）".to_string()))?;
    let verify_str = cfg.verify.as_ref()
        .ok_or_else(|| AppError::Internal("加密未配置（无 verify）".to_string()))?;

    // 解码 salt
    let salt_bytes = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, salt_str)
        .map_err(|_| AppError::Internal("salt base64 解码失败".to_string()))?;

    // 使用 DB 中存储的 KDF 参数派生 KEK（兼容旧密码）
    let m_cost = cfg.kdf_m_cost.unwrap_or(65536) as u32;
    let t_cost = cfg.kdf_t_cost.unwrap_or(3) as u32;
    let p_cost = cfg.kdf_p_cost.unwrap_or(4) as u32;
    let kek = crypto::kdf_derive_with_params(password, &salt_bytes, m_cost, t_cost, p_cost)?;

    // 校验密码
    let verify_token = crypto::VerifyToken { data: verify_str.clone() };
    let valid = crypto::check_verify_token(&kek, &verify_token)?;
    if !valid {
        return Err(AppError::Internal("密码错误".to_string()));
    }

    // 解包 Master Key
    let wrapped = crypto::WrappedMasterKey { data: wrapped_str.clone() };
    crypto::unwrap_master_key(&wrapped, &kek)
}
