# Windows 桌面贴片能力笔记

日期：2026-06-04

## 目标

Dayboard 需要像桌面小组件一样常驻，但仍要让用户可控、可退出、可隐藏，并且不干扰正常窗口操作。

## 需要验证的窗口行为

- 无边框窗口。
- 可拖动区域。
- 透明或半透明背景。
- 是否显示在任务栏。
- always on top 和普通窗口层级的区别。
- 是否需要“贴到桌面底层”而不是置顶。
- 多显示器下的位置记忆。
- Windows 缩放比例变化后的布局。
- 虚拟桌面切换后的表现。
- 锁屏/休眠/唤醒后的恢复。

## Tauri 可参考能力

Tauri v2 插件表中包含 autostart、single-instance、sql、store、stronghold、updater、window-state、system-tray、window-customization 等能力，可覆盖 Dayboard 早期大部分桌面需求。

参考：

- https://v2.tauri.app/plugin/
- https://v2.tauri.app/plugin/autostart/

## Electron 可参考能力

Electron BrowserWindow/BaseWindow 明确支持 alwaysOnTop、skipTaskbar、focusable、frame、opacity 等窗口参数。它是重要备选和行为参考。

参考：

- https://www.electronjs.org/docs/latest/api/browser-window
- https://www.electronjs.org/docs/latest/api/base-window

## Widget 产品参考

- Windows Calendar Widget：https://github.com/JKH-ML/windows-calendar-widget
- Delta Widgets：https://delta-widgets.vercel.app/
- Zebar：https://github.com/glzr-io/zebar

## 初步设计原则

- 先做“可隐藏的桌面面板”，不要一开始追求真正嵌入桌面壁纸层。
- 托盘必须存在，避免用户找不到退出方式。
- 开机自启默认关闭。
- 位置、尺寸和显示状态应本地保存。
- 所有系统级能力都要有设置入口，不能悄悄启用。
- 主界面默认按接近半屏的桌面工作板设计，日历区域优先，不做过多概览和导航装饰。
- 面板透明度属于低频设置，应放在设置中，避免占用日历空间。
- 固定到桌面需要在 Tauri 壳中继续验证 Windows 窗口层级；Web 原型先保留固定方式入口。

## 原型验证清单

- 启动后窗口是否出现在预期位置。
- 拖动和 resize 是否顺滑。
- 关闭按钮是隐藏还是退出，需要语义明确。
- 任务栏是否出现图标。
- 托盘右键菜单是否可用。
- 多屏移动后重启是否恢复正确。
- Windows 10/11 上 WebView2 依赖是否清晰。

## 2026-06-04 环境检查

当前开发机状态：

- Node.js：已安装，版本 24.14.0。
- npm：已安装，版本 11.9.0。
- WebView2：已安装，版本 148.0.3967.96。
- Rust/rustup/Cargo：未安装。
- Visual Studio Build Tools/MSVC + Windows SDK：未检测到。

影响：

- Vite/React 前端可以安装依赖并构建。
- Tauri 桌面壳暂时无法编译或运行。

## 2026-06-05 MVP 本地存储

当前 Web 原型已使用 localStorage 保存：

- 本地任务和日程。
- 默认视图。
- 任务面板展开状态。
- 面板透明度。
- 固定方式。
- 工具条位置。

后续 Tauri 壳跑通后，应迁移到 SQLite 或 Tauri SQL 插件，并提供一次性数据迁移或导入策略。

下一步需要安装：

- Rustup：https://rustup.rs/
- Visual Studio Build Tools，包含 MSVC 和 Windows SDK：https://aka.ms/vs/17/release/vs_BuildTools.exe

## 2026-07-05 桌面行为接入进展

本次前端已开始把设置页的桌面行为接入 Tauri 窗口 API：

- 固定方式会同步到 `setAlwaysOnTop`、`setAlwaysOnBottom` 和 `setSkipTaskbar`。
- 锁定在桌面会同步到 `setResizable(false)`，并移除前端的 Tauri 拖动区域。
- 任务栏隐藏、置顶和窗口缩放相关权限已加入 `src-tauri/capabilities/default.json`。
- 鼠标穿透暂不接真实 `setIgnoreCursorEvents`，因为还没有全局快捷键或托盘解锁路径，直接启用会让用户难以恢复交互。

验证结果：

- `npm run build` 通过，可确认 React、TypeScript 和 Vite 构建正常。
- `npm run tauri -- build --no-bundle` 未能执行，原因是当前系统找不到 `cargo`。需要安装 Rustup、MSVC Build Tools 和 Windows SDK 后再验证 Tauri 壳的真实窗口行为。

## 2026-07-07 Tauri 桌面壳验证

本机已补齐 Tauri Windows 构建环境：

- Rustup / Cargo / Rustc：stable `x86_64-pc-windows-msvc`，`cargo 1.96.1`，`rustc 1.96.1`。
- Visual Studio Build Tools 2022：`17.14.35`，包含 VC++ 工具链，MSVC 目录 `14.44.35207`。
- 临时应用图标已加入 `code/src-tauri/icons/icon.ico`，用于解锁 Windows 资源生成；正式品牌图标后续替换。

验证结果：

- `npm run tauri -- build --no-bundle` 已通过。
- 生成产物：`code/src-tauri/target/release/dayboard.exe`。
- 已启动 release 产物，进程 `dayboard.exe` 存在，窗口标题为 `Dayboard`。

仍需人工实机检查：

- 透明窗口与无边框显示是否符合桌面贴片预期。
- 托盘左键/右键菜单是否稳定。
- `固定桌面`、`普通窗口`、`置顶` 在 Windows 桌面、多屏、全屏应用前后的真实层级表现。
- 隐藏到托盘后能否可靠恢复。
