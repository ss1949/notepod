# NotePod

<div align="center">

**基于 Rust + Tauri 2 的跨平台笔记应用**

本地优先 · 所见即所得 · 知识图谱 · Git 同步 · AES 加密

[Windows · macOS · Linux](https://github.com) · [Android](https://github.com)

</div>

---

## 概述

NotePod 是一款注重隐私和性能的跨平台笔记应用。后端 Rust 驱动，前端 React 18 + TypeScript，桌面端和 Android 端共享同一套代码。

核心设计：数据完全本地存储（SQLite），可选 AES-256-GCM 加密，通过 Git 远程备份/同步。编辑器基于 ProseMirror 实现所见即所得 Markdown 编辑，支持双向链接、块引用、LaTeX 公式、任务管理、知识图谱等功能。

---

## 功能

### 编辑器
- **ProseMirror WYSIWYG** — 所见即所得，Markdown 实时渲染
- **任务管理** — TODO/DOING/DONE 等七种状态，点击循环切换，自动记录耗时
- **Wiki 双链** — `[[笔记标题]]` 实时渲染，双击编辑
- **块引用** — `((block-id))` 跨笔记引用
- **LaTeX 公式** — 行内/块级，双击编辑
- **斜杠命令** — `/` 唤起命令面板
- **多模式** — 预览 / 所见即所得 / 编辑 / 双栏 / 脑图 / 图谱
- **自动保存** — 500ms 防抖

### 笔记管理
- **文件夹** — 多级嵌套，颜色标识
- **标签** — 全局标签库，多标签关联
- **任务聚合** — 跨笔记汇总活跃任务
- **Markdown 导入** — 批量导入 `.md` 文件

### 知识组织
- **知识图谱** — 力导向图，可视化笔记关联
- **脑图** — 基于标题层级自动生成
- **反向链接** — 自动检测并展示引用关系

### 每日日志
- **日期导航** — 快速切换日期，日历选择
- **时间线** — 按月分组，卡片展示
- **单日志详情** — 当日待办 + 关联笔记

### 高级查询
- **多维度筛选** — 关键词、日期、标签、优先级、状态、类型
- **Logseq 查询宏** — `{{query (todo ...)}}` 动态嵌入
- **CSV 导出** — UTF-8 BOM，兼容 Excel

### 数据安全
- **本地 SQLite** — WAL 模式，全量本地存储
- **锁屏保护** — Argon2id 密码哈希
- **笔记加密** — AES-256-GCM
- **备份恢复** — ZIP 归档 + manifest
- **Git 同步** — 远程仓库备份，支持加密笔记

### 界面
- **三栏布局** — 侧栏 + 列表 + 编辑器，可折叠
- **专注模式** — 一键沉浸
- **暗色模式** — 自动跟随系统 / 手动切换
- **移动端适配** — 底部 Tab 栏 + 抽屉导航
- **活动热力图** — 180 天统计

---

## 快速开始

### 环境要求

| 依赖 | 版本 |
|------|------|
| Rust | stable |
| Node.js | 18+ |
| MSVC Build Tools | 2022 (仅 Windows) |
| WebView2 | Windows 10/11 自带 |

### 安装运行

```powershell
# 安装依赖
npm install

# 桌面端开发模式（热重载）
desktop-debug.bat

# 或直接
npx tauri dev

# 构建发布版
npx tauri build
```

构建产物：`src-tauri/target/release/bundle/nsis/NotePod_1.0.0_x64-setup.exe`

### Android 端

**额外环境**：Android SDK (API 24+) · NDK · Java 21+ · Gradle 8.11+

```powershell
# 添加编译目标
rustup target add aarch64-linux-android

# 一键调试（Vite + Rust 交叉编译 + APK 构建 + 安装）
android-debug.bat dev

# 仅构建
android-debug.bat build
```

> Android 端使用 Tauri v2 的 WebView 渲染前端，通过 JNI 调用 Rust 后端。Git 同步仅支持 HTTPS 协议。

---

## 项目结构

```
notepod/
├── src-tauri/                    # Rust 后端
│   ├── src/
│   │   ├── lib.rs               # IPC 命令注册
│   │   ├── commands/            # IPC 命令
│   │   │   ├── note.rs          # 笔记 CRUD + 日志 + 热力图
│   │   │   ├── folder.rs        # 文件夹管理
│   │   │   ├── tag.rs           # 标签管理
│   │   │   ├── query.rs         # 动态 SQL 查询
│   │   │   ├── export.rs        # 导入/导出
│   │   │   ├── backup.rs        # 备份/恢复
│   │   │   ├── git.rs           # Git 同步
│   │   │   ├── gix_ops.rs       # gitoxide 操作层
│   │   │   └── lock.rs          # 锁屏 + 加密
│   │   └── db/                  # 数据库层
│   ├── gen/android/             # Tauri Android 工程
│   └── Cargo.toml
│
├── src/                          # React 前端
│   ├── components/
│   │   ├── Editor/              # 编辑器（ProseMirror）
│   │   ├── Sidebar/             # 侧边栏
│   │   ├── NoteList/            # 笔记列表
│   │   ├── DailyView/           # 每日日志
│   │   ├── GraphView/           # 知识图谱
│   │   ├── Mobile/              # 移动端布局
│   │   └── QueryPanel/          # 高级查询
│   ├── stores/                  # Zustand 状态
│   └── App.tsx
│
├── android-debug.bat             # Android 调试脚本
├── desktop-debug.bat             # 桌面端调试脚本
├── package.json
└── vite.config.ts
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript 5 + Tailwind CSS 3 |
| 编辑器 | ProseMirror + marked + KaTeX |
| 构建 | Vite 5 |
| 状态 | Zustand |
| 桌面 | Tauri 2 (WebView2) |
| 移动端 | Tauri 2 (Android WebView) |
| 后端 | Rust |
| 数据库 | SQLite (rusqlite, WAL 模式) |
| 加密 | AES-256-GCM + Argon2id |
| Git | gitoxide (gix, 纯 Rust) + 系统 git |

---

## 开发备注

- **Git 同步**：桌面端调用系统 `git push`（完整协议支持）；导出 `notes/<id>.md` + `journals/<date>.md` 到仓库
- **加密方案**：单密码方案，锁屏密码即加密密码，Argon2id 派生密钥
- **Android 适配**：Tauri v2 原生适配，`android-debug.bat` 脚本自动完成全部调试流程
- **状态栏**：Android 端半透明深色背景 + 浅色图标，支持全屏沉浸模式
- **编辑器插件**：任务标记、Wiki 链接、数学公式、斜杠命令、剪贴板增强

---

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+N` | 新建笔记 |
| `Ctrl+D` | 今日日志 |
| `Ctrl+B` | 加粗 |
| `Ctrl+I` | 斜体 |
| `Ctrl+K` | 链接 |
| `Ctrl+[` / `Ctrl+]` | 侧栏 / 列表折叠 |
| `Ctrl+.` | 专注模式 |
| `Ctrl+Shift+F` | 查询面板 |
| `/` | 斜杠命令 |

---

## License

MIT

## 截图
![输入图片说明](https://gitee.com/qingchenshanxia/notepod/raw/master/pic/1.png)
![输入图片说明](https://gitee.com/qingchenshanxia/notepod/raw/master/pic/2.png)
![输入图片说明](https://gitee.com/qingchenshanxia/notepod/raw/master/pic/3.png)
![输入图片说明](https://gitee.com/qingchenshanxia/notepod/raw/master/pic/4.png)
![输入图片说明](https://gitee.com/qingchenshanxia/notepod/raw/master/pic/5.png)
![输入图片说明](https://gitee.com/qingchenshanxia/notepod/raw/master/pic/6.jpg)
![输入图片说明](https://gitee.com/qingchenshanxia/notepod/raw/master/pic/7.jpg)
