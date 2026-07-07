import { useState } from 'react';
import { api, LockConfigInfo } from '../../lib/tauri';
import { useEncStore } from '../../stores/encStore';

interface LockOverlayProps {
  lockConfig: LockConfigInfo | null;
  onUnlock: () => void;
  onOpenSettings: () => void;
  hideSettings?: boolean;
}

export function LockOverlay({ lockConfig, onUnlock, onOpenSettings, hideSettings = false }: LockOverlayProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);
  const [loading, setLoading] = useState(false);

  const { checkEncStatus } = useEncStore();

  // 单密码方案：一次 verifyLockPassword 同时完成锁屏验证 + 加密解锁
  const handleUnlock = async () => {
    setError('');
    if (!password.trim()) {
      setError('请输入密码');
      return;
    }

    setLoading(true);
    try {
      // 一次调用完成：密码验证 + MK 解包 + 存入内存
      const isValid = await api.verifyLockPassword(password);
      if (isValid) {
        // 更新加密状态（MK 已在内存中）
        await checkEncStatus();
        finishUnlock();
      } else {
        setError('密码错误');
        setPassword('');
        setShake(true);
        setTimeout(() => setShake(false), 500);
        setLoading(false);
      }
    } catch (e) {
      setError(`验证失败: ${e}`);
      setLoading(false);
    }
  };

  const finishUnlock = () => {
    setPassword('');
    setError('');
    setLoading(false);
    onUnlock();
  };

  // 标准锁屏界面
  return (
    <div
      className="fixed inset-0 z-[10000] flex flex-col items-center justify-center"
      style={{
        background: 'var(--color-bg-primary)',
        animation: 'fadeIn 0.3s ease',
      }}
    >
      <div className="mb-8">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none"
          stroke="var(--color-text-muted)" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>

      <div className="text-2xl font-bold text-text-primary mb-2">NotePod 已锁定</div>

      {lockConfig?.hint && (
        <div className="text-sm text-text-muted mb-8">
          提示: {lockConfig.hint}
        </div>
      )}

      <div className={`w-64 ${shake ? 'animate-shake' : ''}`}
        style={{ animation: shake ? 'shake 0.5s ease' : undefined }}>
        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter') handleUnlock(); }}
          placeholder="输入密码解锁"
          autoFocus
          className="w-full text-center text-lg px-4 py-3 rounded-xl outline-none transition-all"
          style={{
            background: 'var(--color-bg-input)',
            border: error ? '1px solid #FF3B30' : '1px solid var(--color-border-strong)',
            color: 'var(--color-text-primary)',
          }}
        />

        {error && (
          <div className="mt-3 text-sm text-center" style={{ color: '#FF3B30' }}>
            {error}
          </div>
        )}

        <button
          onClick={handleUnlock}
          disabled={loading}
          className="w-full mt-4 py-3 rounded-xl text-sm font-semibold text-white bg-accent hover:bg-accent-hover transition-colors"
          style={{ opacity: loading ? 0.6 : 1 }}
        >
          {loading ? '验证中...' : '解锁'}
        </button>

        {!hideSettings && (
          <button
            onClick={onOpenSettings}
            className="w-full mt-2 py-2.5 rounded-xl text-sm font-medium text-text-secondary hover:bg-bg-sidebar-hover transition-colors"
            style={{ border: '1px solid var(--color-border)' }}
          >
            密码设置
          </button>
        )}
      </div>
    </div>
  );
}
