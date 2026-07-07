use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use argon2::{self, Argon2, Params};
use rand::rngs::OsRng;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use crate::error::AppError;

/// Argon2id 参数（新密码使用快速参数）
const ARGON_M_COST: u32 = 16384;   // 16MB 内存
const ARGON_T_COST: u32 = 1;       // 1 次迭代
const ARGON_P_COST: u32 = 1;       // 1 并行
const KEY_LEN: usize = 32;         // AES-256
const NONCE_LEN: usize = 12;       // AES-GCM 标准 nonce

/// 包裹后的 Master Key（序列化到 DB / key.json）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WrappedMasterKey {
    pub data: String,
}

/// 验证令牌（用于校验密码是否正确）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VerifyToken {
    pub data: String,
}

/// Argon2id 参数结构
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KdfParams {
    pub m_cost: u32,
    pub t_cost: u32,
    pub p_cost: u32,
}

impl Default for KdfParams {
    fn default() -> Self {
        Self { m_cost: ARGON_M_COST, t_cost: ARGON_T_COST, p_cost: ARGON_P_COST }
    }
}

/// 加密配置（序列化为 DB 或 key.json 的完整数据）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncConfigData {
    pub version: u32,
    pub kdf_algorithm: String,
    pub salt: String,
    pub kdf_params: KdfParams,
    pub wrapped_key: WrappedMasterKey,
    pub verify: VerifyToken,
}

// ============================================================
// 随机数生成
// ============================================================

/// 生成随机 Master Key（32 字节 AES-256 密钥）
pub fn generate_master_key() -> Vec<u8> {
    let mut key = vec![0u8; KEY_LEN];
    OsRng.fill_bytes(&mut key);
    key
}

/// 生成随机盐值
pub fn generate_salt() -> Vec<u8> {
    let mut salt = vec![0u8; 16];
    OsRng.fill_bytes(&mut salt);
    salt
}

// ============================================================
// Argon2id 密钥派生
// ============================================================

/// Argon2id: password + salt → 32 字节 KEK（使用全局常量参数）
pub fn kdf_derive(password: &str, salt: &[u8]) -> Result<Vec<u8>, AppError> {
    kdf_derive_with_params(password, salt, ARGON_M_COST, ARGON_T_COST, ARGON_P_COST)
}

/// Argon2id: password + salt → 32 字节 KEK（自定义参数）
pub fn kdf_derive_with_params(
    password: &str,
    salt: &[u8],
    m_cost: u32,
    t_cost: u32,
    p_cost: u32,
) -> Result<Vec<u8>, AppError> {
    let params = Params::new(m_cost, t_cost, p_cost, Some(KEY_LEN))
        .map_err(|e| AppError::Internal(format!("Argon2 参数错误: {}", e)))?;

    let argon = Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);
    let mut key = vec![0u8; KEY_LEN];
    argon.hash_password_into(password.as_bytes(), salt, &mut key)
        .map_err(|e| AppError::Internal(format!("Argon2 密钥派生失败: {}", e)))?;
    Ok(key)
}

// ============================================================
// Key Wrapping
// ============================================================

/// 用 KEK 包裹 Master Key
pub fn wrap_master_key(master_key: &[u8], kek: &[u8]) -> Result<WrappedMasterKey, AppError> {
    let cipher = Aes256Gcm::new_from_slice(kek)
        .map_err(|e| AppError::Internal(format!("AES 初始化失败: {}", e)))?;
    let mut nonce_bytes = vec![0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, master_key)
        .map_err(|e| AppError::Internal(format!("密钥包裹失败: {}", e)))?;
    let mut combined = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);
    Ok(WrappedMasterKey {
        data: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &combined),
    })
}

/// 用 KEK 解包 Master Key
pub fn unwrap_master_key(wrapped: &WrappedMasterKey, kek: &[u8]) -> Result<Vec<u8>, AppError> {
    let combined = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &wrapped.data)
        .map_err(|_| AppError::Internal("base64 解码失败".to_string()))?;
    if combined.len() < NONCE_LEN + 16 {
        return Err(AppError::Internal("密钥数据长度异常".to_string()));
    }
    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new_from_slice(kek)
        .map_err(|e| AppError::Internal(format!("AES 初始化失败: {}", e)))?;
    let plaintext = cipher.decrypt(nonce, ciphertext)
        .map_err(|_| AppError::Internal("密码错误或密钥数据损坏".to_string()))?;
    Ok(plaintext)
}

// ============================================================
// 密码验证令牌
// ============================================================

/// 创建验证令牌：用 KEK 加密一个已知字符串
pub fn create_verify_token(kek: &[u8]) -> Result<VerifyToken, AppError> {
    let cipher = Aes256Gcm::new_from_slice(kek)
        .map_err(|e| AppError::Internal(format!("AES 初始化失败: {}", e)))?;
    let mut nonce_bytes = vec![0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let verify_plain: &[u8] = b"NotePodVerify!!";
    let ciphertext = cipher.encrypt(nonce, verify_plain)
        .map_err(|e| AppError::Internal(format!("验证令牌创建失败: {}", e)))?;
    let mut combined = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);
    Ok(VerifyToken {
        data: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &combined),
    })
}

/// 校验密码：用 KEK 解密验证令牌，检查是否匹配
pub fn check_verify_token(kek: &[u8], verify: &VerifyToken) -> Result<bool, AppError> {
    let combined = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &verify.data)
        .map_err(|_| AppError::Internal("base64 解码失败".to_string()))?;
    if combined.len() < NONCE_LEN + 16 {
        return Err(AppError::Internal("验证数据长度异常".to_string()));
    }
    let (nonce_bytes, ciphertext) = combined.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new_from_slice(kek)
        .map_err(|e| AppError::Internal(format!("AES 初始化失败: {}", e)))?;
    match cipher.decrypt(nonce, ciphertext) {
        Ok(plaintext) => Ok(plaintext == b"NotePodVerify!!"),
        Err(_) => Ok(false),
    }
}

// ============================================================
// 内容加解密（笔记 content）
// ============================================================

/// 加密文本内容，返回 "ENC:base64(nonce + ciphertext + tag)"
pub fn encrypt_content(plaintext: &str, master_key: &[u8]) -> Result<String, AppError> {
    let cipher = Aes256Gcm::new_from_slice(master_key)
        .map_err(|e| AppError::Internal(format!("AES 初始化失败: {}", e)))?;
    let mut nonce_bytes = vec![0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes())
        .map_err(|e| AppError::Internal(format!("加密失败: {}", e)))?;
    let mut combined = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);
    let encoded = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &combined);
    Ok(format!("ENC:{}", encoded))
}

/// 解密笔记 content（支持加密格式和明文向后兼容）
pub fn decrypt_content(ciphertext: &str, master_key: &[u8]) -> Result<String, AppError> {
    if !ciphertext.starts_with("ENC:") {
        return Ok(ciphertext.to_string());
    }
    let b64_data = &ciphertext[4..];
    let combined = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, b64_data)
        .map_err(|_| AppError::Internal("base64 解码失败".to_string()))?;
    if combined.len() < NONCE_LEN + 16 {
        return Err(AppError::Internal("密文数据长度异常".to_string()));
    }
    let (nonce_bytes, ciphertext_bytes) = combined.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new_from_slice(master_key)
        .map_err(|e| AppError::Internal(format!("AES 初始化失败: {}", e)))?;
    let plaintext = cipher.decrypt(nonce, ciphertext_bytes)
        .map_err(|_| AppError::Internal("解密失败：密钥不匹配或数据损坏".to_string()))?;
    String::from_utf8(plaintext).map_err(|e| AppError::Internal(format!("UTF-8 解码失败: {}", e)))
}

// ============================================================
// 文件级加解密（Git 备份 .md.enc）
// ============================================================

/// 加密完整文件内容（用于 Git 导出 .md.enc）
pub fn encrypt_file_content(content: &str, master_key: &[u8]) -> Result<String, AppError> {
    let cipher = Aes256Gcm::new_from_slice(master_key)
        .map_err(|e| AppError::Internal(format!("AES 初始化失败: {}", e)))?;
    let mut nonce_bytes = vec![0u8; NONCE_LEN];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, content.as_bytes())
        .map_err(|e| AppError::Internal(format!("文件加密失败: {}", e)))?;
    let mut combined = Vec::with_capacity(NONCE_LEN + ciphertext.len());
    combined.extend_from_slice(&nonce_bytes);
    combined.extend_from_slice(&ciphertext);
    Ok(base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &combined))
}

/// 解密 .md.enc 文件内容
pub fn decrypt_file_content(encrypted_b64: &str, master_key: &[u8]) -> Result<String, AppError> {
    let combined = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, encrypted_b64)
        .map_err(|_| AppError::Internal("base64 解码失败".to_string()))?;
    if combined.len() < NONCE_LEN + 16 {
        return Err(AppError::Internal("密文数据长度异常".to_string()));
    }
    let (nonce_bytes, ciphertext_bytes) = combined.split_at(NONCE_LEN);
    let nonce = Nonce::from_slice(nonce_bytes);
    let cipher = Aes256Gcm::new_from_slice(master_key)
        .map_err(|e| AppError::Internal(format!("AES 初始化失败: {}", e)))?;
    let plaintext = cipher.decrypt(nonce, ciphertext_bytes)
        .map_err(|_| AppError::Internal("文件解密失败：密钥不匹配或数据损坏".to_string()))?;
    String::from_utf8(plaintext).map_err(|e| AppError::Internal(format!("UTF-8 解码失败: {}", e)))
}

// ============================================================
// Git 凭据加解密（桌面端专属）
// ============================================================

pub fn encrypt_credential(credential: &str, master_key: &[u8]) -> Result<String, AppError> {
    encrypt_content(credential, master_key)
}

pub fn decrypt_credential(encrypted: &str, master_key: &[u8]) -> Result<String, AppError> {
    decrypt_content(encrypted, master_key)
}

// ============================================================
// 完整的加密设置流程
// ============================================================

/// 创建完整的加密配置
pub fn create_encryption_config(password: &str, master_key: &[u8]) -> Result<EncConfigData, AppError> {
    let salt = generate_salt();
    let kek = kdf_derive(password, &salt)?;
    let wrapped_key = wrap_master_key(master_key, &kek)?;
    let verify = create_verify_token(&kek)?;
    Ok(EncConfigData {
        version: 1,
        kdf_algorithm: "Argon2id".to_string(),
        salt: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &salt),
        kdf_params: KdfParams::default(),
        wrapped_key,
        verify,
    })
}

/// 从密码解包 Master Key（保留用于 key.json 跨设备导入）
#[allow(dead_code)]
pub fn recover_master_key(password: &str, config: &EncConfigData) -> Result<Vec<u8>, AppError> {
    let salt = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &config.salt)
        .map_err(|_| AppError::Internal("salt base64 解码失败".to_string()))?;
    let kek = kdf_derive(password, &salt)?;
    let valid = check_verify_token(&kek, &config.verify)?;
    if !valid {
        return Err(AppError::Internal("密码错误".to_string()));
    }
    unwrap_master_key(&config.wrapped_key, &kek)
}

/// 修改密码：用旧密码解包 MK，再用新密码重新包裹（保留用于 key.json 跨设备导入）
#[allow(dead_code)]
pub fn change_encryption_password(old_password: &str, new_password: &str, config: &EncConfigData) -> Result<EncConfigData, AppError> {
    let master_key = recover_master_key(old_password, config)?;
    create_encryption_config(new_password, &master_key)
}

// ============================================================
// 锁屏密码哈希（Argon2id）- 旧版兼容，单密码方案已改用 verify token
// ============================================================

/// 哈希锁屏密码，返回 "argon2id$salt_b64$hash_b64" 格式
#[allow(dead_code)]
pub fn hash_lock_password(password: &str) -> Result<String, AppError> {
    let salt = generate_salt();
    let params = Params::new(ARGON_M_COST, ARGON_T_COST, ARGON_P_COST, Some(KEY_LEN))
        .map_err(|e| AppError::Internal(format!("Argon2 参数错误: {}", e)))?;
    let argon = Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);
    let mut hash = vec![0u8; KEY_LEN];
    argon.hash_password_into(password.as_bytes(), &salt, &mut hash)
        .map_err(|e| AppError::Internal(format!("Argon2 哈希失败: {}", e)))?;

    let salt_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &salt);
    let hash_b64 = base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &hash);
    Ok(format!("argon2id${}${}", salt_b64, hash_b64))
}

/// 验证锁屏密码（旧版兼容）
#[allow(dead_code)]
pub fn verify_lock_password(password: &str, stored: &str) -> Result<bool, AppError> {
    if !stored.starts_with("argon2id$") {
        // 旧版明文存储（向后兼容）
        return Ok(stored == password);
    }

    let parts: Vec<&str> = stored.splitn(3, '$').collect();
    if parts.len() != 3 {
        return Ok(false);
    }

    let salt = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, parts[1])
        .map_err(|_| AppError::Internal("salt base64 解码失败".to_string()))?;
    let expected_hash = base64::Engine::decode(&base64::engine::general_purpose::STANDARD, parts[2])
        .map_err(|_| AppError::Internal("hash base64 解码失败".to_string()))?;

    let params = Params::new(ARGON_M_COST, ARGON_T_COST, ARGON_P_COST, Some(KEY_LEN))
        .map_err(|e| AppError::Internal(format!("Argon2 参数错误: {}", e)))?;
    let argon = Argon2::new(argon2::Algorithm::Argon2id, argon2::Version::V0x13, params);
    let mut hash = vec![0u8; KEY_LEN];
    argon.hash_password_into(password.as_bytes(), &salt, &mut hash)
        .map_err(|e| AppError::Internal(format!("Argon2 哈希失败: {}", e)))?;

    Ok(hash == expected_hash)
}
