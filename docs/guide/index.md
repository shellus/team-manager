# 使用手册

## 账号

在 `/accounts` 查看所有受管登录身份。筛选、分组、套餐和能力保存在 URL，可刷新或分享。账号详情提供：

- GAM 绑定、同步、Profile、住宅代理和 Session；
- 个人空间套餐、支付摘要和取消续费；
- 加入或管理的全部 Workspace；
- `Account × Workspace` 凭证；
- 自动化操作记录。

“拥有可管理空间”来自活动 owner/admin Membership，不是账号类型。通过“管理分组”创建或重命名结构化分组；删除非空分组前先移动账号。

## Workspace

在 `/workspaces` 按远端空间查看成员、邀请、席位、凭证、设置与账单。执行刷新、邀请、移除、改名或设置时，必须选择当前在该 Workspace 有 owner/admin 权限的账号。

Business 支持：

- 为账号创建新 Workspace；
- 把账号可管理的既有 Workspace 升级为 Business。

## 套餐与支付

个人空间支持 Go、Plus、Pro 5x、Pro 20x。Free 账号可以首次开通；付费套餐间切换在上游协议验证完成前禁用。完整卡号/CVC 只发送给 GAM，不保存到 Team Manager。

## Team 订单与设置

`/team-orders` 管理 Workspace 升级订单配置和维护池。维护记录显式保存 Workspace 与执行账号，但不把 Workspace 永久归属于账号。

`/settings` 管理 PostgreSQL 中的通知策略。部署秘密不在普通配置 JSON 中填写。

## 公开客户席位

`/seat/:seatKey` 是稳定公开链接。客户可以查看当前邮箱和资料，并在安全条件下换号。已接受的标准 ChatGPT 成员不会被公开流程自动移除。

## 凭证

凭证始终绑定“账号 × Workspace”。跨 Workspace 必须重新授权或创建 PAT，不能修改 JSON 字段复用。凭证正文是文件制品，数据库只保存索引和哈希。
