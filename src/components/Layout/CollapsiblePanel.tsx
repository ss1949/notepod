import React from "react";
import clsx from "clsx";

interface CollapsiblePanelProps {
  collapsed: boolean;
  width: number;
  onToggle: () => void;
  side: "left" | "right";
  children: React.ReactNode;
}

/**
 * CollapsiblePanel — Apple Notes 风格可折叠面板
 *
 * 设计原则（Apple Notes / SF Symbols 风格）：
 * 1. 展开态：正常显示内容，由右侧分隔线与下一个面板区分
 * 2. 折叠态：完全隐藏（不残留窄条、不残留手柄）
 * 3. 折叠/展开操作通过工具栏按钮或面板头部按钮触发
 * 4. 折叠过渡平滑（180ms ease）
 */
export function CollapsiblePanel({
  collapsed,
  width,
  side,
  children,
}: CollapsiblePanelProps) {
  if (collapsed) return null;

  return (
    <div
      className={clsx(
        "flex-shrink-0 h-full overflow-hidden collapsible-transition",
        side === "left" ? "border-r" : "border-l",
      )}
      style={{
        width,
        minWidth: 0,
        borderColor: "var(--color-border)",
      }}
    >
      <div style={{ width: "100%", height: "100%" }}>{children}</div>
    </div>
  );
}

/**
 * PanelToggleButton — 面板头部折叠按钮
 *
 * 放在各面板（Sidebar / NoteList）头部，点击即可折叠该面板。
 * Apple 风格：圆角矩形，浅灰背景，hover 微深色，箭头方向表示折叠方向
 */
interface PanelToggleButtonProps {
  onClick: () => void;
  side: "left" | "right";
  label?: string;
}

export function PanelToggleButton({
  onClick,
  side,
  label,
}: PanelToggleButtonProps) {
  const title = label
    ? `折叠${label} (${side === "left" ? "⌘[" : "⌘]"})`
    : side === "left"
      ? "折叠侧栏 (⌘[)"
      : "折叠列表 (⌘])";

  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={clsx(
        "flex items-center justify-center",
        "rounded-md",
        "bg-bg-input hover:bg-bg-tertiary",
        "text-text-muted hover:text-text-secondary",
        "transition-colors duration-150",
        "cursor-pointer",
      )}
      style={{
        width: 26,
        height: 26,
      }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {side === "left" ? (
          <polyline points="15 18 9 12 15 6" />
        ) : (
          <polyline points="9 18 15 12 9 6" />
        )}
      </svg>
    </button>
  );
}

/**
 * ToolbarToggleButton — 编辑器顶部工具栏上的"侧栏/列表"切换按钮
 *
 * 参考 Apple Notes 工具栏设计：按钮始终可见，点击切换面板显示/隐藏
 * 当面板被折叠时，按钮呈现"未激活"视觉状态（更浅背景 + 更浅图标）
 */
interface ToolbarToggleButtonProps {
  onClick: () => void;
  active: boolean; // active = 面板已展开
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
}

export function ToolbarToggleButton({
  onClick,
  active,
  label,
  icon,
  shortcut,
}: ToolbarToggleButtonProps) {
  const title = shortcut
    ? `${active ? "隐藏" : "显示"}${label} (${shortcut})`
    : `${active ? "隐藏" : "显示"}${label}`;

  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={clsx(
        "flex items-center gap-1",
        "rounded-md px-2",
        "transition-colors duration-150",
        "cursor-pointer",
        "text-[12px]",
        active
          ? "bg-bg-tertiary hover:bg-bg-input text-text-secondary"
          : "bg-transparent hover:bg-bg-input text-text-muted",
      )}
      style={{
        height: 28,
      }}
    >
      <span className="flex items-center justify-center" style={{ width: 16, height: 16 }}>
        {icon}
      </span>
      <span style={{ fontSize: 12, fontWeight: 500 }}>{label}</span>
    </button>
  );
}

interface ResizeHandleProps {
  onResize: (delta: number) => void;
}

/** 拖拽分隔条 */
export function ResizeHandle({ onResize }: ResizeHandleProps) {
  const dragging = React.useRef(false);
  const lastX = React.useRef(0);

  React.useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - lastX.current;
      lastX.current = e.clientX;
      onResize(delta);
    };
    const onMouseUp = () => {
      dragging.current = false;
      document.body.style.cursor = "";
    };
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [onResize]);

  return (
    <div
      onMouseDown={(e) => {
        dragging.current = true;
        lastX.current = e.clientX;
        document.body.style.cursor = "col-resize";
      }}
      className="w-1 cursor-col-resize bg-border hover:bg-accent flex-shrink-0 transition-colors"
    />
  );
}
