# 备用 owner 替换采用关系确认优先的安全顺序

## 状态

已接受，2026-08-27。

备用 owner 只是普通 Account 在目标 Workspace 中的活动 `owner` Membership，不是账号类型或 Workspace 字段。健康 owner 的替换先让候选账号形成活动 Membership、确认真实远端角色与席位，再移除旧 owner；已确认封号或无法登录的 owner 则由另一名 owner 先移除远端关系，再在删除预览确认不会级联删除仍在使用的 Workspace 后删除账号，随后补入候选。任何顺序都不得让最后一个可管理 owner 消失。

Workspace 成员刷新结果是角色和远端成员 ID 的最终证据，个人 `/checkAccounts` 的账号上下文只用于同步可见关系，不能覆盖已确认的 Workspace 成员角色。无法使用普通邀请时，可以临时开启 `auto_accept_requests` 走 Workspace external ID 申请加入；候选形成活动 Membership 后必须恢复设置原值（默认 `false`）。

该顺序保留了健康替换的可恢复性，也为封号账号提供了先清除失效远端关系的出口；代价是替换过程必须保留明确的中间态和最终复核，不能把 `requested`、`pending` 或同步失败当作已加入。

实现校验项：Workspace 套餐持久化只能接受订阅响应的 `subscription.plan_type`。当该字段缺失时，不得回退到 `/checkAccounts` 的账号 `planType`；发布前应补充回归测试，确保席位概览不会因账号席位上下文被错误纳入或排除。
