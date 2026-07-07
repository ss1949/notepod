import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import App from "./App";
import "./styles/globals.css";

const root = ReactDOM.createRoot(document.getElementById("root")!);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// React 渲染完成后隐藏启动屏并显示 Tauri 窗口
requestAnimationFrame(async () => {
  if ((window as any).__hideSplash) {
    (window as any).__hideSplash();
  }
  try {
    const win = getCurrentWebviewWindow();
    await win.show();
  } catch {
    // 在浏览器等非 Tauri 环境中会失败，忽略
  }
});
