//! Gix 操作模块（基于 gitoxide，纯 Rust 实现，无 C 依赖）

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use gix::bstr::ByteSlice;
use crate::error::AppError;

#[cfg(target_os = "android")]
const ZERO_OID: &str = "0000000000000000000000000000000000000000";

pub struct GixOps;

impl GixOps {
    /// 检查远程仓库是否可达
    pub fn ls_remote(url: &str, _username: &str, _password: &str, work_dir: &Path) -> Result<(), AppError> {
        let temp_dir = work_dir.join(format!("notepod_ls_{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir)
            .map_err(|e| AppError::Internal(format!("创建临时目录失败: {}", e)))?;

        let result = (|| -> Result<(), AppError> {
            let repo = gix::init(&temp_dir)
                .map_err(|e| AppError::Internal(format!("初始化临时仓库失败: {}", e)))?;
            let remote = repo.remote_at(url)
                .map_err(|e| AppError::Internal(format!("解析远程 URL 失败: {}", e)))?;
            let conn = remote.connect(gix::remote::Direction::Fetch)
                .map_err(|e| AppError::Internal(format!("连接远程仓库失败: {}", e)))?;
            let _ = conn.ref_map(gix::progress::Discard, Default::default())
                .map_err(|e| AppError::Internal(format!("远程仓库不可达: {}", e)))?;
            Ok(())
        })();

        let _ = std::fs::remove_dir_all(&temp_dir);
        result
    }

    /// 克隆仓库
    pub fn clone_repo(url: &str, path: &Path, _username: &str, _password: &str) -> Result<(), AppError> {
        use gix::clone::PrepareFetch;

        let mut clone = PrepareFetch::new(
            url, path,
            gix::create::Kind::WithWorktree,
            Default::default(),
            gix::open::Options::isolated(),
        ).map_err(|e| AppError::Internal(format!("准备克隆失败: {}", e)))?;

        let interrupt = AtomicBool::new(false);
        let (mut prepare_checkout, _outcome) = clone.fetch_then_checkout(gix::progress::Discard, &interrupt)
            .map_err(|e| AppError::Internal(format!("克隆拉取失败: {}", e)))?;

        // checkout main worktree
        let (_repo, _checkout_outcome) = prepare_checkout.main_worktree(gix::progress::Discard, &interrupt)
            .map_err(|e| AppError::Internal(format!("检出文件失败: {}", e)))?;

        Ok(())
    }

    /// 打开本地仓库
    pub fn open_repo(path: &Path) -> Result<gix::Repository, AppError> {
        gix::open(path).map_err(|e| AppError::Internal(format!("打开 Git 仓库失败: {}", e)))
    }

    /// 更新 remote URL
    pub fn set_remote_url(repo: &gix::Repository, remote_name: &str, url: &str) -> Result<(), AppError> {
        let config_path = repo.git_dir().join("config");
        let content = std::fs::read_to_string(&config_path)
            .map_err(|e| AppError::Internal(format!("读取 git config 失败: {}", e)))?;

        let section_header = format!("[remote \"{}\"]", remote_name);
        let mut new_content = String::new();
        let mut in_section = false;
        let mut url_replaced = false;
        let mut section_found = false;

        for line in content.lines() {
            let trimmed = line.trim();
            if trimmed == section_header {
                in_section = true;
                section_found = true;
                new_content.push_str(line);
                new_content.push('\n');
                continue;
            }
            if in_section && trimmed.starts_with('[') { in_section = false; }
            if in_section && trimmed.starts_with("url") {
                new_content.push_str(&format!("\turl = {}\n", url));
                url_replaced = true;
            } else {
                new_content.push_str(line);
                new_content.push('\n');
            }
        }

        if section_found && !url_replaced {
            if let Some(idx) = new_content.find(&section_header) {
                new_content.insert_str(idx + section_header.len(), &format!("\n\turl = {}", url));
            }
        } else if !section_found {
            new_content.push_str(&format!("\n{}\n\turl = {}\n", section_header, url));
        }

        std::fs::write(&config_path, new_content)
            .map_err(|e| AppError::Internal(format!("写入 git config 失败: {}", e)))?;
        Ok(())
    }

    /// git add -A (no-op，commit 时直接构建 tree)
    pub fn add_all(_repo: &gix::Repository) -> Result<(), AppError> {
        Ok(())
    }

    /// git commit（从工作目录构建 tree，手动创建 commit 对象）
    pub fn commit(repo: &gix::Repository, message: &str, author_name: Option<&str>, author_email: Option<&str>) -> Result<(), AppError> {
        let name = author_name.unwrap_or("Notepod");
        let email = author_email.unwrap_or("notepod@local");
        let workdir = repo.workdir()
            .ok_or_else(|| AppError::Internal("仓库无工作目录".to_string()))?.to_path_buf();

        // 从工作目录构建 tree
        let tree_id = build_tree_from_workdir(repo, &workdir, &PathBuf::new())?;

        // 获取父 commit
        let head_commit = repo.head_commit().ok();

        // 检查变更
        if let Some(ref parent) = head_commit {
            if let Ok(parent_tree) = parent.tree() {
                if parent_tree.id == tree_id {
                    return Err(AppError::Internal("nothing to commit".to_string()));
                }
            }
        }

        // 构建 commit 对象
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default();

        let parents: Vec<gix::hash::ObjectId> = match head_commit.as_ref() {
            Some(c) => vec![c.id],
            None => vec![],
        };

        let commit = gix::objs::Commit {
            tree: tree_id,
            parents: parents.into_iter().collect(),
            author: gix::actor::Signature {
                name: name.into(),
                email: email.into(),
                time: gix::date::Time::new(now.as_secs() as i64, 0),
            },
            committer: gix::actor::Signature {
                name: name.into(),
                email: email.into(),
                time: gix::date::Time::new(now.as_secs() as i64, 0),
            },
            encoding: None,
            message: message.into(),
            extra_headers: Default::default(),
        };

        let commit_id = repo.write_object(&commit)
            .map_err(|e| AppError::Internal(format!("写入 commit 失败: {}", e)))?;

        // 更新 HEAD 引用（直接写 ref 文件，避免 gix 的 reflog 在 Android 上报错）
        let branch_name = get_current_branch(repo)?;
        let git_dir = repo.git_dir().to_path_buf();
        let ref_path = git_dir.join("refs").join("heads").join(&branch_name);
        if let Some(parent) = ref_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| AppError::Internal(format!("创建 refs/heads 目录失败: {}", e)))?;
        }
        std::fs::write(&ref_path, format!("{}\n", commit_id))
            .map_err(|e| AppError::Internal(format!("写入 ref 失败: {}", e)))?;

        // 初始 commit：确保 HEAD 指向正确的分支
        let head_path = git_dir.join("HEAD");
        if !head_path.exists() {
            std::fs::write(&head_path, format!("ref: refs/heads/{}\n", branch_name))
                .map_err(|e| AppError::Internal(format!("写入 HEAD 失败: {}", e)))?;
        }

        Ok(())
    }

    /// git push（桌面端使用 libgit2）
    #[cfg(not(target_os = "android"))]
    pub fn push(repo: &gix::Repository, remote_name: &str, username: &str, password: &str) -> Result<(), AppError> {
        let work_dir = repo.workdir()
            .ok_or_else(|| AppError::Internal("仓库无工作目录".to_string()))?;

        use crate::commands::git2_ops::Git2Ops;
        let git2_repo = git2::Repository::open(work_dir)
            .map_err(|e| AppError::Internal(format!("打开 git2 仓库失败: {}", e)))?;
        Git2Ops::push(&git2_repo, remote_name, username, password)
    }

    /// git push（Android 端使用 Git smart HTTP receive-pack，仅支持 HTTPS + token）
    ///
    /// MVP 限制：
    /// - 仅 HTTPS 仓库（不支持 SSH）
    /// - 仅 token/PAT 认证（不支持 SSH 私钥）
    /// - 仅 fast-forward push（不支持 force push）
    /// - pack 全量发送（不做 thin pack / delta）
    /// - 仓库数据量超过阈值时提示用户先在桌面端整理或改用同步
    #[cfg(target_os = "android")]
    pub fn push(repo: &gix::Repository, remote_name: &str, username: &str, password: &str) -> Result<(), AppError> {
        smart_http_push(repo, remote_name, username, password)
    }

    /// git pull (fetch + fast-forward)
    pub fn pull(repo: &gix::Repository, remote_name: &str, username: &str, password: &str) -> Result<String, AppError> {
        let remote_url = get_remote_url_from_config(repo, remote_name)?;
        let branch_name = get_current_branch(repo)?;
        let auth_url = build_auth_url(&remote_url, username, password);

        // 连接远程获取 ref_map
        let remote = repo.remote_at(auth_url.as_str())
            .map_err(|e| AppError::Internal(format!("解析远程 URL 失败: {}", e)))?;
        let conn = remote.connect(gix::remote::Direction::Fetch)
            .map_err(|e| AppError::Internal(format!("连接远程失败: {}", e)))?;

        let (ref_map, _handshake) = conn.ref_map(gix::progress::Discard, Default::default())
            .map_err(|e| AppError::Internal(format!("获取远程引用失败: {}", e)))?;

        // 从 ref_map.remote_refs 提取远程分支 OID（不过滤 mappings，直接读远程引用）
        let target_ref = format!("refs/heads/{}", branch_name);
        let remote_oid = ref_map.remote_refs.iter().find_map(|r| {
            let (name, oid) = match r {
                gix::protocol::handshake::Ref::Direct { full_ref_name, object } => (full_ref_name.as_bstr(), *object),
                gix::protocol::handshake::Ref::Peeled { full_ref_name, object, .. } => (full_ref_name.as_bstr(), *object),
                _ => return None,
            };
            if name == target_ref.as_bytes() { Some(oid) } else { None }
        });

        let remote_oid = match remote_oid {
            Some(oid) => oid,
            None => return Ok("已经是最新。".to_string()),
        };

        // 重新连接并 fetch 对象
        let remote2 = repo.remote_at(auth_url.as_str())
            .map_err(|e| AppError::Internal(format!("重新连接远程失败: {}", e)))?;
        let conn2 = remote2.connect(gix::remote::Direction::Fetch)
            .map_err(|e| AppError::Internal(format!("连接远程失败: {}", e)))?;

        let interrupt = AtomicBool::new(false);
        let fetch = conn2.prepare_fetch(gix::progress::Discard, Default::default())
            .map_err(|e| AppError::Internal(format!("准备 fetch 失败: {}", e)))?;
        let _outcome = fetch.receive(gix::progress::Discard, &interrupt)
            .map_err(|e| AppError::Internal(format!("fetch 失败: {}", e)))?;

        // 比较本地和远程 OID
        let local_ref_name = format!("refs/heads/{}", branch_name);
        let local_oid = repo.find_reference(&local_ref_name).ok().map(|r| r.id());

        match local_oid {
            Some(local) if local == remote_oid => Ok("已经是最新。".to_string()),
            _ => {
                // 直接写 ref 文件，避免 gix 的 reflog 在 Android 上报错
                let git_dir = repo.git_dir().to_path_buf();
                let ref_path = git_dir.join("refs").join("heads").join(&branch_name);
                if let Some(parent) = ref_path.parent() {
                    std::fs::create_dir_all(parent)
                        .map_err(|e| AppError::Internal(format!("创建 refs/heads 目录失败: {}", e)))?;
                }
                std::fs::write(&ref_path, format!("{}\n", remote_oid))
                    .map_err(|e| AppError::Internal(format!("更新引用失败: {}", e)))?;
                reset_hard(repo, &remote_oid)?;
                Ok(format!("Fast-forward to {}", &hex::encode(remote_oid.as_bytes())[..8]))
            }
        }
    }
}

// ============================================================
// 辅助函数
// ============================================================

fn build_tree_from_workdir(repo: &gix::Repository, workdir: &Path, prefix: &Path) -> Result<gix::hash::ObjectId, AppError> {
    let dir = workdir.join(prefix);
    let mut entries = Vec::new();

    if dir.exists() {
        for entry in std::fs::read_dir(&dir).map_err(|e| AppError::Internal(format!("读取目录失败: {}", e)))? {
            let entry = entry.map_err(|e| AppError::Internal(format!("读取目录项失败: {}", e)))?;
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            if name == ".git" { continue; }

            if path.is_dir() {
                let sub_tree_id = build_tree_from_workdir(repo, workdir, &prefix.join(&name))?;
                entries.push(gix::objs::tree::Entry {
                    mode: gix::objs::tree::EntryMode::from(gix::objs::tree::EntryKind::Tree),
                    filename: name.into(),
                    oid: sub_tree_id,
                });
            } else if path.is_file() {
                let data = std::fs::read(&path).map_err(|e| AppError::Internal(format!("读取文件失败: {}", e)))?;
                let blob_id = repo.write_blob(&data).map_err(|e| AppError::Internal(format!("写入 blob 失败: {}", e)))?;
                entries.push(gix::objs::tree::Entry {
                    mode: gix::objs::tree::EntryMode::from(gix::objs::tree::EntryKind::Blob),
                    filename: name.into(),
                    oid: blob_id.detach(),
                });
            }
        }
    }

    entries.sort();
    let tree = gix::objs::Tree { entries };
    let id = repo.write_object(&tree).map_err(|e| AppError::Internal(format!("写入 tree 失败: {}", e)))?;
    Ok(id.detach())
}

fn get_remote_url_from_config(repo: &gix::Repository, remote_name: &str) -> Result<String, AppError> {
    let config_path = repo.git_dir().join("config");
    let content = std::fs::read_to_string(&config_path)
        .map_err(|e| AppError::Internal(format!("读取 git config 失败: {}", e)))?;
    let section_header = format!("[remote \"{}\"]", remote_name);
    let mut in_section = false;
    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed == section_header { in_section = true; continue; }
        if in_section && trimmed.starts_with('[') { break; }
        if in_section && trimmed.starts_with("url") {
            return Ok(trimmed.split('=').nth(1).unwrap_or("").trim().to_string());
        }
    }
    Err(AppError::Internal(format!("remote '{}' 未找到", remote_name)))
}

fn get_current_branch(repo: &gix::Repository) -> Result<String, AppError> {
    match repo.head_ref().map_err(|e| AppError::Internal(format!("获取 HEAD 失败: {}", e)))? {
        Some(reference) => {
            let name = reference.name().as_bstr().to_str().unwrap_or("main");
            Ok(name.strip_prefix("refs/heads/").unwrap_or(name).to_string())
        }
        None => Ok("main".to_string()),
    }
}

fn build_auth_url(url: &str, username: &str, password: &str) -> String {
    if url.starts_with("https://") {
        let stripped = url.replace("https://", "");
        let stripped = if stripped.contains('@') { stripped.split('@').last().unwrap_or(&stripped).to_string() } else { stripped };
        format!("https://{}:{}@{}", username, password, stripped)
    } else { url.to_string() }
}


fn reset_hard(repo: &gix::Repository, target: &gix::hash::ObjectId) -> Result<(), AppError> {
    let workdir = repo.workdir().ok_or_else(|| AppError::Internal("仓库无工作目录".to_string()))?.to_path_buf();
    let commit = repo.find_commit(*target).map_err(|e| AppError::Internal(format!("查找 commit 失败: {}", e)))?;
    let tree = commit.tree().map_err(|e| AppError::Internal(format!("获取 tree 失败: {}", e)))?;

    for entry in std::fs::read_dir(&workdir).map_err(|e| AppError::Internal(format!("读取目录失败: {}", e)))? {
        let entry = entry.map_err(|e| AppError::Internal(format!("读取目录项失败: {}", e)))?;
        let path = entry.path();
        if path.file_name().map(|n| n == ".git").unwrap_or(false) { continue; }
        if path.is_dir() { let _ = std::fs::remove_dir_all(&path); } else { let _ = std::fs::remove_file(&path); }
    }

    restore_tree_to_workdir(repo, &tree, &workdir, &PathBuf::new())?;
    Ok(())
}

fn restore_tree_to_workdir(repo: &gix::Repository, tree: &gix::Tree, workdir: &Path, prefix: &Path) -> Result<(), AppError> {
    for entry in tree.iter() {
        let entry = entry.map_err(|e| AppError::Internal(format!("遍历 tree 失败: {}", e)))?;
        let name = entry.filename().to_str().unwrap_or("");
        let path = prefix.join(name);

        if entry.mode().is_tree() {
            let sub_tree = repo.find_object(entry.oid().to_owned())
                .map_err(|e| AppError::Internal(format!("查找 tree 失败: {}", e)))?
                .try_into_tree().map_err(|e| AppError::Internal(format!("转换 tree 失败: {}", e)))?;
            let sub_dir = workdir.join(&path);
            std::fs::create_dir_all(&sub_dir).map_err(|e| AppError::Internal(format!("创建目录失败: {}", e)))?;
            restore_tree_to_workdir(repo, &sub_tree, workdir, &path)?;
        } else if entry.mode().is_blob() {
            let blob = repo.find_object(entry.oid().to_owned())
                .map_err(|e| AppError::Internal(format!("查找 blob 失败: {}", e)))?;
            let file_path = workdir.join(&path);
            if let Some(parent) = file_path.parent() {
                std::fs::create_dir_all(parent).map_err(|e| AppError::Internal(format!("创建目录失败: {}", e)))?;
            }
            std::fs::write(&file_path, &blob.data).map_err(|e| AppError::Internal(format!("写入文件失败: {}", e)))?;
        }
    }
    Ok(())
}

// ============================================================
// Android 专用：Git smart HTTP receive-pack push 实现
//
// 与桌面端完全独立 —— 桌面端使用系统 git CLI（见上方 #[cfg(not(android))] push），
// Android 端因无法依赖系统 git 二进制，使用 reqwest 手动实现 smart HTTP 协议。
//
// MVP 限制：
//   1. 仅 HTTPS 仓库（拒绝 ssh://、git:// 等）
//   2. 仅 token/PAT 认证（拒绝 SSH 私钥）
//   3. 仅 fast-forward push（拒绝 force push）
//   4. pack 全量发送（不使用 thin pack / delta 编码）
//   5. 仓库数据量超过阈值时提示用户先在桌面端整理或改用同步
// ============================================================

/// Android 推送数据量阈值（pack 字节数）。超过则拒绝推送并提示用户。
#[cfg(target_os = "android")]
const ANDROID_PUSH_PACK_SIZE_LIMIT: usize = 50 * 1024 * 1024; // 50 MB

#[cfg(target_os = "android")]
fn smart_http_push(
    repo: &gix::Repository,
    remote_name: &str,
    username: &str,
    password: &str,
) -> Result<(), AppError> {
    // ---- 1. 读取 remote URL 并校验 HTTPS-only ----
    let remote_url = get_remote_url_from_config(repo, remote_name)?;
    if !remote_url.starts_with("https://") {
        return Err(AppError::Internal(
            "ANDROID_PUSH_HTTPS_ONLY:Android 端仅支持 HTTPS 仓库，不支持 SSH/Git 协议。请先在桌面端配置 HTTPS 仓库地址。".to_string()
        ));
    }

    // ---- 2. 校验 token/PAT-only（拒绝 SSH 私钥）----
    let pw_trim = password.trim();
    if pw_trim.is_empty() {
        return Err(AppError::Internal(
            "ANDROID_PUSH_TOKEN_ONLY:Android 端必须提供 token/PAT，凭据不能为空。".to_string()
        ));
    }
    if pw_trim.starts_with("-----BEGIN")
        || pw_trim.contains("PRIVATE KEY-----")
        || pw_trim.contains("ssh-rsa")
        || pw_trim.contains("ssh-ed25519")
        || pw_trim.contains("ssh-")
    {
        return Err(AppError::Internal(
            "ANDROID_PUSH_TOKEN_ONLY:Android 端仅支持 token/PAT 认证，不支持 SSH 私钥。请先在桌面端使用 token 配置。".to_string()
        ));
    }

    // 派生干净 base url（去掉 URL 中已有的凭据），HTTP 认证走 basic_auth
    let base_url = strip_credentials_from_url(&remote_url);

    // ---- 3. 获取当前分支与本地 HEAD commit OID ----
    let branch_name = get_current_branch(repo)?;
    let local_ref = format!("refs/heads/{}", branch_name);

    let head_commit = repo
        .head_commit()
        .map_err(|e| AppError::Internal(format!("获取 HEAD commit 失败: {}", e)))?;
    let local_oid = head_commit.id;

    // ---- 4. 创建 HTTP 客户端 ----
    let client = reqwest::blocking::Client::builder()
        .build()
        .map_err(|e| AppError::Internal(format!("创建 HTTP 客户端失败: {}", e)))?;

    // ---- 5. GET /info/refs?service=git-receive-pack 获取远程引用 ----
    let info_refs_url = format!(
        "{}/info/refs?service=git-receive-pack",
        base_url.trim_end_matches('/')
    );
    let resp = client
        .get(&info_refs_url)
        .basic_auth(username, Some(password))
        .header("User-Agent", "git/2.0 (notepod-android)")
        .send()
        .map_err(|e| AppError::Internal(format!("连接远程仓库失败: {}", e)))?;

    if !resp.status().is_success() {
        return Err(AppError::Internal(format!(
            "获取远程引用失败: HTTP {}（请检查 token 权限与仓库地址）",
            resp.status()
        )));
    }

    let info_body = resp
        .bytes()
        .map_err(|e| AppError::Internal(format!("读取 info/refs 响应失败: {}", e)))?
        .to_vec();

    // 解析目标分支的远程 OID（None 表示远程分支不存在，即首次 push）
    let remote_oid_opt = parse_info_refs(&info_body, &local_ref)?;

    // ---- 6. fast-forward 校验（远程非空时，远程 commit 必须是本地的祖先）----
    if let Some(remote_oid) = remote_oid_opt {
        if remote_oid != local_oid && !is_ancestor(repo, remote_oid, local_oid)? {
            return Err(AppError::Internal(
                "ANDROID_PUSH_NON_FAST_FORWARD:远程有更新但本地非 fast-forward。请先 pull 同步后再 push（Android 端不支持 force push）。".to_string()
            ));
        }
        // 远程与本地一致，无需 push
        if remote_oid == local_oid {
            return Ok(());
        }
    }

    // ---- 7. 构造全量 pack（不使用 thin pack / delta 编码）----
    let pack_data = create_full_pack_for_push(repo, local_oid)?;

    // ---- 8. 数据量阈值校验 ----
    if pack_data.len() > ANDROID_PUSH_PACK_SIZE_LIMIT {
        return Err(AppError::Internal(format!(
            "ANDROID_PUSH_PACK_TOO_LARGE:推送 pack 大小约 {} MB 超过阈值 ({} MB)。请先在桌面端整理仓库（如 git gc）或改用「同步」功能分批上传。",
            pack_data.len() / 1024 / 1024,
            ANDROID_PUSH_PACK_SIZE_LIMIT / 1024 / 1024
        )));
    }

    // ---- 9. POST /git-receive-pack 发送更新命令 + pack 数据 ----
    let receive_pack_url = format!("{}/git-receive-pack", base_url.trim_end_matches('/'));

    let old_oid_hex = match remote_oid_opt {
        Some(oid) => hex::encode(oid.as_bytes()),
        None => ZERO_OID.to_string(),
    };
    let new_oid_hex = hex::encode(local_oid.as_bytes());

    // command pkt-line: "<old> <new> <ref>\0<capabilities>"
    // 不请求 side-band-64k，简化响应解析
    let command_line = format!(
        "{} {} {}\0report-status",
        old_oid_hex, new_oid_hex, local_ref
    );

    let mut post_body = Vec::with_capacity(64 + pack_data.len());
    write_pkt_line(&mut post_body, command_line.as_bytes());
    post_body.extend_from_slice(b"0000"); // flush packet
    post_body.extend_from_slice(&pack_data);

    let resp = client
        .post(&receive_pack_url)
        .basic_auth(username, Some(password))
        .header("Content-Type", "application/x-git-receive-pack-request")
        .header("Accept", "application/x-git-receive-pack-result")
        .header("User-Agent", "git/2.0 (notepod-android)")
        .body(post_body)
        .send()
        .map_err(|e| AppError::Internal(format!("推送请求失败: {}", e)))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().unwrap_or_default();
        return Err(AppError::Internal(format!(
            "git push 失败: HTTP {} - {}",
            status,
            text.chars().take(500).collect::<String>()
        )));
    }

    let result_body = resp
        .bytes()
        .map_err(|e| AppError::Internal(format!("读取 push 响应失败: {}", e)))?
        .to_vec();

    // ---- 10. 检查 report-status ----
    check_push_result(&result_body)?;

    Ok(())
}

/// 从 HTTPS URL 中剥离可能嵌入的凭据，返回干净的 https://host/path 形式
#[cfg(target_os = "android")]
fn strip_credentials_from_url(url: &str) -> String {
    if let Some(stripped) = url.strip_prefix("https://") {
        if let Some(at_pos) = stripped.find('@') {
            return format!("https://{}", &stripped[at_pos + 1..]);
        }
        return format!("https://{}", stripped);
    }
    url.to_string()
}

/// 解析 info/refs 响应，提取指定 ref 的远程 OID
///
/// 响应为 pkt-line 格式：
/// ```text
/// 001e# service=git-receive-pack\n
/// 0000
/// <oid> <refname>\0<capabilities>\n   (或 <oid> <refname>\n)
/// ...
/// 0000
/// ```
#[cfg(target_os = "android")]
fn parse_info_refs(
    body: &[u8],
    target_ref: &str,
) -> Result<Option<gix::hash::ObjectId>, AppError> {
    let mut pos = 0;
    let target_bytes = target_ref.as_bytes();

    while pos + 4 <= body.len() {
        let len_str = std::str::from_utf8(&body[pos..pos + 4])
            .map_err(|e| AppError::Internal(format!("解析 pkt-line 长度失败: {}", e)))?;
        let len = u16::from_str_radix(len_str, 16)
            .map_err(|e| AppError::Internal(format!("解析 pkt-line 长度失败: {}", e)))? as usize;
        if len == 0 {
            // flush packet
            pos += 4;
            continue;
        }
        if len < 4 || pos + len > body.len() {
            break;
        }
        let line = &body[pos + 4..pos + len];
        pos += len;

        // line 格式: "<40-hex-oid> <refname>\0<caps>" 或 "<40-hex-oid> <refname>"
        let line_str = std::str::from_utf8(line).unwrap_or("");
        let parts: Vec<&str> = line_str.splitn(2, ' ').collect();
        if parts.len() != 2 {
            continue;
        }
        let oid_hex = parts[0];
        let rest = parts[1];

        // 跳过非 40-hex 开头的行（如 "# service=..."）
        if oid_hex.len() != 40 || !oid_hex.chars().all(|c| c.is_ascii_hexdigit()) {
            continue;
        }

        // 截断到 \0 或 \n
        let ref_end = rest
            .find(|c: char| c == '\0' || c == '\n')
            .unwrap_or(rest.len());
        let ref_name = &rest[..ref_end];

        if ref_name.as_bytes() == target_bytes {
            let oid_bytes = hex::decode(oid_hex)
                .map_err(|e| AppError::Internal(format!("解析 OID 失败: {}", e)))?;
            if oid_bytes.len() != 20 {
                return Err(AppError::Internal(format!(
                    "OID 长度错误: 期望 20 字节，实际 {} 字节",
                    oid_bytes.len()
                )));
            }
            let oid = gix::hash::ObjectId::try_from(&oid_bytes[..])
                .map_err(|e| AppError::Internal(format!("构造 ObjectId 失败: {}", e)))?;
            return Ok(Some(oid));
        }
    }
    Ok(None)
}

/// 检查 `ancestor` 是否是 `descendant` 的祖先 commit（用于 fast-forward 校验）
#[cfg(target_os = "android")]
fn is_ancestor(
    repo: &gix::Repository,
    ancestor: gix::hash::ObjectId,
    descendant: gix::hash::ObjectId,
) -> Result<bool, AppError> {
    if ancestor == descendant {
        return Ok(true);
    }

    let mut visited = std::collections::HashSet::new();
    let mut stack = vec![descendant];

    while let Some(current) = stack.pop() {
        if !visited.insert(current) {
            continue;
        }
        if current == ancestor {
            return Ok(true);
        }

        let commit = match repo.find_commit(current) {
            Ok(c) => c,
            Err(_) => {
                // 远程 commit 本地不存在，无法判定，保守拒绝以避免非 ff 覆盖
                return Err(AppError::Internal(
                    "ANDROID_PUSH_NON_FAST_FORWARD:无法在本地找到远程 commit（请先 pull 同步后再 push）。".to_string()
                ));
            }
        };
        for parent_id in commit.parent_ids() {
            stack.push(parent_id.detach());
        }
    }

    Ok(false)
}

/// 构造 Git pack 文件（全量，不使用 delta 编码）
///
/// 枚举从 `local_oid` 可达的所有 commit / tree / blob 对象，
/// 按 Git pack v2 格式打包：
/// `PACK` + version(4 BE) + count(4 BE) + objects + sha1_trailer(20)
#[cfg(target_os = "android")]
fn create_full_pack_for_push(
    repo: &gix::Repository,
    local_oid: gix::hash::ObjectId,
) -> Result<Vec<u8>, AppError> {
    use std::io::Write;
    use flate2::write::ZlibEncoder;
    use flate2::Compression;
    use sha1::{Digest, Sha1};

    // ---- 枚举所有可达对象 ----
    let mut object_oids: std::collections::HashSet<gix::hash::ObjectId> =
        std::collections::HashSet::new();
    let mut stack: Vec<gix::hash::ObjectId> = vec![local_oid];

    while let Some(oid) = stack.pop() {
        if !object_oids.insert(oid) {
            continue;
        }
        let obj = repo
            .find_object(oid)
            .map_err(|e| AppError::Internal(format!("查找对象 {} 失败: {}", oid, e)))?;
        match obj.kind {
            gix::object::Kind::Commit => {
                let commit = obj
                    .try_into_commit()
                    .map_err(|e| AppError::Internal(format!("转换 commit 失败: {}", e)))?;
                stack.push(commit.tree_id()
                    .map_err(|e| AppError::Internal(format!("获取 tree_id 失败: {}", e)))?
                    .detach());
                for parent_id in commit.parent_ids() {
                    stack.push(parent_id.detach());
                }
            }
            gix::object::Kind::Tree => {
                let tree = obj
                    .try_into_tree()
                    .map_err(|e| AppError::Internal(format!("转换 tree 失败: {}", e)))?;
                for entry in tree.iter() {
                    let entry = entry.map_err(|e| AppError::Internal(format!("遍历 tree 失败: {}", e)))?;
                    stack.push(entry.oid().to_owned());
                }
            }
            _ => {} // Blob / Tag 为叶子对象
        }
    }

    // ---- 构造 pack 文件 ----
    let mut pack: Vec<u8> = Vec::new();
    pack.extend_from_slice(b"PACK");
    pack.extend_from_slice(&2u32.to_be_bytes()); // version 2
    pack.extend_from_slice(&(object_oids.len() as u32).to_be_bytes());

    let mut hasher = Sha1::new();
    hasher.update(&pack);

    for oid in &object_oids {
        let obj = repo
            .find_object(*oid)
            .map_err(|e| AppError::Internal(format!("查找对象 {} 失败: {}", oid, e)))?;

        let kind_byte: u8 = match obj.kind {
            gix::object::Kind::Commit => 1,
            gix::object::Kind::Tree => 2,
            gix::object::Kind::Blob => 3,
            gix::object::Kind::Tag => 4,
        };
        let data = &obj.data;
        let size = data.len() as u64;

        // 变长 type+size 头：第一字节最高位=continuation, 接下来 3 bit=type, 4 bit=size低位
        let mut first_byte: u8 = 0x80 | (kind_byte << 4) | (size & 0x0f) as u8;
        let mut remaining = size >> 4;
        if remaining == 0 {
            first_byte &= 0x7f; // 清除 continuation 位
        }
        let mut header = vec![first_byte];
        while remaining > 0 {
            let mut next_byte: u8 = (remaining & 0x7f) as u8;
            remaining >>= 7;
            if remaining > 0 {
                next_byte |= 0x80;
            }
            header.push(next_byte);
        }

        // zlib 压缩对象数据
        let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
        encoder
            .write_all(data)
            .map_err(|e| AppError::Internal(format!("压缩对象失败: {}", e)))?;
        let compressed = encoder
            .finish()
            .map_err(|e| AppError::Internal(format!("压缩完成失败: {}", e)))?;

        pack.extend_from_slice(&header);
        pack.extend_from_slice(&compressed);
        hasher.update(&header);
        hasher.update(&compressed);
    }

    // SHA-1 trailer
    let hash_result = hasher.finalize();
    pack.extend_from_slice(&hash_result);

    Ok(pack)
}

/// 写入一个 pkt-line：4 字节 hex 长度（含长度字段自身）+ 数据
#[cfg(target_os = "android")]
fn write_pkt_line(buf: &mut Vec<u8>, data: &[u8]) {
    let total_len = data.len() + 4;
    debug_assert!(total_len <= 0xffff);
    buf.extend_from_slice(format!("{:04x}", total_len).as_bytes());
    buf.extend_from_slice(data);
}

/// 检查 receive-pack 的 report-status 响应
///
/// 期望格式：
/// ```text
/// <len>unpack ok\n          (或 unpack <error>)
/// <len>ok <ref>\n           (或 ng <ref> <error>)
/// 0000
/// ```
#[cfg(target_os = "android")]
fn check_push_result(body: &[u8]) -> Result<(), AppError> {
    let mut pos = 0;
    let mut unpack_ok = false;

    while pos + 4 <= body.len() {
        let len_str = std::str::from_utf8(&body[pos..pos + 4])
            .map_err(|e| AppError::Internal(format!("解析 push 响应失败: {}", e)))?;
        let len = u16::from_str_radix(len_str, 16)
            .map_err(|e| AppError::Internal(format!("解析 push 响应失败: {}", e)))? as usize;
        if len == 0 {
            // flush packet
            pos += 4;
            continue;
        }
        if len < 4 || pos + len > body.len() {
            break;
        }
        let line = &body[pos + 4..pos + len];
        pos += len;

        let line_str = std::str::from_utf8(line).unwrap_or("").trim_end();
        if line_str == "unpack ok" {
            unpack_ok = true;
        } else if let Some(err) = line_str.strip_prefix("unpack ") {
            return Err(AppError::Internal(format!(
                "服务器拒绝 pack: {}",
                err
            )));
        } else if let Some(err) = line_str.strip_prefix("ng ") {
            return Err(AppError::Internal(format!(
                "推送被拒: {}",
                err
            )));
        }
        // "ok <ref>" 行忽略
    }

    if !unpack_ok {
        return Err(AppError::Internal(
            "推送失败：未收到 unpack ok（服务器可能未启用 receive-pack）".to_string()
        ));
    }

    Ok(())
}
