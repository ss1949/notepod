import { useState, useEffect } from "react";
import { api, GitConfig, GitSyncResult } from "../../lib/tauri";
import { useEncStore } from "../../stores/encStore";

interface GitBackupModalProps {
  open: boolean;
  onClose: () => void;
  onSyncComplete?: () => void; // 同步/备份成功后通知父组件刷新数据
}

export function GitBackupModal({ open, onClose, onSyncComplete }: GitBackupModalProps) {
  const [config, setConfig] = useState<GitConfig>({
    repo_url: "",
    username: "",
    credential: "",
    author_name: "",
    author_email: "",
    last_sync_at: undefined,
  });
  const [loading, setLoading] = useState<"backup" | "sync" | "save" | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [showRecovery, setShowRecovery] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryLoading, setRecoveryLoading] = useState(false);
  const [needEncConfigSync, setNeedEncConfigSync] = useState(false); // 加密配置不一致标记
  const [localHasData, setLocalHasData] = useState(true); // 本地是否有数据

  const { hasEncryptionConfig, isEncryptionEnabled, setEncryptionUnlocked, checkEncStatus } = useEncStore();

  useEffect(() => {
    if (open) {
      loadConfig();
      setShowRecovery(false);
      setRecoveryPassword("");
      setNeedEncConfigSync(false);
      checkLocalData();
    }
  }, [open]);

  // 检查本地是否有数据
  const checkLocalData = async () => {
    try {
      const notes = await api.listNotesSummary();
      const journals = await api.listDailyNotes();
      setLocalHasData(notes.length > 0 || journals.length > 0);
    } catch {
      setLocalHasData(false);
    }
  };

  const loadConfig = async () => {
    try {
      const saved = await api.getGitConfig();
      if (saved) {
        setConfig({
          ...saved,
          author_name: saved.author_name || "",
          author_email: saved.author_email || "",
        });
        setShowConfig(false);
      } else {
        setShowConfig(true);
      }
    } catch (e) {
      const errMsg = String(e);
      // Android 不支持 git 命令，静默忽略
      if (errMsg.includes("not found")) {
        console.warn("Git 功能在此平台不可用");
        return;
      }
      console.error("加载 Git 配置失败:", e);
      if (errMsg.includes("加密") || errMsg.includes("解锁")) {
        setMessage({ type: "error", text: "Git 凭据已加密，请先解锁加密" });
        setShowRecovery(true);
      } else {
        setMessage({ type: "error", text: `加载配置失败: ${errMsg}` });
      }
      setShowConfig(true);
    }
  };

  const handleSaveConfig = async () => {
    if (!config.repo_url || !config.username || !config.credential) {
      setMessage({ type: "error", text: "请填写仓库地址、用户名和密钥" });
      return;
    }

    setLoading("save");
    try {
      const result = await api.saveGitConfig(config);
      setMessage({ type: "success", text: "配置保存成功" });
      setShowConfig(false);

      // 如果远程仓库有加密配置，提示用户恢复
      if (result.has_encryption) {
        setMessage({ type: "success", text: "检测到加密的备份数据，请输入密码以恢复" });
        setShowRecovery(true);
      }
    } catch (e) {
      setMessage({ type: "error", text: `保存失败: ${e}` });
    } finally {
      setLoading(null);
    }
  };

  const handleBackup = async () => {
    if (!isEncryptionEnabled && hasEncryptionConfig) {
      setMessage({ type: "error", text: "请先解锁密码后再执行备份" });
      setShowRecovery(true);
      return;
    }
    setLoading("backup");
    setMessage(null);
    try {
      const result: GitSyncResult = await api.gitBackup();
      if (result.success) {
        setMessage({ type: "success", text: result.message });
        if (result.synced_at) {
          setConfig((prev) => ({ ...prev, last_sync_at: result.synced_at }));
        }
        onSyncComplete?.();
      } else {
        setMessage({ type: "error", text: result.message });
      }
    } catch (e) {
      const errMsg = String(e);
      // 检测 key.json 加密配置不一致错误
      if (errMsg.includes("KEY_JSON_MISMATCH")) {
        setNeedEncConfigSync(true);
        setMessage({ type: "error", text: "检测到 Git 仓库有加密配置，请输入密码以同步并覆盖本地锁定密码" });
        setShowRecovery(true);
      } else {
        setMessage({ type: "error", text: `备份失败: ${errMsg}` });
        // 如果错误和加密有关，显示恢复入口
        if (errMsg.includes("加密") || errMsg.includes("密码")) {
          setShowRecovery(true);
        }
      }
    } finally {
      setLoading(null);
    }
  };

  const handleSync = async () => {
    if (!isEncryptionEnabled && hasEncryptionConfig) {
      setMessage({ type: "error", text: "请先解锁密码后再执行同步" });
      setShowRecovery(true);
      return;
    }
    setLoading("sync");
    setMessage(null);
    try {
      const result: GitSyncResult = await api.gitSync();
      if (result.success) {
        setMessage({ type: "success", text: result.message });
        if (result.synced_at) {
          setConfig((prev) => ({ ...prev, last_sync_at: result.synced_at }));
        }
        onSyncComplete?.();
      } else {
        setMessage({ type: "error", text: result.message });
      }
    } catch (e) {
      const errMsg = String(e);
      // 检测 key.json 加密配置不一致错误
      if (errMsg.includes("KEY_JSON_MISMATCH")) {
        setNeedEncConfigSync(true);
        setMessage({ type: "error", text: "检测到 Git 仓库有加密配置，请输入密码以同步并覆盖本地锁定密码" });
        setShowRecovery(true);
      } else {
        setMessage({ type: "error", text: `同步失败: ${errMsg}` });
        // 如果错误和密钥/加密有关，显示恢复入口
        if (errMsg.includes("加密") || errMsg.includes("密钥") || errMsg.includes("密码")) {
          setShowRecovery(true);
        }
      }
    } finally {
      setLoading(null);
    }
  };

  // 加密恢复流程
  // 三种场景：
  // 1. 加密配置不一致（needEncConfigSync）：从 Git 仓库 key.json 更新本地配置
  // 2. 新电脑（无本地加密配置）：从 Git 仓库 key.json 恢复
  // 3. 已有本地加密配置：用 verifyLockPassword 解锁
  const handleRecovery = async () => {
    if (!recoveryPassword.trim()) {
      setMessage({ type: "error", text: "请输入密码" });
      return;
    }
    setRecoveryLoading(true);
    setMessage(null);
    try {
      if (needEncConfigSync || !hasEncryptionConfig) {
        // 场景 1 或 2：从 Git 仓库的 key.json 恢复/更新加密配置
        await api.restoreEncFromGit(recoveryPassword);
        setEncryptionUnlocked(true);
        await checkEncStatus(); // 刷新加密状态
        setNeedEncConfigSync(false);
        setMessage({ type: "success", text: "加密配置同步成功！正在同步数据..." });
        setShowRecovery(false);
        setRecoveryPassword("");
        // 自动重试同步
        setLoading("sync");
        const result: GitSyncResult = await api.gitSync();
        if (result.success) {
          setMessage({ type: "success", text: result.message });
          if (result.synced_at) {
            setConfig((prev) => ({ ...prev, last_sync_at: result.synced_at }));
          }
        }
      } else {
        // 场景 3：已有本地加密配置且一致，直接验证解锁
        const ok = await api.verifyLockPassword(recoveryPassword);
        if (ok) {
          setEncryptionUnlocked(true);
          setMessage({ type: "success", text: "解锁成功！正在同步..." });
          setShowRecovery(false);
          setRecoveryPassword("");
          // 自动重试同步
          setLoading("sync");
          const result: GitSyncResult = await api.gitSync();
          if (result.success) {
            setMessage({ type: "success", text: result.message });
            if (result.synced_at) {
              setConfig((prev) => ({ ...prev, last_sync_at: result.synced_at }));
            }
          }
        } else {
          setMessage({ type: "error", text: "密码错误，无法解锁" });
        }
      }
    } catch (e) {
      setMessage({ type: "error", text: `恢复失败: ${e}` });
    } finally {
      setRecoveryLoading(false);
      setLoading(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center backdrop-blur-sm"
      style={{ background: "rgba(0,0,0,0.25)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="rounded-xl overflow-hidden shadow-2xl w-[92vw] max-w-md"
        style={{
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.22), 0 6px 16px rgba(0,0,0,0.12)",
          animation: "appleModalFadeIn 0.18s ease",
        }}
      >
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--color-border)" }}>
          <h2 className="text-sm font-semibold text-text-primary">Git 备份同步</h2>
          <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded-md text-text-secondary hover:bg-bg-sidebar-hover hover:text-text-primary transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="flex flex-col gap-4 px-5 py-4">
          {!showConfig && config.last_sync_at && (
            <div className="text-xs text-text-secondary">
              上次同步: {new Date(config.last_sync_at).toLocaleString("zh-CN")}
            </div>
          )}

          {/* 加密恢复弹窗 */}
          {showRecovery && (
            <div className="flex flex-col gap-3 p-3 rounded-lg" style={{
              background: "var(--color-bg-info, #E6F1FB)",
              border: "1px solid var(--color-border)",
            }}>
              <div className="text-xs font-medium">
                {needEncConfigSync ? "检测到 Git 仓库加密配置(key.json)" : "检测到加密的备份数据"}
              </div>
              <div className="text-xs text-text-muted">
                {needEncConfigSync
                  ? "输入密码以验证 key.json，验证成功后将同步加密配置并覆盖本地锁定密码"
                  : "输入密码以解锁加密的 Git 仓库笔记"}
              </div>
              <input
                type="password"
                value={recoveryPassword}
                onChange={(e) => setRecoveryPassword(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleRecovery(); }}
                placeholder="输入密码"
                className="w-full px-3 py-2 text-sm rounded-md border border-border bg-bg-input text-text-primary focus:outline-none"
                autoFocus
              />
              <button
                onClick={handleRecovery}
                disabled={recoveryLoading}
                className="w-full py-2 text-sm font-medium text-white bg-accent rounded-md transition-colors disabled:opacity-50"
              >
                {recoveryLoading ? "解锁中..." : "解锁并恢复"}
              </button>
            </div>
          )}

          {showConfig ? (
            <>
              <div className="flex flex-col gap-3">
                <div>
                  <label className="text-xs font-medium text-text-primary mb-1 block">Git 仓库地址</label>
                  <input type="text" value={config.repo_url} onChange={(e) => setConfig({ ...config, repo_url: e.target.value })}
                    placeholder="https://github.com/user/repo.git"
                    className="w-full px-3 py-2 text-sm rounded-md border border-border bg-bg-input text-text-primary focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div>
                  <label className="text-xs font-medium text-text-primary mb-1 block">用户名</label>
                  <input type="text" value={config.username} onChange={(e) => setConfig({ ...config, username: e.target.value })}
                    placeholder="your-username"
                    className="w-full px-3 py-2 text-sm rounded-md border border-border bg-bg-input text-text-primary focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div>
                  <label className="text-xs font-medium text-text-primary mb-1 block">密钥 / Token</label>
                  <input type="password" value={config.credential} onChange={(e) => setConfig({ ...config, credential: e.target.value })}
                    placeholder="ghp_xxxx 或 SSH 私钥"
                    className="w-full px-3 py-2 text-sm rounded-md border border-border bg-bg-input text-text-primary focus:outline-none focus:ring-2 focus:ring-accent" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-medium text-text-primary mb-1 block">作者名称 (可选)</label>
                    <input type="text" value={config.author_name} onChange={(e) => setConfig({ ...config, author_name: e.target.value })}
                      placeholder="Your Name"
                      className="w-full px-3 py-2 text-sm rounded-md border border-border bg-bg-input text-text-primary focus:outline-none focus:ring-2 focus:ring-accent" />
                  </div>
                  <div>
                    <label className="text-xs font-medium text-text-primary mb-1 block">作者邮箱 (可选)</label>
                    <input type="email" value={config.author_email} onChange={(e) => setConfig({ ...config, author_email: e.target.value })}
                      placeholder="you@example.com"
                      className="w-full px-3 py-2 text-sm rounded-md border border-border bg-bg-input text-text-primary focus:outline-none focus:ring-2 focus:ring-accent" />
                  </div>
                </div>
              </div>
              <button onClick={handleSaveConfig} disabled={loading !== null}
                className="w-full py-2 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {loading === "save" ? "保存中..." : "保存配置"}
              </button>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {localHasData && (
                  <button onClick={handleBackup} disabled={loading !== null}
                    className="w-full py-2.5 text-sm font-medium text-white bg-accent hover:bg-accent-hover rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {loading === "backup" ? (
                      <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>备份中...</>
                    ) : (<><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>备份（上传）</>)}
                  </button>
                )}
                <button onClick={handleSync} disabled={loading !== null}
                  className="w-full py-2.5 text-sm font-medium text-text-primary bg-bg-sidebar-hover hover:bg-bg-sidebar-active rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                  {loading === "sync" ? (
                    <><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>同步中...</>
                  ) : (<><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>更新（拉取并同步）</>)}
                </button>
                <button onClick={() => setShowConfig(true)}
                  className="w-full py-2 text-xs font-medium text-text-secondary hover:text-text-primary transition-colors">
                  修改配置
                </button>
              </div>
            </>
          )}

          {/* 非恢复模式下显示加密状态 */}
          {!showRecovery && hasEncryptionConfig && (
            <div className="text-xs text-text-muted flex items-center gap-1">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={isEncryptionEnabled ? "#34C759" : "#FF9500"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d={isEncryptionEnabled ? "M7 11V7a5 5 0 0 1 10 0v4" : "M7 11V7a5 5 0 0 1 8.32-2.68"}/>
              </svg>
              {isEncryptionEnabled ? "已解锁" : "未解锁"}
            </div>
          )}

          {message && (
            <div className={`text-xs px-3 py-2 rounded-md ${
              message.type === "success"
                ? "bg-green-500/10 text-green-600 dark:text-green-400"
                : "bg-red-500/10 text-red-600 dark:text-red-400"
            }`}>
              {message.text}
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes appleModalFadeIn {
          0% { opacity: 0; transform: scale(0.96); }
          100% { opacity: 1; transform: scale(1); }
        }
      `}</style>
    </div>
  );
}
