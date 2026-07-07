import React from "react";
import clsx from "clsx";

interface AppleModalProps {
  open: boolean;
  title?: string;
  message?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
  /** alert 模式：只有一个按钮；confirm 模式：两个按钮 */
  mode?: "alert" | "confirm";
  /** 图标颜色（只影响 alert 模式的警告图标色调） */
  tone?: "default" | "warning" | "danger";
}

/**
 * AppleModal — macOS 提醒/确认弹窗风格
 *
 * 设计要点：
 * - 圆角卡片 + 轻微阴影 + 半透明遮罩
 * - 标题居中 + 粗体；内容居中 + 灰色
 * - 按钮水平排列：取消（灰） / 确认（蓝）
 * - smooth fade + 0.2s ease 动画
 */
export function AppleModal({
  open,
  title,
  message,
  confirmText = "确定",
  cancelText = "取消",
  onConfirm,
  onCancel,
  mode = "confirm",
  tone = "default",
}: AppleModalProps) {
  if (!open) return null;

  return (
    <div
      className={clsx(
        "fixed inset-0 z-50 flex items-center justify-center",
        "backdrop-blur-sm",
      )}
      style={{ background: "rgba(0,0,0,0.25)" }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={clsx(
          "rounded-xl overflow-hidden",
          "shadow-2xl",
          "w-80",
        )}
        style={{
          background: "var(--color-bg-primary)",
          border: "1px solid var(--color-border)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.22), 0 6px 16px rgba(0,0,0,0.12)",
          animation: "appleModalFadeIn 0.18s ease",
        }}
      >
        {/* 图标（仅 alert 模式） */}
        {mode === "alert" && (
          <div className="flex items-center justify-center pt-6 pb-3">
            <svg
              width="44"
              height="44"
              viewBox="0 0 24 24"
              fill="none"
              stroke={tone === "danger" ? "#ff3b30" : tone === "warning" ? "#ff9500" : "#007aff"}
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="13" />
              <circle cx="12" cy="16.5" r="0.8" fill="currentColor" />
            </svg>
          </div>
        )}

        {/* 标题 + 正文 */}
        <div
          className={clsx(
            "px-6 text-center",
            mode === "alert" ? "pb-4" : "py-5",
          )}
        >
          {title && (
            <div
              className="font-semibold text-[13px] text-text-primary mb-1.5"
              style={{ letterSpacing: "-0.01em" }}
            >
              {title}
            </div>
          )}
          {message && (
            <div
              className="text-[12px] text-text-secondary leading-relaxed whitespace-pre-line"
              style={{ letterSpacing: "-0.01em" }}
            >
              {message}
            </div>
          )}
        </div>

        {/* 按钮栏（Apple 风格：分隔线 + 横排） */}
        <div
          className="flex"
          style={{
            borderTop: "1px solid var(--color-border)",
            minHeight: 36,
          }}
        >
          {mode === "confirm" && (
            <button
              onClick={onCancel}
              className="flex-1 text-[13px] font-medium text-text-secondary hover:bg-bg-sidebar-hover transition-colors py-2.5"
            >
              {cancelText}
            </button>
          )}
          <button
            onClick={onConfirm ?? onCancel}
            className={clsx(
              "flex-1 text-[13px] font-semibold py-2.5 transition-colors",
              mode === "confirm" && "border-l border-border",
            )}
            style={{
              color:
                tone === "danger"
                  ? "#ff3b30"
                  : "var(--color-accent, #007aff)",
              backgroundColor: "transparent",
            }}
          >
            {confirmText}
          </button>
        </div>
      </div>

      <style>
        {`
          @keyframes appleModalFadeIn {
            0% {
              opacity: 0;
              transform: scale(0.96);
            }
            100% {
              opacity: 1;
              transform: scale(1);
            }
          }
        `}
      </style>
    </div>
  );
}
