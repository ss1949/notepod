//! Git2 操作模块（基于 libgit2，跨平台支持）
//! 替代原有的 Command::new("git") CLI 调用

use std::path::Path;
use git2::{
    Repository, RemoteCallbacks, Cred, FetchOptions, PushOptions,
    IndexAddOption,
};
use crate::error::AppError;

/// Git2 操作封装
pub struct Git2Ops;

impl Git2Ops {
    /// 创建带认证的回调（'static：username/password 被 move 进闭包）
    fn create_callbacks(username: String, password: String) -> RemoteCallbacks<'static> {
        let mut callbacks = RemoteCallbacks::new();
        callbacks.credentials(move |_url, username_from_url, _allowed_types| {
            let user = username_from_url.unwrap_or(&username);
            Cred::userpass_plaintext(user, &password)
        });
        callbacks
    }

    /// 检查远程仓库是否可达（ls-remote）
    pub fn ls_remote(
        url: &str,
        username: &str,
        password: &str,
    ) -> Result<(), AppError> {
        // 创建临时仓库用于连接远程
        let callbacks = Self::create_callbacks(username.to_string(), password.to_string());

        // 用临时目录创建空仓库，添加 remote 并连接
        let tmp = std::env::temp_dir().join(format!("notepod_lsremote_{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp);
        let repo = Repository::init(&tmp)
            .map_err(|e| AppError::Internal(format!("创建临时仓库失败: {}", e)))?;

        let mut remote = repo.remote_anonymous(url)
            .map_err(|e| AppError::Internal(format!("创建 remote 失败: {}", e)))?;

        remote.connect_auth(git2::Direction::Fetch, Some(callbacks), None)
            .map_err(|e| AppError::Internal(format!("Git 仓库不可达: {}", e)))?;

        let _ = remote.disconnect();
        let _ = std::fs::remove_dir_all(&tmp);
        Ok(())
    }

    /// 克隆仓库
    pub fn clone_repo(
        url: &str,
        path: &Path,
        username: &str,
        password: &str,
    ) -> Result<Repository, AppError> {
        let callbacks = Self::create_callbacks(username.to_string(), password.to_string());
        let mut fo = FetchOptions::new();
        fo.remote_callbacks(callbacks);

        let mut builder = git2::build::RepoBuilder::new();
        builder.fetch_options(fo);

        builder.clone(url, path)
            .map_err(|e| AppError::Internal(format!("Git clone 失败: {}", e)))
    }

    /// 打开本地仓库
    pub fn open_repo(path: &Path) -> Result<Repository, AppError> {
        Repository::open(path)
            .map_err(|e| AppError::Internal(format!("打开 Git 仓库失败: {}", e)))
    }

    /// 更新 remote URL
    pub fn set_remote_url(
        repo: &Repository,
        remote_name: &str,
        url: &str,
    ) -> Result<(), AppError> {
        repo.remote_set_url(remote_name, url)
            .map_err(|e| AppError::Internal(format!("设置 remote URL 失败: {}", e)))
    }

    /// git add -A
    pub fn add_all(repo: &Repository) -> Result<(), AppError> {
        let mut index = repo.index()
            .map_err(|e| AppError::Internal(format!("获取 index 失败: {}", e)))?;

        index.add_all(["*"].iter(), IndexAddOption::DEFAULT, None)
            .map_err(|e| AppError::Internal(format!("git add 失败: {}", e)))?;

        index.write()
            .map_err(|e| AppError::Internal(format!("写入 index 失败: {}", e)))?;

        Ok(())
    }

    /// git commit
    pub fn commit(
        repo: &Repository,
        message: &str,
        author_name: Option<&str>,
        author_email: Option<&str>,
    ) -> Result<(), AppError> {
        let mut index = repo.index()
            .map_err(|e| AppError::Internal(format!("获取 index 失败: {}", e)))?;

        let oid = index.write_tree()
            .map_err(|e| AppError::Internal(format!("写入 tree 失败: {}", e)))?;

        let tree = repo.find_tree(oid)
            .map_err(|e| AppError::Internal(format!("查找 tree 失败: {}", e)))?;

        let sig = if let (Some(name), Some(email)) = (author_name, author_email) {
            git2::Signature::now(name, email)
                .map_err(|e| AppError::Internal(format!("创建 signature 失败: {}", e)))?
        } else {
            repo.signature().or_else(|_| {
                // 系统无 git 配置时使用默认值
                git2::Signature::now("Notepod", "notepod@local")
            })
            .map_err(|e| AppError::Internal(format!("获取 signature 失败: {}", e)))?
        };

        // 获取父提交（如果有）
        let parent = match repo.head() {
            Ok(head) => {
                let commit = head.peel_to_commit()
                    .map_err(|e| AppError::Internal(format!("获取 HEAD commit 失败: {}", e)))?;
                Some(commit)
            }
            Err(_) => None, // 首次提交
        };

        let parents: Vec<&git2::Commit> = match parent.as_ref() {
            Some(p) => vec![p],
            None => vec![],
        };

        repo.commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
            .map_err(|e| AppError::Internal(format!("git commit 失败: {}", e)))?;

        Ok(())
    }

    /// git push
    pub fn push(
        repo: &Repository,
        remote_name: &str,
        username: &str,
        password: &str,
    ) -> Result<(), AppError> {
        let mut remote = repo.find_remote(remote_name)
            .map_err(|e| AppError::Internal(format!("查找 remote '{}' 失败: {}", remote_name, e)))?;

        let callbacks = Self::create_callbacks(username.to_string(), password.to_string());
        let mut po = PushOptions::new();
        po.remote_callbacks(callbacks);

        // 获取当前分支
        let head = repo.head()
            .map_err(|e| AppError::Internal(format!("获取 HEAD 失败: {}", e)))?;

        let branch_name = head.shorthand()
            .ok_or_else(|| AppError::Internal("无法获取分支名".to_string()))?;

        let refspec = format!("refs/heads/{}", branch_name);

        remote.push(&[&refspec], Some(&mut po))
            .map_err(|e| AppError::Internal(format!("git push 失败: {}", e)))?;

        Ok(())
    }

    /// git pull (fetch + merge)
    pub fn pull(
        repo: &Repository,
        remote_name: &str,
        username: &str,
        password: &str,
    ) -> Result<String, AppError> {
        let mut remote = repo.find_remote(remote_name)
            .map_err(|e| AppError::Internal(format!("查找 remote '{}' 失败: {}", remote_name, e)))?;

        // 获取当前分支
        let head = repo.head()
            .map_err(|e| AppError::Internal(format!("获取 HEAD 失败: {}", e)))?;

        let branch_name = head.shorthand()
            .ok_or_else(|| AppError::Internal("无法获取分支名".to_string()))?;

        // fetch
        let callbacks = Self::create_callbacks(username.to_string(), password.to_string());
        let mut fo = FetchOptions::new();
        fo.remote_callbacks(callbacks);
        remote.fetch(&[branch_name], Some(&mut fo), None)
            .map_err(|e| AppError::Internal(format!("git fetch 失败: {}", e)))?;

        // 获取远程分支引用
        let fetch_head = repo.find_reference(&format!("refs/remotes/{}/{}", remote_name, branch_name))
            .map_err(|e| AppError::Internal(format!("查找远程分支失败: {}", e)))?;

        let fetch_commit = repo.reference_to_annotated_commit(&fetch_head)
            .map_err(|e| AppError::Internal(format!("获取远程 commit 失败: {}", e)))?;

        // 分析并合并
        let (analysis, _preference) = repo.merge_analysis(&[&fetch_commit])
            .map_err(|e| AppError::Internal(format!("分析合并失败: {}", e)))?;

        if analysis.is_up_to_date() {
            return Ok("Already up to date.".to_string());
        }

        if analysis.is_fast_forward() {
            // Fast-forward
            let mut local_ref = repo.find_reference(&format!("refs/heads/{}", branch_name))
                .map_err(|e| AppError::Internal(format!("查找本地分支失败: {}", e)))?;

            local_ref.set_target(fetch_commit.id(), "Fast-forward")
                .map_err(|e| AppError::Internal(format!("Fast-forward 失败: {}", e)))?;

            repo.set_head(&format!("refs/heads/{}", branch_name))
                .map_err(|e| AppError::Internal(format!("设置 HEAD 失败: {}", e)))?;

            repo.checkout_head(Some(git2::build::CheckoutBuilder::default().force()))
                .map_err(|e| AppError::Internal(format!("checkout 失败: {}", e)))?;

            return Ok(format!("Fast-forward to {}", &fetch_commit.id().to_string()[..7]));
        }

        // 普通合并
        repo.merge(&[&fetch_commit], None, None)
            .map_err(|e| AppError::Internal(format!("合并失败: {}", e)))?;

        // 提交合并：需要从 AnnotatedCommit 获取 Commit
        let sig = repo.signature().or_else(|_| {
            git2::Signature::now("Notepod", "notepod@local")
        })
            .map_err(|e| AppError::Internal(format!("获取 signature 失败: {}", e)))?;

        let mut index = repo.index()
            .map_err(|e| AppError::Internal(format!("获取 index 失败: {}", e)))?;

        let oid = index.write_tree()
            .map_err(|e| AppError::Internal(format!("写入 tree 失败: {}", e)))?;

        let tree = repo.find_tree(oid)
            .map_err(|e| AppError::Internal(format!("查找 tree 失败: {}", e)))?;

        let local_commit = repo.head()
            .and_then(|h| h.peel_to_commit())
            .map_err(|e| AppError::Internal(format!("获取本地 commit 失败: {}", e)))?;

        // 从 AnnotatedCommit 获取实际的 Commit
        let remote_commit = repo.find_commit(fetch_commit.id())
            .map_err(|e| AppError::Internal(format!("获取远程 commit 失败: {}", e)))?;

        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "Merge remote-tracking branch",
            &tree,
            &[&local_commit, &remote_commit],
        ).map_err(|e| AppError::Internal(format!("合并提交失败: {}", e)))?;

        repo.cleanup_state()
            .map_err(|e| AppError::Internal(format!("清理合并状态失败: {}", e)))?;

        Ok(format!("Merged {}", &fetch_commit.id().to_string()[..7]))
    }
}
