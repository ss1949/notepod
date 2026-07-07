import { useState, useEffect } from 'react';
import { api, LockConfigInfo } from '../../lib/tauri';
import { useEncStore } from '../../stores/encStore';

interface LockScreenModalProps {
  open: boolean;
  onClose: () => void;
}

type ModalMode = 'unlock' | 'setup' | 'manage' | 'change';

export function LockScreenModal({ open, onClose }: LockScreenModalProps) {
  const [mode, setMode] = useState<ModalMode>('unlock');
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [hint, setHint] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [lockConfig, setLockConfig] = useState<LockConfigInfo | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const { isEncryptionEnabled, checkEncStatus } = useEncStore();

  useEffect(() => {
    if (open) {
      loadLockConfig();
    }
  }, [open]);

  const loadLockConfig = async () => {
    try {
      const config = await api.getLockConfig();
      setLockConfig(config);
      if (config?.has_password) {
        // 单密码方案：加密已解锁 = 锁屏已验证
        if (isEncryptionEnabled) {
          setMode('manage');
        } else {
          setMode('unlock');
        }
      } else {
        setMode('setup');
      }
    } catch (e) {
      console.error('Failed to load lock config:', e);
    }
  };

  const resetForm = () => {
    setOldPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setHint('');
    setError('');
    setSuccess('');
    setShowPassword(false);
  };

  // 首次设置密码（同时启用加密）
  const handleSetup = async () => {
    setError('');
    setSuccess('');
    if (!newPassword.trim()) {
      setError('请输入密码');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }
    if (!hint.trim()) {
      setError('请输入密码提示');
      return;
    }

    try {
      // set_lock_password 同时生成 MK + 包裹 + 批量加密笔记
      await api.setLockPassword(newPassword, hint);
      await checkEncStatus();
      setSuccess('密码设置成功，已启用加密');
      resetForm();
      await loadLockConfig();
      setMode('manage');
    } catch (e) {
      setError(`设置失败: ${e}`);
    }
  };

  // 解锁（单密码方案：一次调用完成验证 + 加密解锁）
  const handleUnlock = async () => {
    setError('');
    setSuccess('');
    if (!oldPassword.trim()) {
      setError('请输入密码');
      return;
    }

    try {
      const isValid = await api.verifyLockPassword(oldPassword);
      if (isValid) {
        await checkEncStatus();
        setSuccess('解锁成功');
        setMode('manage');
        setOldPassword('');
        setError('');
      } else {
        setError('密码错误');
        setOldPassword('');
      }
    } catch (e) {
      setError(`验证失败: ${e}`);
    }
  };

  // 修改密码（需要验证旧密码，MK 不变，只需重新包裹）
  const handleChangePassword = async () => {
    setError('');
    setSuccess('');
    if (!oldPassword.trim()) {
      setError('请输入原密码');
      return;
    }
    if (!newPassword.trim()) {
      setError('请输入新密码');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    if (!hint.trim()) {
      setError('请输入密码提示');
      return;
    }

    try {
      // change_lock_password：用旧密码解包 MK，用新密码重新包裹
      await api.changeLockPassword(oldPassword, newPassword, hint);
      await checkEncStatus();
      setSuccess('密码修改成功');
      resetForm();
      await loadLockConfig();
      setMode('manage');
    } catch (e) {
      setError(`修改失败: ${e}`);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[10001] flex items-center justify-center"
      style={{
        background: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          resetForm();
          onClose();
        }
      }}
    >
      <div
        className="rounded-2xl min-w-80 max-w-md w-full mx-4"
        style={{
          background: 'var(--color-bg-primary)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.3)',
          animation: 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div
          className="px-6 py-4 flex items-center justify-between"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <span className="text-[15px] font-semibold text-text-primary">
            {mode === 'unlock' && '输入密码解锁'}
            {mode === 'setup' && '设置密码'}
            {mode === 'manage' && '密码管理'}
            {mode === 'change' && '修改密码'}
          </span>
          <button
            onClick={() => {
              resetForm();
              onClose();
            }}
            className="w-7 h-7 flex items-center justify-center rounded-full text-text-muted hover:bg-bg-sidebar-hover transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* 内容区 */}
        <div className="px-6 py-5">
          {/* 提示 */}
          {lockConfig?.hint && mode === 'unlock' && (
            <div className="text-center text-sm text-text-muted mb-4">
              提示: {lockConfig.hint}
            </div>
          )}

          {/* 错误提示 */}
          {error && (
            <div
              className="mb-4 px-4 py-2.5 rounded-lg text-sm text-center"
              style={{
                background: 'rgba(255, 59, 48, 0.1)',
                color: '#FF3B30',
                border: '1px solid rgba(255, 59, 48, 0.2)',
              }}
            >
              {error}
            </div>
          )}

          {/* 成功提示 */}
          {success && (
            <div
              className="mb-4 px-4 py-2.5 rounded-lg text-sm text-center"
              style={{
                background: 'rgba(52, 199, 89, 0.1)',
                color: '#34C759',
                border: '1px solid rgba(52, 199, 89, 0.2)',
              }}
            >
              {success}
            </div>
          )}

          {/* 解锁模式：只需输入密码 */}
          {mode === 'unlock' && (
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={oldPassword}
                onChange={(e) => {
                  setOldPassword(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleUnlock();
                }}
                placeholder="输入密码"
                autoFocus
                className="w-full text-sm px-4 py-3 rounded-lg outline-none transition-colors pr-10"
                style={{
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--color-border-strong)',
                  color: 'var(--color-text-primary)',
                }}
              />
              <button
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors"
                type="button"
              >
                {showPassword ? (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          )}

          {/* 设置密码模式 */}
          {mode === 'setup' && (
            <div className="space-y-3">
              <p className="text-xs text-text-muted">
                设置密码后将同时启用笔记加密，所有笔记内容会被加密保护。
              </p>
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSetup();
                }}
                placeholder="设置密码"
                autoFocus
                className="w-full text-sm px-4 py-3 rounded-lg outline-none transition-colors"
                style={{
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--color-border-strong)',
                  color: 'var(--color-text-primary)',
                }}
              />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSetup();
                }}
                placeholder="确认密码"
                className="w-full text-sm px-4 py-3 rounded-lg outline-none transition-colors"
                style={{
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--color-border-strong)',
                  color: 'var(--color-text-primary)',
                }}
              />
              <input
                type="text"
                value={hint}
                onChange={(e) => {
                  setHint(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSetup();
                }}
                placeholder="密码提示（必填）"
                className="w-full text-sm px-4 py-3 rounded-lg outline-none transition-colors"
                style={{
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--color-border-strong)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>
          )}

          {/* 管理界面：显示操作选项 */}
          {mode === 'manage' && (
            <div className="space-y-2">
              <button
                onClick={() => {
                  resetForm();
                  setMode('change');
                }}
                className="w-full px-4 py-3 rounded-lg text-sm font-medium text-text-primary hover:bg-bg-sidebar-hover transition-colors text-left flex items-center gap-3"
                style={{ border: '1px solid var(--color-border)' }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                <div>
                  <div className="font-medium">修改密码</div>
                  <div className="text-xs text-text-muted mt-0.5">需要验证原密码</div>
                </div>
              </button>
            </div>
          )}

          {/* 修改密码模式 */}
          {mode === 'change' && (
            <div className="space-y-3">
              <input
                type={showPassword ? 'text' : 'password'}
                value={oldPassword}
                onChange={(e) => {
                  setOldPassword(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleChangePassword();
                }}
                placeholder="输入原密码"
                autoFocus
                className="w-full text-sm px-4 py-3 rounded-lg outline-none transition-colors"
                style={{
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--color-border-strong)',
                  color: 'var(--color-text-primary)',
                }}
              />
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleChangePassword();
                }}
                placeholder="输入新密码"
                className="w-full text-sm px-4 py-3 rounded-lg outline-none transition-colors"
                style={{
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--color-border-strong)',
                  color: 'var(--color-text-primary)',
                }}
              />
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleChangePassword();
                }}
                placeholder="确认新密码"
                className="w-full text-sm px-4 py-3 rounded-lg outline-none transition-colors"
                style={{
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--color-border-strong)',
                  color: 'var(--color-text-primary)',
                }}
              />
              <input
                type="text"
                value={hint}
                onChange={(e) => {
                  setHint(e.target.value);
                  setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleChangePassword();
                }}
                placeholder={`密码提示（留空则保留: ${lockConfig?.hint || ''}）`}
                className="w-full text-sm px-4 py-3 rounded-lg outline-none transition-colors"
                style={{
                  background: 'var(--color-bg-input)',
                  border: '1px solid var(--color-border-strong)',
                  color: 'var(--color-text-primary)',
                }}
              />
            </div>
          )}
        </div>

        {/* 按钮区 */}
        <div
          className="px-6 py-4 flex gap-2"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          {/* 解锁模式：只有取消和解锁 */}
          {mode === 'unlock' && (
            <>
              <button
                onClick={() => {
                  resetForm();
                  onClose();
                }}
                className="flex-1 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:bg-bg-sidebar-hover transition-colors"
                style={{ border: '1px solid var(--color-border)' }}
              >
                取消
              </button>
              <button
                onClick={handleUnlock}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
                style={{ background: 'var(--color-accent)' }}
              >
                解锁
              </button>
            </>
          )}

          {/* 设置模式：只有设置 */}
          {mode === 'setup' && (
            <button
              onClick={handleSetup}
              className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
              style={{ background: 'var(--color-accent)' }}
            >
              设置密码
            </button>
          )}

          {/* 管理界面：返回按钮 */}
          {mode === 'manage' && (
            <button
              onClick={() => {
                resetForm();
                onClose();
              }}
              className="flex-1 py-2.5 rounded-lg text-sm font-medium text-text-secondary hover:bg-bg-sidebar-hover transition-colors"
              style={{ border: '1px solid var(--color-border)' }}
            >
              关闭
            </button>
          )}

          {/* 修改密码模式：返回 + 修改 */}
          {mode === 'change' && (
            <>
              <button
                onClick={() => {
                  resetForm();
                  setMode('manage');
                }}
                className="py-2.5 px-4 rounded-lg text-sm font-medium text-text-secondary hover:bg-bg-sidebar-hover transition-colors"
                style={{ border: '1px solid var(--color-border)' }}
              >
                返回
              </button>
              <button
                onClick={handleChangePassword}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
                style={{ background: 'var(--color-accent)' }}
              >
                确认修改
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
