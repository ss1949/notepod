import { useState } from "react";
import { api } from "../../lib/tauri";
import { useEncStore } from "../../stores/encStore";

interface Props {
  onComplete: () => void;
  onSkip: () => void;
}

export function EncryptionWizard({ onComplete, onSkip }: Props) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [hint, setHint] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { setShowEncWizard, checkEncStatus } = useEncStore();

  // 单密码方案：设置密码 = 同时启用锁屏 + 加密
  const handleFinish = async () => {
    setError("");

    if (password.length < 4) {
      setError("密码长度至少 4 位");
      return;
    }
    if (password !== confirm) {
      setError("两次输入的密码不一致");
      return;
    }
    if (!hint) {
      setError("请输入密码提示");
      return;
    }

    setLoading(true);
    try {
      // set_lock_password 同时：生成 MK + 包裹 + 批量加密笔记
      await api.setLockPassword(password, hint);
      await checkEncStatus();
      setShowEncWizard(false);
      onComplete();
    } catch (e: any) {
      setError(e?.toString() || "保存失败");
    } finally {
      setLoading(false);
    }
  };

  // 跳过：不设置密码，不启用加密
  const handleSkip = () => {
    setShowEncWizard(false);
    onSkip();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      display: "flex", alignItems: "center", justifyContent: "center",
      backgroundColor: "rgba(0,0,0,0.5)",
      backdropFilter: "blur(8px)",
    }}>
      <div style={{
        background: "var(--color-bg-primary, #fff)",
        borderRadius: 16,
        padding: 32,
        width: 420,
        maxWidth: "90vw",
        boxShadow: "0 8px 40px rgba(0,0,0,0.2)",
      }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 18, fontWeight: 500 }}>设置密码</h2>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--color-text-secondary, #666)" }}>
          密码将同时用于锁屏和笔记加密
        </p>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>🔒 密码</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type={showPw ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 4 位"
              style={inputStyle}
              autoFocus
            />
            <button onClick={() => setShowPw(!showPw)} style={toggleBtnStyle}>
              {showPw ? "隐藏" : "显示"}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>🔒 确认密码</label>
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="再次输入密码"
            style={inputStyle}
          />
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 }}>💬 密码提示</label>
          <input
            value={hint}
            onChange={(e) => setHint(e.target.value)}
            placeholder="例如：我的生日"
            style={inputStyle}
          />
        </div>

        <p style={{ fontSize: 12, color: "#D85A30", margin: "0 0 16px", lineHeight: 1.5 }}>
          ⚠ 请牢记此密码！没有密码将无法恢复笔记数据。设置后所有笔记内容会被加密保护。
        </p>

        {error && <p style={{ color: "#E24B4A", fontSize: 13, margin: "0 0 12px" }}>{error}</p>}

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={handleSkip} disabled={loading} style={{
            ...secondaryBtnStyle,
            opacity: loading ? 0.6 : 1,
          }}>
            跳过
          </button>
          <button onClick={handleFinish} disabled={loading} style={{
            ...primaryBtnStyle,
            flex: 1,
            opacity: loading ? 0.6 : 1,
          }}>
            {loading ? "保存中..." : "开始使用 →"}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: "8px 12px",
  fontSize: 14,
  border: "1px solid var(--color-border, #ddd)",
  borderRadius: 8,
  outline: "none",
  background: "var(--color-bg-secondary, #f5f5f5)",
  color: "var(--color-text-primary, #000)",
};

const toggleBtnStyle: React.CSSProperties = {
  padding: "8px 12px",
  fontSize: 12,
  border: "1px solid var(--color-border, #ddd)",
  borderRadius: 8,
  background: "var(--color-bg-secondary, #f5f5f5)",
  color: "var(--color-text-secondary, #555)",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const primaryBtnStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 500,
  border: "none",
  borderRadius: 8,
  background: "#378ADD",
  color: "#fff",
  cursor: "pointer",
};

const secondaryBtnStyle: React.CSSProperties = {
  padding: "10px 20px",
  fontSize: 14,
  fontWeight: 500,
  border: "1px solid var(--color-border, #ddd)",
  borderRadius: 8,
  background: "transparent",
  color: "var(--color-text-primary, #000)",
  cursor: "pointer",
};
