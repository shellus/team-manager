# PostgreSQL 数据模型

PostgreSQL 是 Team Manager 结构化业务数据的唯一事实源。Schema 由 `apps/server/src/database/migrations/` 中不可改写的版本化 migration 管理，应用启动只检查状态，不自动修改生产 Schema。

## 核心关系

```text
AccountGroup 1 ── N Account 1 ── 1 PersonalSpace
                         │
                         ├── 0..1 Current AccountSessionRevision
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
- `seat_slots.expire_reminder` 是默认开启的显式提醒事实；只有该字段开启且 `expires_on` 存在时才进入到期提醒调度，关闭提醒不改变到期处理策略。
- `seat_slots.expires_on` 是北京时间自然日；该日全天有效，次日北京时间零点后的第一次扫描才进入到期处理。
- Automation Operation 幂等键唯一；支付输入只保存安全摘要。
- Workspace 订阅快照结构化保存 `fixed_seat_capacity` 与 `subscription_seats_in_use`；两者分别对应上游 `seats_entitled` 与 `seats_in_use`，不能从成员、邀请或发票反推。

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

## 固定席位字段边界

| 字段 | 存储或投影位置 | 约束 |
|---|---|---|
| `workspace_subscription_snapshots.fixed_seat_capacity` | Workspace 订阅快照结构化列 | 正整数或 `null`；来自同一快照 `payload.subscription.seats_entitled` |
| `workspace_subscription_snapshots.subscription_seats_in_use` | Workspace 订阅快照结构化列 | 非负整数或 `null`；来自同一快照 `payload.subscription.seats_in_use` |
| `fixedSeatOccupied` | 查询投影 | 活动 `default` Membership 与待接受 `default` Invitation 数量之和，不持久化 |
| `billedSeatQuantity` | Billing 查询投影 | 从具有明确 Business 周期计费语义的发票行读取，不写入 Workspace 或订阅快照 |
| `fixedSeatAvailable` | 查询投影 | 仅在容量已知时计算 `max(fixedSeatCapacity - fixedSeatOccupied, 0)`，不持久化 |

账号运营主套餐使用容量无关代码 `business_fixed_seat`。代表 Workspace 的 `primary_fixed_seat_capacity` 和 `primary_fixed_seat_occupied` 必须通过相同排序选择，不能分别命中不同 Workspace。旧筛选值 `business_two_seat` 只作为输入兼容别名，不再作为领域事实输出。

## 迁移与恢复

生产备份必须同时覆盖 PostgreSQL、数据加密密钥和制品目录。恢复后核对：

- migration 版本；
- Session/Token 可解密；
- 数据库引用的文件全部存在且 SHA-256 一致；
- 公开 `seatKey` 不变；
- 账号只有一个分组；
- Workspace 外部 ID、Membership、凭证绑定和 Team 订单关系保持。
