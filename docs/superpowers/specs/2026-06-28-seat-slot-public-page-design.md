# 席位位置与免登录换号页设计

## 背景

母号成员资料原来保存在 `memberProfiles`，维度是“母号内部 id × 邮箱”。该模型适合记录某个邮箱的备注和到期时间，但不适合运营“售出的 ChatGPT 固定席位”。售出的对象是席位位置，邮箱只是当前位置的占用者；换号后备注、到期时间和价格应继续属于同一个位置。

本设计引入 `seatSlots` 作为母号下的本地席位位置模型。`seatSlots` 只服务 ChatGPT 固定席位，即远端 `seat_type=default`；不处理 `usage_based` / Codex 席位。

## 数据模型

`Account` 新增 `seatSlots?: AccountSeatSlot[]`。每个 slot 表示一个可售卖、可独立换号的位置：

| 字段 | 含义 |
|---|---|
| `seatKey` | 16 位随机字符，用于免登录页面鉴权 |
| `email` | 当前绑定邮箱；换号中断或空位时可为空 |
| `remark` | 本地备注 |
| `expiresOn` | 到期日期，格式为 `yyyy-mm-dd`；只用于展示和提醒，不限制换号 |
| `price` | 本地价格文本 |
| `seat` | 固定为 `default` |
| `status` | 本地派生状态：`empty`、`invited`、`member`、`unknown` |
| `currentUserId` | 最近同步到的远端 member id |
| `currentInviteId` | 最近同步到的远端 invite id |
| `lastSwap` | 最近一次换号任务状态和进度 |
| `swapHistory` | 同一 slot 的全部换号任务历史 |
| `updatedAt` | 本地更新时间 |

`memberProfiles` 在迁移后不再作为主模型。迁移过程将旧邮箱资料转换为 slot，后续页面和通知均按 slot 读取。

## 迁移规则

迁移输入来自当前 `accounts.json` 和迁移前备份。若当前数据缺失成员备注，迁移先从备份中按“母号 id 或 workspace accountId + 小写邮箱”恢复旧字段。

迁移顺序：

1. 读取每个母号的旧 `memberProfiles`。
2. 对每个 profile 生成一个 `seatSlot`，保留 `remark`、`expiresOn`、`expireRemove`、`expireReminder` 兼容提醒所需语义。
3. 为每个 slot 生成唯一 16 位 `seatKey`。
4. 用当前 `membersCache` 和 `pendingInvitesCache` 填充 `status`、`currentUserId`、`currentInviteId`。
5. 删除 `memberProfiles`，避免后续出现邮箱维度和位置维度两套事实源。

如果某个邮箱只存在于远端缓存、没有本地资料，迁移不自动生成 slot。运营售出的席位必须有本地 slot。

## 免登录席位页

页面路径使用 `seatKey` 鉴权。后端提供 public API，不要求管理员 JWT：

- 读取当前 slot：展示备注、到期时间、价格、当前绑定邮箱、当前远端状态。
- 发起换号：输入新邮箱并启动后端任务。
- 查询进度：返回当前步骤、状态、错误信息、已完成步骤和该 slot 的换号历史。

`seatKey` 是 bearer secret。API 响应不得返回母号 access token、cookie、管理员信息或其他 slot 的信息。

## 换号状态机

换号任务以 slot 为唯一操作对象：

1. 同步母号成员和邀请缓存。
2. 根据 slot 当前 `email` 定位远端 member 或 pending invite。
3. 如果定位到 member，仅移除该 `userId`。
4. 如果定位到 pending invite，仅撤销该邮箱的邀请。
5. 如果 slot 当前 `email` 为空，跳过移除步骤。
6. 如果 slot 当前邮箱在远端不存在，不移除其他邮箱，继续邀请新邮箱。
7. 邀请新邮箱为 `default` 席位。
8. 将 slot 的 `email` 更新为新邮箱，备注、到期时间和价格保持不变。
9. 刷新缓存并记录最终状态。

换号期间同一个 slot 只允许一个任务运行。新邮箱如果已绑定在同一母号的其他 slot，必须拒绝，避免一个邮箱占用多个位置或覆盖他人位置。

到期时间不作为换号权限限制。过期 slot 仍可查看和换号。

## 失败与恢复

任务每完成一个远端副作用步骤后写入 `lastSwap`，并更新 `swapHistory` 中同一任务 id 的记录。服务中断后再次打开页面时，slot 仍以 `seatKey` 为入口：

- 旧邮箱已被移除但新邮箱未邀请：slot 可能为空，下一次换号跳过移除并邀请新邮箱。
- 旧邮箱不存在：不猜测其他成员，不删除其他 slot 的邮箱。
- 新邮箱已邀请但未成为 member：页面展示 pending 状态。
- 邀请失败：保留 slot 原状态和错误，允许用户重新提交。

## 通知与展示

到期提醒扫描 `seatSlots`，而不是 `memberProfiles`。提醒内容使用 slot 的当前邮箱、备注、到期时间、价格和远端状态。母号成员列表仍展示远端 member / invite 行，但本地资料来源改为按 slot 当前邮箱关联。

## 验证要求

- 数据迁移必须先备份运行时数据。
- 迁移测试覆盖旧 `note` / `remark` 恢复、`seatKey` 唯一性、`memberProfiles` 删除和远端缓存状态关联。
- 换号服务测试覆盖成员移除、邀请撤销、空 slot、旧邮箱不存在、新邮箱占用其他 slot 和中断后的可恢复路径。
- 前端页面测试或类型检查必须覆盖 public API 数据结构、进度显示和换号历史展示。
