# 固定席位 Business 可变容量重构

## 目标

固定席位 Business 的套餐身份与席位容量分离。2 席位和 4 席位 Workspace 使用同一个套餐代码，账号列表、母号概览、席位概览和风险判断统一消费最新订阅权益容量，不再内置容量 2。

领域词汇以源码根目录 `CONTEXT.md` 为准，席位规则以 [`seat-and-credential-model.md`](../core/seat-and-credential-model.md) 为准；本计划只记录实现范围和验收条件。

## 共享合同

- 主套餐代码：`business_fixed_seat`。
- 输入兼容：API 与前端持久筛选接受旧值 `business_two_seat`，读取后规范化为新值。
- 权益容量：`fixedSeatCapacity?: number`。
- 关系占用：`fixedSeatOccupied: number`。
- 订阅报告使用数：`subscriptionSeatsInUse?: number`。
- 发票计费数：`billedSeatQuantity?: number`。
- 可用空位：只有容量已知时才产生 `fixedSeatAvailable` 和空位卡片。

## 数据迁移

1. 新增不可改写 migration，为 `workspace_subscription_snapshots` 增加 `fixed_seat_capacity` 与 `subscription_seats_in_use`。
2. 从既有快照 `payload.subscription` 回填两个结构化字段；无有效非负整数时保持 `null`。
3. 重建 `account_operational_summaries`，输出 `business_fixed_seat`、代表 Workspace 的占用数和容量。
4. 历史 migration 不改写；回滚恢复迁移前 View 与列结构。

## 实现范围

- Workspace 订阅同步在写快照时校验并保存容量和上游使用数。
- 账号列表、母号概览和席位概览复用同一容量语义；任何投影不得自行写默认容量。
- 固定席位 Business 的标签不包含“双席位”；容量在 `已占用/权益容量` 中动态呈现。
- TeamCode 的 `seatQuantity` 成为显式订单配置，不再隐藏在 HTTP client 中；默认值只属于订单创建策略，不得参与既有 Workspace 容量投影。
- 计费数量继续来自账单，不回写为权益容量。容量、关系占用、订阅使用数和计费数不一致时保留各自事实。

## 验收

- 2 席位 Workspace 显示 `2/2`，4 席位 Workspace 显示 `4/4`。
- 容量未知时显示 `n/?`，不补空位、不误报超容。
- 占用大于已知容量时才产生超容风险。
- `business_two_seat` 旧 URL 或本地筛选仍能得到固定席位 Business 结果，并被规范化为新值。
- 测试阻止 `capacity: 2`、`Math.max(2 - occupied)` 和 HTTP client 内固定 `seatQuantity: 2` 重新进入席位业务路径。
