# 日历同步调研笔记

日期：2026-06-04

## 目标

Dayboard 后续会接入 Google Calendar 和 Outlook/Microsoft Graph。同步逻辑需要先以可靠和隐私为前提，不把 MVP 绑死在复杂同步问题上。

## 边界情况

- 时区变化。
- 夏令时。
- 全天事件。
- 重复事件。
- 重复事件中的单次例外。
- 取消事件。
- 跨天事件。
- 多账号同名日历。
- 远端删除，本地仍缓存。
- 本地离线编辑后远端已变化。
- OAuth token 过期或撤销。
- 用户登出后的本地缓存清理。

## 分阶段策略

### Phase 1：不同步

只做本地任务和本地日程，用假数据或本地数据库验证 UI 和桌面体验。

### Phase 2：只读同步

先拉取远端事件并缓存到本地，不把本地编辑写回远端。这样可以专注验证 OAuth、token 存储、事件模型、时区和重复事件展开。

### Phase 3：双向同步

在只读同步稳定后再加入创建、编辑、删除和冲突处理。

## 数据模型建议

本地事件至少区分：

- 本地 ID。
- 来源账号。
- 来源日历。
- 远端事件 ID。
- 标题。
- 开始时间。
- 结束时间。
- 是否全天。
- 时区。
- 是否重复事件。
- 重复规则原文。
- 状态：confirmed、cancelled、tentative。
- 最后同步时间。
- 本地脏状态。

## 安全原则

- 不在日志中输出 OAuth token、refresh token、事件正文和邮箱地址。
- token 不应明文长期存储。
- 用户登出后清理 token 和远端缓存。
- 同步错误信息应可读，但不泄漏敏感数据。

## 可参考项目

Windows Calendar Widget 使用本地 SQLite 存储事件，支持 Google Calendar 双向同步和本地 OAuth 回调。它适合作为产品切片参考，但 Dayboard 不应直接继承其 token 明文 JSON 存储方式。

参考：https://github.com/JKH-ML/windows-calendar-widget
