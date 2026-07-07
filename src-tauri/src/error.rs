use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("数据库错误: {0}")]
    Db(#[from] rusqlite::Error),

    #[error("IO错误: {0}")]
    Io(#[from] std::io::Error),

    #[error("CSV错误: {0}")]
    Csv(#[from] csv::Error),

    #[error("序列化错误: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("Zip错误: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("笔记未找到: {0}")]
    NotFound(String),

    #[error("参数错误: {0}")]
    #[allow(dead_code)]
    BadRequest(String),

    #[error("内部错误: {0}")]
    Internal(String),
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(self.to_string().as_ref())
    }
}
