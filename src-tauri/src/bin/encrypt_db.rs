//! 命令行工具：用现有加密配置批量加密所有笔记
//! cargo run --bin encrypt_db

use std::path::PathBuf;

fn main() {
    // 查找数据库
    let db_path = find_db();
    if !db_path.exists() {
        eprintln!("数据库文件不存在: {:?}", db_path);
        std::process::exit(1);
    }
    println!("数据库: {:?}", db_path);

    // 读锁屏密码
    let conn = open_db(&db_path);

    // 从 lock_config 获取密码
    let password: String = conn.query_row(
        "SELECT password FROM lock_config WHERE id = 'default'",
        [],
        |row| row.get(0),
    ).expect("没有锁屏密码，请先设置锁屏密码");

    // 读取加密配置（单密码方案：从 lock_config 读取）
    let (salt_b64, wrapped_b64, _verify_b64) = conn.query_row(
        "SELECT salt, wrapped_key, verify FROM lock_config WHERE id = 'default'",
        [],
        |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?))
        },
    ).expect("没有加密配置，请先启用加密");

    let salt = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &salt_b64)
        .expect("salt 解码失败");
    let wrapped_data = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &wrapped_b64)
        .expect("wrapped_key 解码失败");

    // Argon2id 派生 KEK
    let argon_params = argon2::Params::new(65536, 3, 4, Some(32))
        .expect("Argon2 参数错误");
    let argon = argon2::Argon2::new(
        argon2::Algorithm::Argon2id,
        argon2::Version::V0x13,
        argon_params,
    );
    let mut kek = vec![0u8; 32];
    argon.hash_password_into(password.as_bytes(), &salt, &mut kek)
        .expect("Argon2 密钥派生失败");

    // 解包 MK
    use aes_gcm::{Aes256Gcm, Nonce};
    use aes_gcm::aead::{Aead, KeyInit};
    let cipher = Aes256Gcm::new_from_slice(&kek).expect("AES 初始化失败");
    let (nonce_bytes, ciphertext) = wrapped_data.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);
    let _mk = cipher.decrypt(nonce, ciphertext)
        .expect("解包 Master Key 失败（密码错误？）");

    println!("Master Key 已恢复");

    // 批量加密笔记
    let mut stmt = conn.prepare("SELECT id, content, is_encrypted FROM notes").expect("查询失败");
    let notes: Vec<(String, String, i32)> = stmt.query_map([], |row| {
        Ok((row.get(0)?, row.get(1)?, row.get(2)?))
    }).expect("读取失败").filter_map(|r| r.ok()).collect();

    let mut encrypted = 0;
    let mut skipped = 0;
    for (id, content, is_enc) in &notes {
        if *is_enc == 1 || content.starts_with("ENC:") {
            skipped += 1;
            continue;
        }
        use rand::rngs::OsRng;
        use rand::RngCore;
        let mut nonce2 = vec![0u8; 12];
        OsRng.fill_bytes(&mut nonce2);
        let nonce2_val = Nonce::from_slice(&nonce2);
        let ct = cipher.encrypt(nonce2_val, content.as_bytes())
            .expect("加密失败");
        let mut combined = Vec::with_capacity(12 + ct.len());
        combined.extend_from_slice(&nonce2);
        combined.extend_from_slice(&ct);
        let enc_data = "ENC:".to_string() + &base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &combined);
        conn.execute("UPDATE notes SET content = ?, is_encrypted = 1 WHERE id = ?",
            rusqlite::params![enc_data, id]).expect("更新失败");
        encrypted += 1;
        if encrypted <= 5 {
            println!("  已加密: {}...", &id[..8]);
        }
    }

    // 更新 updated_at
    let now = chrono::Utc::now().timestamp_millis();
    conn.execute("UPDATE notes SET updated_at = ? WHERE is_encrypted = 1 AND updated_at < ?",
        rusqlite::params![now, now]).ok();

    println!("\n完成！加密 {} 篇，跳过 {} 篇（已加密）", encrypted, skipped);
}

fn find_db() -> PathBuf {
    // 尝试常见路径
    if let Some(appdata) = std::env::var_os("APPDATA") {
        let p = PathBuf::from(appdata).join("com.notepod.app").join("notepod.db");
        if p.exists() { return p; }
    }
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        let p = PathBuf::from(local).join("com.notepod.app").join("notepod.db");
        if p.exists() { return p; }
    }
    PathBuf::from("notepod.db")
}

fn open_db(path: &PathBuf) -> rusqlite::Connection {
    let conn = rusqlite::Connection::open(path)
        .expect("无法打开数据库");
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .ok();
    conn
}
