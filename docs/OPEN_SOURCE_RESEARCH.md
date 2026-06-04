# Dayboard 开源参考调研

日期：2026-06-04

## 调研目标

Dayboard 的早期目标是 Windows 桌面日历贴片、多账号日程同步和轻量任务管理。本轮调研用于确认是否已有可复用方向，避免从窗口形态、同步流程、数据存储和桌面集成上重复踩坑。

## 可参考项目

### Windows Calendar Widget

链接：https://github.com/JKH-ML/windows-calendar-widget

定位高度接近 Dayboard：Windows 轻量桌面日历小组件，支持月/周/日视图、事件增删改、重复事件和 Google Calendar 双向同步。其技术栈是 Wails v2、Go、React、TypeScript、Vite、Tailwind、shadcn/ui、date-fns 和 SQLite。

值得参考：

- 先本地 SQLite，再同步远端日历。
- OAuth 回调使用本地端口。
- 数据放在用户目录，不要求管理员权限。
- 登出时清理 token 和缓存数据。
- 视图从月/周/日切换开始，不先做复杂项目管理能力。

不建议直接照搬：

- 项目说明标注偏个人学习/使用，工程成熟度和许可证细节需要单独核验。
- 当前只覆盖 Google Calendar，Dayboard 还计划 Outlook。
- token 明文 JSON 存储的做法不应作为 Dayboard 长期方案，后续应优先考虑 Windows Credential Manager、DPAPI 或 Tauri Stronghold 等方案。

### Delta Widgets

链接：https://delta-widgets.vercel.app/

Delta Widgets 是 Windows 桌面 widget 制作器，重点是可视化拖拽、模板、HTML/URL 嵌入和动态数据。它对 Dayboard 的参考价值不在日历逻辑，而在“桌面 widget 应该怎样被创建、放置、预览、启动和管理”。

值得参考：

- 桌面 widget 不一定要像传统应用，应该支持固定位置、轻量配置和低打扰。
- 可先做单个 Dayboard widget，再考虑多 widget 或模板。
- 早期不必做拖拽构建器，这会偏离日历产品主线。

### Zebar

链接：https://github.com/glzr-io/zebar

Zebar 是跨平台 taskbar、desktop widgets 和 popups 工具，widgets 使用原生 webview，支持系统托盘入口、widget 包和开机启动管理。

值得参考：

- 托盘入口适合承载显示/隐藏、同步、设置、退出等控制。
- widget 配置文件和启动项管理可作为后续扩展思路。
- Dayboard MVP 不应先做插件市场或 widget 包系统。

### Tauri 官方能力

链接：

- https://v2.tauri.app/plugin/
- https://v2.tauri.app/plugin/autostart/

Tauri v2 官方插件覆盖 autostart、single-instance、sql、store、stronghold、updater、window-state、system-tray、window-customization 等 Dayboard 需要的桌面能力。对轻量、隐私优先、本地优先的 Windows 桌面应用比较合适。

注意点：

- Windows 依赖 WebView2。
- Rust 后端学习和调试成本高于 Electron。
- 复杂 Windows 桌面层级，例如真正贴到桌面壁纸层、跨虚拟桌面行为，仍需做原型验证。

### Electron 官方能力

链接：

- https://www.electronjs.org/docs/latest/api/browser-window
- https://www.electronjs.org/docs/latest/api/base-window

Electron 的 BrowserWindow/BaseWindow 对 frameless、alwaysOnTop、skipTaskbar、focusable、opacity 等窗口行为支持成熟，生态也最成熟。

适合作为备选：

- 如果 Dayboard 需要最快实现，且能接受更大的安装包和内存占用。
- 如果 Tauri 在窗口置底、托盘、多窗口或 OAuth 调试上卡住。

### Wails

链接：https://wails.io/docs/v2.9.0/guides/windows

Wails 使用 Go 后端和系统 WebView。Windows Calendar Widget 的存在说明它能做 Dayboard 的近似产品形态。

适合作为备选：

- 如果团队更熟 Go，不想引入 Rust。
- 如果希望后端逻辑比 Electron 更轻，但前端仍用 React/Vite。

风险：

- Wails v2/v3 能力边界和生态成熟度需要继续核验，尤其是托盘、多窗口、updater、credential storage 等能力。

## 初步结论

Dayboard 没必要从零摸索完整桌面日历应用形态。可以参考 Windows Calendar Widget 的产品切片和本地优先同步思路，参考 Zebar/Delta Widgets 的桌面 widget 管理方式。

技术栈建议暂定为 Tauri v2 + React + TypeScript + SQLite，本轮先写入决策记录。Electron 和 Wails 保留为备选，不在 MVP 阶段同时维护多套方案。

## 对 MVP 的影响

- 第一阶段先做本地日历/任务和桌面贴片窗口，不立即接入真实 Google/Outlook 同步。
- 第二阶段再做 Google Calendar 只读同步，验证 OAuth、token 存储、时区、重复事件、全天事件和取消事件。
- 第三阶段再考虑双向同步和 Outlook。
- 桌面能力先做可控选项：托盘、显示/隐藏、窗口位置记忆、开机自启开关。不要默认开机自启，不默认上传或收集日历数据。
