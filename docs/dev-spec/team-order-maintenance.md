# Team 升级订单维护实现

## 模型

- `team_order_configurations`：全局或 Workspace 覆盖配置。
- `team_order_maintenances`：Workspace、执行账号、启用状态、运行时间和错误。
- `team_upgrade_orders`：订单配置快照、上游引用、Checkout URL、状态和重试元数据。

订单配置兼容旧的 `seatQuantity` 总数，并可通过 `seatQuantities` 保存订单明细；用于 `chatgptteamplan` Checkout 的 `seat_type` 只能是 `default` 或 `prolite`，`usage_based`/Codex 不是该 Checkout 的固定席位类型。新明细总数必须与总席位数一致，席位数量不在本地设置最低值或业务上限，由 Business 上游判定。

维护关系的主对象是 Workspace；`executor_account_id` 必须在执行时拥有活动 owner/admin Membership。Workspace 不永久属于账号。

## API

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/api/team-orders` | 配置、维护关系和最近订单 |
| `PUT` | `/api/team-orders/configuration` | 保存全局或 Workspace 配置 |
| `PUT` | `/api/team-orders/maintenances/:workspaceId` | 保存 Workspace 维护关系 |

完整支付秘密不进入这些表。Checkout URL 只表示上游订单入口，不能推断付款或订阅已生效。
