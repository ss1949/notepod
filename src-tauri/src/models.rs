use serde::{Deserialize, Serialize};

/// 笔记状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
pub enum NoteStatus {
    Todo,
    Done,
}

#[allow(dead_code)]
impl NoteStatus {
    pub fn as_str(&self) -> &str {
        match self {
            NoteStatus::Todo => "todo",
            NoteStatus::Done => "done",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "done" => NoteStatus::Done,
            _ => NoteStatus::Todo,
        }
    }

    pub fn toggle(&self) -> Self {
        match self {
            NoteStatus::Todo => NoteStatus::Done,
            NoteStatus::Done => NoteStatus::Todo,
        }
    }
}

/// 优先级
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)]
pub enum Priority {
    High,
    Medium,
    Low,
}

#[allow(dead_code)]
impl Priority {
    pub fn as_str(&self) -> &str {
        match self {
            Priority::High => "high",
            Priority::Medium => "medium",
            Priority::Low => "low",
        }
    }

    pub fn from_str(s: &str) -> Self {
        match s {
            "high" => Priority::High,
            "low" => Priority::Low,
            _ => Priority::Medium,
        }
    }
}

/// 笔记
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub content: String,
    pub folder_id: Option<String>,
    pub status: String,
    pub priority: String,
    pub starred: bool,
    pub pinned: bool,
    pub is_encrypted: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub tags: Vec<String>,
    // TODO 增强字段
    pub due_date: Option<i64>,
    pub reminder: Option<i64>,
    pub parent_task_id: Option<String>,
    pub note_type: String,
    pub journal_date: Option<String>,
}

/// 笔记摘要（列表视图用，不含 content，减少数据传输）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NoteSummary {
    pub id: String,
    pub title: String,
    pub folder_id: Option<String>,
    pub status: String,
    pub priority: String,
    pub starred: bool,
    pub pinned: bool,
    pub is_encrypted: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
    pub tags: Vec<String>,
    pub due_date: Option<i64>,
    pub reminder: Option<i64>,
    pub parent_task_id: Option<String>,
    pub note_type: String,
    pub journal_date: Option<String>,
    /// 任务行（从 content 中提取，用于瀑布流和任务聚合）
    pub task_lines: Vec<String>,
    /// 块 ID 映射 (block_id -> 行内容)，用于跨笔记块引用/内嵌
    pub block_ids: Vec<(String, String)>,
    /// Wiki 链接标题列表，用于反向链接
    pub wiki_links: Vec<String>,
}

/// 待办任务（用于每日日志的待办提醒）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(dead_code)]
pub struct PendingTask {
    pub id: String,
    pub title: String,
    pub status: String,
    pub priority: String,
    pub due_date: Option<i64>,
    pub folder_name: Option<String>,
}

/// 创建笔记请求
#[derive(Debug, Deserialize)]
pub struct CreateNoteRequest {
    pub title: String,
    pub content: String,
    pub folder_id: Option<String>,
    pub priority: Option<String>,
    pub status: Option<String>,
}

/// 更新笔记请求
#[derive(Debug, Deserialize)]
pub struct UpdateNoteRequest {
    pub id: String,
    pub title: Option<String>,
    pub content: Option<String>,
    pub folder_id: Option<Option<String>>,
    pub created_at: Option<i64>,
    pub due_date: Option<Option<i64>>,
    pub deleted_at: Option<Option<i64>>,
}

/// 查询参数
#[derive(Debug, Clone, Deserialize, Default)]
pub struct QueryParams {
    pub keyword: Option<String>,
    pub date_from: Option<i64>,
    pub date_to: Option<i64>,
    pub tag_ids: Vec<String>,
    pub priorities: Vec<String>,
    pub status: Option<String>,
    pub note_type: Option<String>,
    pub starred_only: bool,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

/// 查询结果行
#[derive(Debug, Clone, Serialize)]
pub struct NoteRow {
    pub id: String,
    pub title: String,
    pub content_preview: String,
    pub tags: Vec<String>,
    pub priority: String,
    pub status: String,
    pub starred: bool,
    pub pinned: bool,
    pub created_at: i64,
    pub updated_at: i64,
    pub note_type: String,
}

/// 标签
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub name: String,
    pub color: String,
}

/// 文件夹
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub color: String,
    pub sort_order: i64,
}

/// 文件夹笔记数量
#[derive(Debug, Clone, Serialize)]
pub struct FolderNoteCount {
    pub folder_id: String,
    pub count: i64,
}

/// 热力图活动数据
#[derive(Debug, Clone, Serialize)]
#[allow(dead_code)]
pub struct ActivityDay {
    pub date: String,
    pub count: i64,
}

/// 备份信息
#[derive(Debug, Serialize)]
pub struct BackupInfo {
    pub path: String,
    pub size: u64,
    pub note_count: usize,
    pub created_at: String,
}

/// 恢复信息
#[derive(Debug, Serialize)]
pub struct RestoreInfo {
    pub note_count: usize,
    pub migrated: bool,
    pub restored_at: String,
    pub is_encrypted: bool,
}

/// 备份清单
#[derive(Debug, Serialize, Deserialize)]
pub struct BackupManifest {
    pub app_version: String,
    pub backup_schema_version: u32,
    pub created_at: String,
    pub note_count: usize,
    pub attachment_count: usize,
    pub encrypted: bool,
    pub checksum: String,
}

/// Git 备份同步配置（全平台）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitConfig {
    pub repo_url: String,
    pub username: String,
    pub credential: String,
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    pub last_sync_at: Option<String>,
}

/// Git 同步结果
#[derive(Debug, Clone, Serialize)]
pub struct GitSyncResult {
    pub success: bool,
    pub message: String,
    pub synced_at: Option<String>,
}

/// Git 配置保存结果
#[derive(Debug, Clone, Serialize)]
pub struct GitConfigSaveResult {
    pub has_encryption: bool,  // 远程仓库是否有 key.json
}

/// 锁屏配置信息（不返回密码本身）
#[derive(Debug, Clone, Serialize)]
pub struct LockConfigInfo {
    pub has_password: bool,
    pub hint: String,
}

/// 加密配置（存储/传输）- 保留用于 key.json 跨设备导入
#[allow(dead_code)]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EncryptionConfigData {
    pub version: u32,
    pub kdf_algorithm: String,
    pub salt: String,
    pub kdf_m_cost: u32,
    pub kdf_t_cost: u32,
    pub kdf_p_cost: u32,
    pub wrapped_key: String,
    pub verify: String,
}

/// 加密状态信息（返回给前端）
#[derive(Debug, Clone, Serialize)]
pub struct EncStatus {
    pub enabled: bool,       // MK 是否在内存中（已解锁）
    pub has_config: bool,    // 是否配置了加密（DB 中有 lock_config 记录）
}
