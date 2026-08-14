# PostgreSQL 数据模型

PostgreSQL 是 Team Manager 结构化业务数据的唯一事实源。Schema 由 `apps/server/src/database/migrations/` 中不可改写的版本化 migration 管理，应用启动只检查状态，不自动修改生产 Schema。

## 核心关系

```text
AccountGroup 1 ── N Account 1 ── 1 PersonalSpace
                         │
                         ├── N AccountSessionRevision
                         ├── N AccountAccessContext
                         ├── N AutomationOperation
                         ├── N WorkspaceMembership N ── 1 Workspace
                         └── N WorkspaceCredential N ── 1 Workspace
                                                              ├── N WorkspaceInvitation
                                                              ├── N WorkspaceSnapshot
                                                              ├── N BillingSnapshot
                                                              └── N SeatSlot
```

## 约束

- 规范化账号邮箱唯一；账号分组外键必填。
- Account 以邮箱标识，账号备注承担人工运营称呼，不保存重复的账号显示名。
- 每个账号恰有一个个人空间、一个运营资料和至多一个 GAM 绑定。
- Workspace 外部 ID 唯一。
- 活动 owner/admin Membership 派生可管理能力。
- Access Context 必须且只能选择个人空间或 Workspace。
- Credential 分别外键关联账号与 Workspace；正文为文件制品。
- `seatKey` 全局唯一；同一 SeatSlot 同时最多一个活动换号操作。
- Automation Operation 幂等键唯一；支付输入只保存安全摘要。

## 表分组

| 领域 | 表 |
|---|---|
| 账号 | `account_groups`、`accounts`、`account_operational_profiles`、`gam_bindings` |
| Session | `account_session_revisions`、`account_access_contexts` |
| 个人空间 | `personal_spaces`、`personal_subscription_snapshots`、`personal_setting_snapshots`、`personal_quota_snapshots` |
| Workspace | `workspaces`、`workspace_memberships`、`workspace_invitations`、`workspace_subscription_snapshots`、`workspace_setting_snapshots` |
| 凭证 | `credential_pool_groups`、`workspace_credentials`、`credential_quota_snapshots` |
| 席位 | `seat_slots`、`seat_slot_identity_history`、`seat_slot_swap_operations` |
| 财务 | `billing_snapshots`、`billing_invoices`、`payment_method_summaries` |
| 自动化 | `automation_operations`、`automation_operation_events`、`payment_attempt_summaries` |
| 订单与设置 | `team_order_configurations`、`team_order_maintenances`、`team_upgrade_orders`、`system_settings`、`notification_policies` |
| 文件证据 | `upstream_trace_segments`、`rrweb_recordings`、`quarantined_artifacts` |

低频上游快照可以保存 `jsonb` 原文，但稳定查询字段必须拆列。Session、Token 与秘密设置在应用层加密；完整 HTTP trace、rrweb 和凭证 JSON 只保存为文件。

## 迁移与恢复

生产备份必须同时覆盖 PostgreSQL、数据加密密钥和制品目录。恢复后核对：

- migration 版本；
- Session/Token 可解密；
- 数据库引用的文件全部存在且 SHA-256 一致；
- 公开 `seatKey` 不变；
- 账号只有一个分组；
- Workspace 外部 ID、Membership、凭证绑定和 Team 订单关系保持。
