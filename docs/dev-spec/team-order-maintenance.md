# Team 升级订单维护实现

## 目标与边界

系统为已存在的 Codex Workspace 周期性生成普通两席位 Team 升级 Checkout：

- TeamCode 请求固定使用 `mode=normal`、`seatQuantity=2`。
- `workspaceId` 必须是母号当前 `accountId`，禁止改成新建 Workspace。
- Workspace 名称优先使用当前缓存名称；缺失时按“首个长度不少于 2 的英文字段首字母大写 + ` Inc`”生成。
- Team Manager 不保存或推断付款状态，不调用 Stripe 查询付款结果。

## 持久化模型

运行时文件 `data/team-orders.json` 包含：

- `globalConfig`：全局优惠码、国家、货币。
- `maintenances`：以 Team Manager 母号内部 ID 为引用的独立维护记录。
- `orders`：订单任务、配置快照、TeamCode 任务 ID、Stripe 时间和错误。

维护记录不写入 `Account`，母号列表的维护标签从维护记录派生。订单历史按母号最多保留 30 条。

最终配置在首次执行时按“母号非空覆盖 > 全局配置”解析并保存到订单记录。因此批量任务在 10 分钟窗口内真正启动前修改配置，仍会使用启动时的当前值；同一订单的后续重试继续使用第一次尝试保存的快照。

## 调度与并发

- 自动周期为 8 小时。
- 首次加入的执行时间通过 Workspace ID 稳定散列分布到未来 10 分钟。
- “立即触发全部”也使用稳定散列分布到未来 10 分钟。
- Team Manager 本地最多并发 3 个 TeamCode 任务。
- 同一母号只允许一个 `queued` 或 `running` 任务。
- 暂停、移出维护池或检测到 Team 订阅时，把尚未执行的 `queued` 任务终结为 `failed` 并记录取消原因；`running` 任务不强制中断。
- 手动任务不修改 `nextRunAt`。
- 自动任务入队时推进 `nextRunAt`；服务停机跨过多个周期时只补一个任务，不回放所有遗漏周期。

失败后的同一订单记录依次在 1、3、10 分钟后重试，第四次失败进入终态 `failed`。没有幂等键，允许 TeamCode 上游存在多个未支付订单。

显式重试按当前状态分流：处于失败重试等待期的 `queued` 记录把 `retryAt` 提前到当前时间，继续使用原配置快照和尝试次数；终态 `failed` 记录保留不变，并按当前维护配置创建新的 `manual` 订单记录。

TeamCode 任务状态保存在上游内存。Team Manager 重启时把本地 `running` 标记为失败，避免把无法继续跟踪的任务永久显示为执行中。

## 状态

持久化状态只有：

- `queued`
- `running`
- `ready`
- `failed`

前端根据 `ready.expiresAt` 派生 `expiring` 和 `expired`。该派生状态不是付款状态。

Workspace 同步确认 `hasTeamSubscription=true` 后，调度器自动把维护记录改为 `paused`，并记录暂停原因。

## 后续测试维护

- `generate-all` 相关测试需要显式停止并等待后台 tick 完成后再删除临时目录。当前单文件测试稳定通过，但全量服务端测试高并发运行时可能出现 tick 晚于临时目录清理、写 `team-orders.json` 返回 `ENOENT` 的竞态；后续应为测试实例补充可等待的 stop/drain 生命周期，并在清理阶段统一调用。

## TeamCode 协议

运行环境通过 `TEAMMGR_TEAMCODE_BASE_URL` 和 `TEAMMGR_TEAMCODE_PASSCODE` 配置客户端。源码和 API 响应不得暴露口令或母号 Session。

1. `POST /api/order` 提交 Session 与订单参数。
2. `GET /api/tasks?ids=...` 轮询生成任务。
3. 成功结果必须包含支付 URL、Stripe Unix 秒 `created` 和 `expires_at`。
4. `calibration.workspaceStatus=mismatch`、缺失时间或无效时间都作为失败处理并进入重试。

## API

| 方法 | 路径 | 作用 |
|---|---|---|
| `GET` | `/api/team-orders` | 返回全局配置和维护池视图 |
| `PATCH` | `/api/team-orders/settings` | 保存全局配置 |
| `POST` | `/api/team-orders/generate-all` | 分散触发全部维护中母号 |
| `GET` | `/api/accounts/:id/team-order-maintenance` | 返回单个母号维护视图 |
| `POST` | `/api/accounts/:id/team-order-maintenance` | 显式加入或更新母号覆盖配置 |
| `PATCH` | `/api/accounts/:id/team-order-maintenance` | 暂停或恢复 |
| `DELETE` | `/api/accounts/:id/team-order-maintenance` | 移出维护池 |
| `POST` | `/api/accounts/:id/team-orders` | 立即生成单个订单 |
| `POST` | `/api/accounts/:id/team-orders/:orderId/retry` | 提前执行自动重试，或为最终失败创建新任务 |
