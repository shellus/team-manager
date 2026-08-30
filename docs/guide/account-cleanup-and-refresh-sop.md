# 账号与 Workspace 运营 SOP

本流程用于账号状态刷新、封号核验、账号清理、Workspace 关系维护以及备用 owner 替换。流程只操作 Team Manager 的 API、UI 或既有 service/repository，不直接编辑 PostgreSQL、运行 JSON、Session 文件或 GAM/CloakBrowser 资料。

术语和实体边界以[账号、Workspace、席位与凭证模型](../core/seat-and-credential-model.md)为准；备用 owner 的替换顺序另见[备用 owner 替换安全顺序 ADR](../adr/0012-backup-owner-replacement-safety.md)。

## 1. 数据边界与判断来源

Team Manager 中必须区分以下事实：

- `Account` 是受管登录身份；`PersonalSpace` 是该账号的一对一个人空间；`Workspace` 是独立的 Team/Business 空间。
- 个人套餐来自个人空间刷新结果：刷新内先采用 `/accounts/check` 中 `structure=personal` 的当前账号条目，缺少该条目时才使用订阅响应的 `plan_type`。个人订阅接口返回 HTTP 404 且 `detail` 精确为 `No subscription found for account` 时，表示没有个人订阅，写入 `free`；其他 404 或错误必须失败。
- Workspace 套餐只来自 Workspace 订阅响应的 `subscription.plan_type`，保存为 Workspace 订阅快照并更新 `workspaces.normalized_plan`。`/checkAccounts` 的 `item.planType` 只表示当前账号在该 Workspace 中的席位上下文，不能写入 Workspace 套餐字段。
- Workspace 路由中的 `:workspaceId` 是 Team Manager 本地 UUID；账号申请加入接口的请求体 `workspaceId` 是上游 Workspace external ID，二者不能混用。
- `owner`、`admin` 是 Team Manager 的规范化角色；上游请求使用 `account-owner`、`account-admin` 等角色值。`default` 是 ChatGPT 固定席位，`usage_based` 是 Codex/按用量席位，`prolite` 是 Premium 固定席位；Business 固定席位 Checkout 的 `seat_quantities[]` 只接受 `default` 与 `prolite`，Codex 使用独立的按用量 Workspace 产品。

停用账号默认不纳入普通刷新、候选或清理批次；封号标记是人工运营事实，不能由网络错误、Session 失效或某次 API 失败自动推导。
非盈利组织 Workspace 默认不纳入批量刷新、清理或备用 owner 调整，除非任务另行明确授权。

## 2. 建立目标集合与候选账号

执行前固定目标集合，不在分页循环中动态改变集合。每个目标至少记录账号 ID、邮箱、当前分组、`is_banned`、个人套餐、Session 是否存在，以及活动 Workspace 关系。

备用 owner 候选必须同时满足：

1. `is_banned=false`；
2. 个人空间套餐为 `free`，以最近个人订阅刷新快照为准；
3. 当前 Session 可实际换取 Web Access Token，而不是只有数据库中的 Session 记录；
4. 尚未加入目标 Workspace，且没有该 Workspace 的活动 Membership 或待处理 Invitation。

默认优先从 `备用普号` 选择；候选可复用到多个 Workspace 仅在任务明确指定时允许，否则一个候选对应一个目标 Workspace。候选加入后，个人套餐仍是 Free，但账号运营主套餐会因活动 owner Membership 变为对应的 Business owner 称呼，这是两个不同事实。

## 3. 个人空间、账号关系和 Workspace 刷新

单个账号任务按以下顺序执行：

1. `POST /api/accounts/:id/personal-space/refresh` 刷新个人订阅和账单；需要完整资料时使用默认的 `subscription`、`billing`、`quota`、`settings` 资源集合。
2. `POST /api/accounts/:id/workspaces/sync`，以当前账号 Session 校准可见 Workspace 关系；远端消失的关系标记为 `removed`，不自动删除 Workspace。
3. 对该账号活动的每个 Workspace，以具有活动 owner/admin Membership 的账号作为执行账号，调用 `POST /api/workspaces/:workspaceId/refresh`，或按需调用 `people/refresh`、`settings/refresh`、`billing/refresh`。
4. 最终以 Workspace ID 去重核对成员、邀请、设置、订阅和账单快照；同一 Workspace 被多个管理账号看到时，重复刷新是允许的，但结果按 Workspace 合并核对。

个人刷新后仍为 `unknown`，或 Workspace 订阅的 `plan_type` 缺失而仍为 `unknown` 时，报告为数据不足并保留未知，不以账号席位、账单数量、成员数量或历史默认值补写 Free/Team/Codex。

批量任务最多同时运行 6 个账号；按批次启动时批次之间至少间隔 10 秒。只重试失败账号或 Workspace，不重复请求已经成功的任务；默认最多 3 轮。汇总必须区分“请求成功”“数据为空”和“读取失败”。

### 3.1 席位概览缺行排查

席位概览展示 Workspace 固定 ChatGPT（`default`）和 Premium（`prolite`）席位；`usage_based`/Codex Workspace 本来就不进入该页面。发现概览数量从历史值减少时，依次检查：

1. `workspace_subscription_snapshots.normalized_plan` 和 `workspaces.normalized_plan` 是否有最新成功刷新；
2. 以活动 owner/admin 调用 `POST /api/workspaces/:workspaceId/subscription/refresh` 或完整的 `POST /api/workspaces/:workspaceId/refresh`，必要时再刷新成员和邀请；
3. 仅当 Workspace 订阅 `subscription.plan_type` 明确为固定席位 Business 时，才应纳入概览；缺失或未知必须继续排除并报告；
4. 不得用 `/checkAccounts` 的 `item.planType` 覆盖 Workspace 套餐，也不得用某个账号的 Codex/ChatGPT 席位类型推断 Workspace 类型。

## 4. 封号邮件、Session 与网络错误分流

### 4.1 封号邮件

通过 GongXi-Mail 同时核验收件箱和垃圾箱中的 OpenAI/ChatGPT 封号、停用或策略违规邮件。邮件查询遇到 `invalid_grant`、IMAP disabled 或 Microsoft 授权失效时，先恢复邮箱设备授权和可视化登录权限，再重新查询；不能用 Session 或代理错误代替邮件证据。

只有邮件证据或用户明确指示才能设置 `is_banned=true`。确认封号后，按删除流程清理账号；已停用账号按用户明确范围处理，不因普通刷新失败反复操作。

### 4.2 Session 内容错误

以下错误属于 Session 或账号内容问题：缺少 `user.email`、Session 邮箱与 Account 不一致、Token/Session JSON 不完整、Refresh Token/Session Token 无法换取 Access Token。处理方式是重新登录、人工更新 Session，或显式调用 GAM 的 Session refresh/rebuild 流程；禁止通过更换 SID 规避。

“重建 GAM”是显式灾难恢复动作：Team Manager 通过 Account Manager 删除旧 GAM/CloakBrowser 资料并使用现有完整 Session 重新纳管，成功后才恢复 GAM 绑定；失败时不得把旧状态伪装成成功。

### 4.3 网络、代理与 SID

上游 5xx、curl_cffi worker 暂时失败、连接超时等先按原代理重试。只有错误证据明确指向出口/IP 或网络链路时，才通过既有代理配置接口更换 SID，并在更换前保存原配置。SID 长度或格式以当前供应商接口校验为准，不在 SOP 中硬编码历史位数。

缺少邮箱、Session 或账号身份信息时，不能更换 SID；这类问题必须转入 Session/授权修复分支。

## 5. 账号删除与分组清理

### 5.1 删除账号

对每个待删除账号执行：

1. `GET /api/accounts/:id/deletion-preview`，核对邮箱、活动 owner Workspace 和级联资源数量；
2. 如果账号仍是某 Workspace 的 owner，先由另一名可执行 owner 通过 `DELETE /api/workspaces/:workspaceId/members/:remoteUserId` 移除其远端 Membership；
3. 再次读取删除预览，确认目标不再拥有 Workspace，避免账号删除级联删除仍在使用的本地 Workspace；
4. 调用 `DELETE /api/accounts/:id`，请求体为 `{ "confirmLocalCascade": true }`；
5. 删除后重新读取账号列表和 Workspace 成员列表，确认账号已消失、其他成员关系未被误删。

账号删除清理本地关系和专属资料，不调用远端 Workspace 删除接口。默认分组不可删除；非默认分组只有 `accountCount=0` 时才允许删除。

### 5.2 备注和分组

无用备注通过 `PATCH /api/accounts/:id` 提交 `{ "remark": null }` 清除。分组迁移先固定账号 ID 集合，再通过 `PATCH /api/accounts/bulk` 一次提交；确认分组为空后才调用 `DELETE /api/account-groups/:id`。账号分组与凭证号池分组完全独立。

## 6. 三类 Workspace 与备用 owner

分类依据是 Workspace 首次开通的可靠历史证据和 owner 席位事实，不是账号列表当前显示的主套餐。若历史证据缺失，标记“待人工确认”，不自动归类；`workspaces.created_at`、成员 `joined_at` 或单次 `/checkAccounts` 结果不能冒充 Workspace 首次开通时间。

### 6.1 早期开通、可自由修改席位类型

首次开通时间早于 `2026-06-24`，并确认 Workspace/成员接口允许修改席位类型。邀请 Free Account 后，先确认形成活动 Membership，再按该 Workspace 的备用 owner 规则设置 `default` 或 `usage_based` 席位，最后设置 `account-owner`。

### 6.2 Codex owner 保留型

Workspace 先以 `052`/`usage_based` Codex 空间开通，再升级为双席位 Team，升级后原 owner 仍保留 Codex 席位。临时把 `auto_accept_requests` 设为 `true`，让 Free Account 使用上游 Workspace external ID 调用 `POST /api/accounts/:id/workspaces/join-request`；只有返回 `status=joined` 且成员刷新确认活动 Membership 后，才设置 `account-owner`。完成后必须把设置恢复为原值，默认恢复 `false`。

### 6.3 052-only

Workspace 只有 `052`/`usage_based` Codex 空间，没有双席位 Team 订阅。加入、确认 Membership、设置 owner 和恢复 `auto_accept_requests=false` 的步骤与 6.2 相同；替补账号完成后移动到 `052备用owner` 分组。

### 6.4 替换顺序与已有双 owner

- 健康旧 owner：先邀请或申请加入替补，确认活动 Membership、真实远端 `remoteUserId`、席位和 owner 角色，再移除旧 owner。
- 已确认封号或无法登录的旧 owner：由另一名 owner 先移除远端成员，再删除旧账号，然后加入并确认替补；删除前必须完成预览，不能让最后一个可管理 owner 消失。
- 邀请或申请返回 `requested`、`pending` 或同步失败时，不得提前设置 owner 或删除旧 owner；先处理邀请、Session 或权限问题。
- 一个 Workspace 已经存在两个活动 owner 时，视为备用 owner 已由人工配置：按活动 Membership 的加入时间识别后加入者，只移动其账号分组和备注，不重复邀请、不移除 owner。
- 一个管理账号拥有两个 052 Workspace 时，只有任务明确允许才复用同一个 Free Account；必须分别确认两个 Workspace 都有新的活动 owner 后，再移除原 owner。

备用账号完成后，统一使用业务规范词“备用 owner”；现有数据分组名统一为 `备用owner`、`052备用owner`。备注格式为“作为 `<管理账号邮箱>` 的备用 owner”。

## 7. API 操作参考

以下路径均为 Team Manager API，`id`、`workspaceId` 和 `remoteUserId` 的来源必须先从当前 API/详情结果确认：

| 目的 | 方法与路径 | 关键条件 |
| --- | --- | --- |
| 刷新个人空间 | `POST /api/accounts/:id/personal-space/refresh` | 个人订阅 404 精确空结果归一为 Free |
| 同步账号关系 | `POST /api/accounts/:id/workspaces/sync` | 使用当前 Account Session |
| 刷新 Workspace | `POST /api/workspaces/:workspaceId/refresh` | body `{ "executorAccountId": "..." }` |
| 刷新 Workspace 订阅 | `POST /api/workspaces/:workspaceId/subscription/refresh` | 执行账号必须是活动 owner/admin |
| 刷新成员和邀请 | `POST /api/workspaces/:workspaceId/people/refresh` | 执行账号必须是活动 owner/admin |
| 修改 Workspace 设置 | `PATCH /api/workspaces/:workspaceId/settings` | body 含 `executorAccountId`、`key`、`value`；临时开启自动同意后必须恢复原值 |
| 申请加入 | `POST /api/accounts/:id/workspaces/join-request` | body 使用上游 external Workspace ID |
| 邀请成员 | `POST /api/workspaces/:workspaceId/invitations` | body 含 `executorAccountId`、`email`，席位按 Workspace 规则决定 |
| 修改席位/角色 | `PATCH /api/workspaces/:workspaceId/members/:remoteUserId` | 每次只提交 `seat` 或 `role` 一项 |
| 移除成员 | `DELETE /api/workspaces/:workspaceId/members/:remoteUserId` | 由另一名 owner/admin 执行 |
| 删除账号 | 先 `GET .../deletion-preview`，再 `DELETE /api/accounts/:id` | body `{ "confirmLocalCascade": true }` |
| GAM Session 恢复 | `POST /api/accounts/:id/account-manager/session/refresh` 或 `/rebuild` | 必须有完整 Session Token |

## 8. 最终验收

每次批量任务结束后至少复核：

- 目标账号删除数量、剩余封号标记、分组归属和空分组；
- 个人订阅/账单快照是否为最新，空订阅是否明确归一为 Free；
- Workspace 订阅、成员、邀请、设置、账单和席位的最新时间；
- 备用 owner 的活动 Membership、真实角色、席位、备注和分组；
- `auto_accept_requests` 是否恢复原值；
- Session、Access Context 和网络错误是否被正确分流；
- Team Manager 健康检查和两个 Git 边界的状态。

汇总只输出邮箱、状态、错误摘要和数量，不输出 Session、Access Token、Cookie、完整支付信息、代理凭证或其他秘密。
