# 数据模型与本地缓存规则

本文件定义 team-manager 的本地数据模型边界。目标是避免操作成功后 UI、运行时 JSON、缓存和列表项之间出现重复、冗余或断链。

## 总原则

- 后端 store 中的对象是本地事实源；前端按用途消费摘要、详情和本地资料 view。列表摘要与普通详情不返回 Web Session JSON 或代理地址；编辑弹窗通过独立 `local-profile` 接口按需读取。注册密码、CloakBrowser profile、Codex credential JSON 和运行环境密钥不得进入这些普通 view。
- 写操作成功后必须更新对应本地事实源，或返回已经更新的 view 供前端合并。
- 计数、标签、状态徽标等能从已有数组或关联对象派生的信息，不作为独立字段持久化。
- 运行时 JSON 文件是持久化介质，不是业务 API。不要通过手工编辑 JSON 执行管理动作。
- 运行数据目录固定使用 `0700`；包含 Web Session、Codex 凭证、账单、通知密钥或操作日志的文件固定使用 `0600`。
- curl_cffi worker 是通用 ChatGPT 请求转发能力。注册密码、GongXi-Mail、CloakBrowser、Mihomo、家宽代理和支付状态属于 GPT Account Manager，不是 Team Manager 账号业务模型字段。
- store 只接受并持久化当前 schema；不属于当前 schema 的输入字段不会写入事实源。
- GPT 账号基础字段统一为 `email` 和 `remark`。`email` 是账号名称和唯一可读身份；`remark` 是本系统本地备注。母号、子号和席位资料不得再使用 `label`、`note`、`displayName` 或 `name` 表示本地账号名称/备注。

## 母号模型

母号持久化对象为 `Account`。列表使用 `AccountSummaryView`，选中记录后读取 `AccountView` 详情，编辑本地资料时再读取 `AccountLocalProfileView`。母号首先表示一个 GPT 账号；通过 GAM 自动注册的母号可以暂时没有 Workspace，此时 `accountId` 保存个人账号上下文，`planType="free"`，Workspace 操作不可用。0.52 或双席位开通后，同一记录可以指向对应的可管理 Workspace。`refreshToken` 和指纹明文不下发。

### Canonical fields

| 字段 | 来源 | 说明 |
|---|---|---|
| `id` | team-manager | 内部 id，所有 UI/API 操作使用该 id 定位母号 |
| `managedAccountEmail` | Account Manager | 可选的规范化邮箱账号引用；手工录入且未受管的母号不设置 |
| `accountManagerHasPro5x` / `accountManagerPro5xCardLast4` / `accountManagerSyncedAt` | Account Manager 主动同步或业务操作校准 | 最近一次明确确认的个人 Pro 5x 状态、成功支付卡后四位和校准时间；卡尾号只取 GAM 安全摘要或成功支付记录，页面打开不触发读取 |
| `remark` | 本地输入 | 母号本地备注，不等同远端 Team 名称 |
| `groupName` | 本地输入 | 母号本地分组，缺省归入 `默认分组` |
| `limitType` | 本地输入 | 本地记录的额度窗口类型：`unknown`、`weekly`、`monthly` |
| `isBanned` | 本地输入 | 人工封号标记，独立于远端账号状态；缺省为 `false` |
| `accountId` | Session 或 `accounts/check` 解析结果 | 可以是个人账号上下文、0.52 usage-based workspace 或 Team workspace；远端操作使用该值作为 `chatgpt-account-id` 上下文 |
| `email` | session JSON | 母号 owner 邮箱 |
| `accessToken` / `refreshToken` | session JSON | 后端调用 ChatGPT Web backend-api 使用；`accessToken` 只通过 `AccountLocalProfileView.session` 按需回填，`refreshToken` 不下发 |
| `sessionToken` | session JSON | 用于后续按 workspace 通过 `/api/auth/session` 换取 Web access token；只通过 `AccountLocalProfileView.session` 按需回填 |
| `proxy` | 本地输入 | 母号独立代理地址，用于该母号 ChatGPT Web 请求和 workspace token 换取 |
| `workspaceName` | accounts/check 或远端改名结果 | 远端 Team workspace 名称 |
| `nextRenewalOn` | accounts/check 自动识别或本地输入 | Team 下次续费日期，格式为 `yyyy-mm-dd` |
| `planType` / `role` / `status` / `lastError` | refresh 结果 | 远端状态与错误摘要 |
| `hasTeamSubscription` | Workspace 同步或账单刷新 | 当前 Workspace 是否存在有效双席位 Team 月付订阅的缓存；有效 recurring upcoming invoice 为主信号，`planType="team"` 为兼容信号 |
| `membersCache` / `membersCachedAt` | 成员刷新或成员写操作 | 成员列表本地缓存 |
| `pendingInvitesCache` / `pendingInvitesCachedAt` | 邀请刷新或邀请写操作 | pending invite 本地缓存 |
| `lastMemberRemoval` | 成员移除响应 | 最近一次成功移除的成员、席位和时间，以及完整 `billing_notice` / `policy_notice` JSON 与已知字段摘要 |
| `defaultSeat` / `defaultSeatCachedAt` | settings 刷新或默认席位写操作 | 新成员默认席位缓存 |
| `workspaceReferralsEnabled` / `workspaceReferralsEnabledCachedAt` | settings 刷新或 Codex 邀请开关写操作 | “允许成员发送 Codex 邀请”缓存 |
| `workspaceReferralsEnabledVisible` | settings 刷新或 Codex 邀请开关写操作 | 远端是否展示该设置 |
| `personalAccessTokensEnabled` / `personalAccessTokensCachedAt` | settings 刷新或 beta feature 写操作 | “允许用户创建个人访问令牌”缓存 |
| `codexLocalAccessEnabled` / `codexLocalAccessCachedAt` | settings 刷新 | “允许成员使用 Codex Local”缓存，来自 `beta_settings.wham_local_access` |
| `codexDeviceCodeAuthEnabled` / `codexDeviceCodeAuthCachedAt` | settings 刷新或 beta feature 写操作 | “为 Codex CLI 启用设备代码身份验证”缓存 |
| `codexRemoteControlEnabled` / `codexRemoteControlCachedAt` | settings 刷新或 beta feature 写操作 | “允许成员远程发现并控制设备”缓存 |
| `automaticReloadEnabled` / `automaticReloadCachedAt` | Automatic reload 刷新或写操作 | Credits 自动补款开关缓存 |
| `seatSlots` | 本地输入或迁移 | 母号下客户席位位置资料，可关联 ChatGPT 或 Codex 席位，按 `seatKey` 定位 |

`AccountView` 与 `AccountSummaryView` 的 `hasTeamSubscription` 优先读取当前订阅缓存，并兼容 `planType="team"` 和账单缓存中的 recurring upcoming invoice。既有 usage-based Workspace 升级 Team 后，`accounts/check` 可能仍返回 `self_serve_business_usage_based`，不能再只依赖 `planType` 判断双席位。`canManageWorkspace` 仍从 `planType` 派生，仅在 `planType="free"` 时为 `false`。因此 0.52 usage-based 历史母号即使没有双席位或 GAM profile，也仍可使用成员、邀请、设置和账单操作。

母号的“同步 Workspace”不能由 `canManageWorkspace` 反向禁用。个人态记录需要通过该动作重新执行 `accounts/check`，发现唯一可管理的 owner/admin Workspace 后回写目标 `accountId`、Workspace Web access token、`planType`、角色和名称；已有 Workspace 在同步成员和邀请时并行读取当前 upcoming invoice，用有效 recurring subscription 更新 `hasTeamSubscription`。关联 GAM 的母号在同一次 Team Manager 请求中并行触发 Account Manager 账号同步，并把已确认的 Pro 5x 状态写入 `accountManagerHasPro5x`；GAM 同步失败不得抹掉本地已经确认的 Workspace 或 Pro 5x 状态。如果该账号仍有运行中或等待人工处理的 Workspace 开通任务，则跳过 GAM profile 同步，避免打断付款现场。`planType="self_serve_business_usage_based"` 本身就是 `hasCodexSpace` 的有效证据，不能只依赖付款操作成功状态。未发现候选时保持 `planType="free"`，将本次同步记为成功并清除旧错误，不请求成员、邀请或订阅接口；如果候选不唯一则拒绝猜测，并要求录入目标 Workspace session。所有依赖 Workspace 的 service 动作复用同一发现逻辑，避免 GAM 已确认开通但本地仍为 `free` 时形成不可恢复状态。

母号和子号详情是否允许发起 GAM 操作只由本地 `managedAccountEmail` 决定，不以页面当前是否读取到 GAM、GAM 是否刚好可达或是否存在临时状态对象为前提。上游请求失败由本次操作返回错误；不能把“未读取”解释为“未纳管”。

首页席位概览只为 `hasTeamSubscription=true` 且未标记封号的母号补足两个固定 ChatGPT 位置。封号母号仍展示实际存在的成员、邀请和已占用席位，但显式空 slot 与补足空位都不进入概览及其位置统计。usage-based Workspace 只展示实际存在的成员或邀请，不生成固定席位空位；`canManageWorkspace=true` 本身不代表存在席位容量。母号、子号和概览列表都显示统一封号标签，并把封号账号排在未封号账号之后。

### Seat slots

`membersCache[]` 中的成员显示名来自 ChatGPT 远端 `users[].name` 时，只能落到 `remoteName`。本地账号名称仍以 `email` 为准，不能把远端显示名复制成账号 `name`。

`seatSlots` 保存母号下已运营的本地客户席位位置，可关联 `default` 或 `usage_based` 远端席位。该资料的维度是“母号内部 id × 席位位置”，不是邮箱、invite id 或 user id。邮箱只是当前位置的占用者；邀请转成员、修改席位类型或换号后，`remark`、`expiresOn`、`price` 和 `seatKey` 继续属于同一个 slot。

| 字段 | 说明 |
|---|---|
| `seatKey` | 16 位随机字符，用于免登录席位页鉴权 |
| `email` | 当前绑定邮箱，可为空 |
| `remark` | 席位备注文本，可为空 |
| `expiresOn` | 到期日期，格式为 `yyyy-mm-dd` |
| `price` | 本地价格文本，可为空 |
| `seat` | 最近一次确认的远端席位类型：`default` 或 `usage_based` |
| `status` | 本地派生状态：`empty`、`invited`、`member`、`unknown` |
| `currentUserId` / `currentInviteId` | 最近一次同步到的远端成员或邀请 id |
| `expireRemove` | 到期移除标记，默认 `false` |
| `expireReminder` | 是否进入到期提醒，默认 `true` |
| `lastSwap` | 最近一次免登录换号任务状态和步骤 |
| `swapHistory` | 同一席位的免登录换号历史数组，按换号发生时间追加 |
| `updatedAt` | 本地更新时间 |

成员和邀请缓存只是可分别刷新的远端关系快照，不拥有客户席位资料。刷新任一列表时，如果能按规范化邮箱匹配关系，则更新 slot 的 `status`、远端 id 和 `seat`；邀请被接受后，同一 slot 从 `invited` 迁移为 `member`。如果当前可用快照暂时都找不到该邮箱，则保留完整 slot，将关系状态标记为 `unknown` 并清除已失效的远端 id，不得据此删除备注、到期时间、价格、换号历史或 `seatKey`。母号重新校准到不同 Workspace 时同样只清空远端关系缓存并把已有 slot 标记为 `unknown`，不得静默删除客户资料。只有显式删除客户席位资料的业务操作才可删除 slot。

免登录换号使用 `seatKey` 定位客户席位位置。已接受的 `default` 标准 ChatGPT 成员不得由公开入口自动移除；后端在任何 DELETE 前拒绝，前端同步禁用。空位、待处理邀请和 `usage_based` Codex 成员仍可换号。换号开始时写入一条 `SeatSlotSwapState` 到 `swapHistory`，流程中的同步、确认、移除、撤销、邀请、保存资料和最终状态写入步骤会更新同一条记录。`lastSwap` 保存最近一次，供列表和公开页快速展示当前进度；`swapHistory` 保留该席位的完整换号记录。store 会确保 `lastSwap` 同步存在于 `swapHistory`。

### Derived values

以下信息不得作为独立字段持久化：

- 成员数：从 `membersCache.length` 派生。
- 当前 ChatGPT 成员数：从 `membersCache[].seat === "default"` 派生。该值不是 Billing 计费席位数，不能包含已移除后仍临时计费的席位。
- pending invite 数：从 `pendingInvitesCache.length` 派生。
- 列表 item 上的成员/邀请数、ChatGPT 席位数、席位标签、状态标签和分组计数：生成 `AccountSummaryView` 时从 canonical cache 派生。

`AccountSummaryView.memberAndInviteCount` 和 `chatGptSeatUsageCount` 只是响应派生值，不进入 `Account` schema。历史 `memberCount`、`chatgptSeatCount`、`pendingInviteCount` 持久化字段应通过数据清洗删除。母号不保存 `label`、`note` 或本地 `name`，显示邮箱统一来自 `email`，备注统一来自 `remark`。

母号 session 录入规则：

- 后端先用输入 session 调用 `accounts/check`，只接受 `structure=workspace` 且角色为 `account-owner` 或 `account-admin` 的可管理 Workspace。
- 替换已有母号 session 时，如果新 session 仍可访问原 `accountId`，优先保留原 Workspace，只更新该 Workspace 的 Web access token。
- 新录入时，如果当前 session 指向某个可管理 Workspace，保存该 Workspace；如果只发现一个可管理 Workspace，保存该 Workspace；如果发现多个候选且无法自动判断目标，返回 409，禁止随机选择。
- 当目标 Workspace 与输入 session 的 `account.id` 不一致时，必须存在 `sessionToken`，后端通过 `/api/auth/session` 换取目标 Workspace Web access token 后再保存。

母号 backend-api 请求认证规则：

- `ChatGptApi` 是母号远端请求的统一封装。成员、邀请、设置、账单和改名等远端请求都通过该封装发送。
- 请求遇到 HTTP 401 且远端错误码为 `token_invalidated` 或 `token_revoked` 时，如果账号保存了 `sessionToken`，封装会换取目标 workspace 的新 Web access token，回写 token 并重试一次原请求。
- 权限不足、目标不存在等非认证失效错误不得被重试逻辑吞掉。

## 母号写操作规则

| 操作 | 后端写入规则 | 前端更新规则 |
|---|---|---|
| 邀请成员 | 只等待远端邀请提交；成功后按请求内容本地 upsert `pendingInvitesCache`，不再阻塞等待远端邀请列表 | 合并返回的母号 view |
| 编辑席位资料 | 按当前邮箱更新或创建对应 `seatSlots[]`，不调用 ChatGPT 远端 | 合并返回的母号 view |
| 免登录席位换号 | 按 `seatKey` 定位客户席位；禁止自动移除已接受的标准 ChatGPT 成员。其他流程在远端写成功后确定性更新本地成员/邀请缓存，不立即回读旧快照，保留 `remark`、`expiresOn`、`price`、`seatKey` 和历史记录 | 公开席位页使用返回的 slot view |
| 撤销邀请 | 远端撤销成功后从当前 `pendingInvitesCache` 确定性移除目标；没有本地缓存时保持未知，不用立即 GET 猜测结果 | 合并返回的母号 view |
| 移除成员 | 远端移除成功后从当前 `membersCache` 确定性移除目标，并保存 `lastMemberRemoval`；没有本地缓存时只保存移除结果 | 合并返回的母号 view 并展示计费策略结果 |
| 改成员席位 | 远端修改成功后把目标成员席位更新为请求值，不立即 GET；目标席位未变化时保存写前成员快照 | 合并返回的母号 view |
| 改成员角色 | 远端修改成功后把目标成员角色更新为请求值，不立即 GET；目标角色未变化时保存写前成员快照 | 合并返回的母号 view |
| 改默认席位 | 远端修改成功后更新 `defaultSeat` 和缓存时间 | 合并返回的母号 view |
| 改 Codex 邀请开关 | 远端修改成功后更新 `workspaceReferralsEnabled`、`workspaceReferralsEnabledVisible` 和缓存时间 | 合并返回的母号 view |
| 改个人访问令牌开关 | 远端修改成功后更新 `personalAccessTokensEnabled` 和缓存时间 | 合并返回的母号 view |
| 改 Codex 设备代码身份验证开关 | 远端修改成功后更新 `codexDeviceCodeAuthEnabled` 和缓存时间 | 合并返回的母号 view |
| 改 Codex 远程控制开关 | 远端修改成功后更新 `codexRemoteControlEnabled` 和缓存时间 | 合并返回的母号 view |
| 改 Automatic reload 开关 | 远端修改成功后更新 `automaticReloadEnabled` 和缓存时间；开启可能立即触发补款 | 合并返回的母号 view |
| 刷新账单 | 保存完整账单快照，并根据 recurring upcoming invoice 同步更新 `hasTeamSubscription` | 更新账单面板；后续列表和详情使用最新双席位状态 |
| 远端 Team 改名 | 远端修改成功后更新 `workspaceName` | 合并返回的母号 view |
| 编辑本地资料 | 更新 `remark`、`groupName`、`isBanned`、`limitType`、`nextRenewalOn` 和 `proxy`；提供 session JSON 时先按母号 session 录入规则解析 Team workspace，再更新 `email`、`accountId`、`accessToken`、workspace 元数据和可用的 `sessionToken`，并清空 `lastError` | 合并返回的母号 view，已保存 session 明文回填到 `session` 字段 |
| 自动注册母号 | 创建带母号用途标记的 Account Manager 注册操作；注册成功后立即保存 `managedAccountEmail` 与个人 Web Session，不触发支付 | 任务卡只展示账号注册；交付完成后立即替换为母号 view |
| 已有母号纳入 GAM | 优先把本地已有 `sessionToken` 与当前 Web Session 交给 Account Manager 建立独立浏览器身份；成功后只给原记录补写规范化 `managedAccountEmail`，不覆盖 Workspace、备注、分组、席位资料或成员邀请缓存 | 账号管理页展示导入进度；刷新后继续轮询同一操作，完成后原母号切换为 GAM 状态 |
| 开通 0.52 Workspace | 只把卡片请求转发给 Account Manager；成功状态由 GAM workspace 派生，不改变母号创建完成状态，也不把 0.52 workspace 当作 Team workspace | 展示独立后台操作状态；未受管或已开通账号的按钮禁用并说明原因 |
| 开通双席位 Team | 把优惠码、国家、货币和可选卡片转发给 Account Manager；成功后按 Team workspace ID 更新同一 GAM 母号记录 | 展示独立后台操作状态并刷新双席位状态；既有 usage-based Workspace 的管理能力不依赖该动作 |

邀请或升席位到 `default` 可能增加账单，普通席位写操作不增加二次确认。标准成员移除后还可能继续临时计费，service 必须记录上游策略结果，但不能用内部阈值自动判定后续邀请免费。任一席位类型邀请成功后，service 都会在同一次本地更新中为目标邮箱 upsert `pendingInvitesCache` 和 `seatSlots[]`。如果调用方未提供席位资料，到期日期默认为当前日期加 30 天，`expireRemove=false`，`expireReminder=true`。

远端写接口返回 2xx 后，成员/邀请缓存使用本次写入意图做确定性更新。不要在同一请求内立刻 GET 并把结果当作强一致事实；上游读后写延迟可能返回旧值，使受控组件回退。操作员显式刷新时才重新采信远端列表快照。

`expireRemove` 是本地运营标记，不会在提醒任务中自动移除远端成员。远端移除仍必须由页面、API 或 service 显式调用。

## 全局设置

全局设置持久化在 `data/app-settings.json`，不属于任何母号。`AppSettingsStore` 同时保存通知配置和跨浏览器任务表单偏好，旧的通知专用 JSON 会在读取时补齐默认表单偏好。

`taskFormPreferences` 包含以下服务端默认值：

| 字段 | 说明 |
|---|---|
| `parentRegistration.country` / `groupName` | 最近一次提交的母号自动注册国家和归属分组，默认 `US` / `默认分组` |
| `subaccountRegistration.country` / `groupName` | 最近一次提交的子号自动注册国家和归属分组，默认 `US` / `默认分组` |
| `pro5x.usePromoCode` / `promoCode` | 最近一次新建 Pro 5x 任务时提交的优惠码开关和值，默认 `true` / `stb` |

前端通过 `GET /api/settings/task-forms` 读取偏好。创建母号或子号注册任务、创建新的 Pro 5x 任务时，服务端先规范化并持久化本次表单值；补充旧 Pro 5x 任务卡片不覆盖优惠码偏好。

母号和子号的注册任务都按创建时持久化的 `groupName` 归属列表分组，只在对应分组或“所有”聚合视图中展示。任务表单弹窗使用 URL 查询参数 `modal` 和 `target` 持久化打开状态；轮询或列表数据刷新只能规范化仍然有效的路由，不能清除正在打开的弹窗。只有用户显式关闭，或 `target` 指向的业务对象已经不存在时，才能移除弹窗路由状态。

通知配置字段如下：

| 字段 | 说明 |
|---|---|
| `advanceReminderDays` | 提前提醒天数，默认 `3` |
| `triggerTime` | 每日本地触发时间，默认 `08:00` |
| `channels.webhook` | 通用 webhook，发送 JSON payload |
| `channels.feishu` | 飞书机器人 webhook |
| `channels.telegram` | Telegram bot token 和 chat id |
| `channels.wecom` | 企业微信机器人 webhook |
| `lastRunDate` / `lastRunAt` | 提醒任务最近一次运行标记 |

通知任务按 `triggerTime` 每天最多运行一次，分别收集以下两类项目：

- `team_renewal`：母号 `nextRenewalOn` 进入提醒窗口的 Team 续费项目。
- `seat_expiration`：`seatSlots` 中 `expireReminder=true` 且 `expiresOn` 进入提醒窗口的客户席位到期项目。

任一分类数量大于 `0` 时发送通知；两类都为 `0` 时不发送。通知文本固定展示“Team 续费”和“客户席位到期”两个分区及各自数量，零数量分区显示“无”。两类明细统一按“备注、邮箱、到期时间（剩余天数）”输出：Team 续费使用母号备注和母号邮箱，客户席位到期使用席位备注和当前绑定邮箱。关系状态和 `expireRemove` 保留在结构化明细中，不进入文本行。

通用 webhook payload 使用 `type=expiration_reminder`，同时返回 `itemCount`、`teamRenewalCount`、`seatExpirationCount`、格式化文本和明细数组。明细类型固定为 `team_renewal` 与 `seat_expiration`。

## 子号模型

子号持久化对象为 `Subaccount`。列表使用 `SubaccountSummaryView`，选中记录后读取 `SubaccountView` 详情，编辑本地资料时再读取 `SubaccountLocalProfileView`。Codex 凭证明文只在独立凭证文件和显式导出接口中出现。

### Canonical fields

| 字段 | 来源 | 说明 |
|---|---|---|
| `id` | team-manager | 内部 id |
| `email` | Session JSON 或 Account Manager 交付 | 子号邮箱 |
| `remark` | 本地输入 | 子号本地备注 |
| `groupName` | 本地输入 | 子号本地分组，缺省为 `默认分组`；与 Codex credential 的 CPA 号池分组无关 |
| `isBanned` | 本地输入 | 人工封号标记，独立于流程状态与 Session 可用性；缺省为 `false` |
| `chatgptAccountId` | session JSON | 子号自身 ChatGPT account id |
| `webAccessToken` | session JSON | 子号 ChatGPT Web access token；只通过 `SubaccountLocalProfileView.session` 按需回填 |
| `sessionToken` | session JSON | 用于按目标 workspace 通过 `/api/auth/session` 换取 Web access token；只通过 `SubaccountLocalProfileView.session` 按需回填 |
| `proxy` | 本地输入 | 子号独立代理地址，用于该子号 ChatGPT Web、PAT 创建和额度请求 |
| `sessionTokenStatus` / `sessionTokenCheckedAt` | Web 账号同步 | Session Cookie 最近一次通过 `/api/auth/session` 验证的结果和时间 |
| `webAccessTokenStatus` / `webAccessTokenCheckedAt` | Web 账号同步 | Web access token 最近一次通过 backend-api 验证的结果和时间 |
| `chatgptUserId`、`remoteUsername`、`remoteDisplayName`、`remotePictureUrl` | `/backend-api/me` 与 Calpico profile | 子号个人资料缓存 |
| `marketingPushEnabled` / `marketingEmailEnabled` | notifications settings | 子号个人营销通知缓存 |
| `memoryEnabled` | `account_user_setting?feature=m3m` 写操作 | 子号记忆开关最近一次明确修改结果；未修改前可为未知 |
| `rateLimitResetCredits` | `wham/rate-limit-reset-credits` | reset credits 明细、当前可用数、累计获得数和缓存时间 |
| `codexCredentials[]` | OAuth/PAT 创建结果 | 子号在某 Team workspace 下的 Codex 凭证元数据 |
| `managedAccountEmail` | Account Manager 交付 | 可选的规范化邮箱账号引用；手工录入且未受管的子号不设置 |
| `accountManagerHasPro5x` / `accountManagerPro5xCardLast4` / `accountManagerSyncedAt` | Account Manager 主动同步或业务操作校准 | 最近一次明确确认的个人 Pro 5x 状态、成功支付卡后四位和校准时间；列表与详情直接读取该本地缓存 |
| `pro5xSubscription` / `pro5xSubscriptionCheckedAt` | 子号主动同步 | 最近一次直接读取的 Pro 5x 订阅与续订状态；页面打开不触发读取 |
| `teamLinks[]` | 邀请/同步结果 | 子号与已录入母号的本地关系缓存 |
| `status` / `lastError` | 注册、OAuth、PAT 或同步流程 | 子号流程状态和错误摘要；账号锁定使用独立 `account_locked` 状态，不与待验证混用 |
| `createdAt` / `updatedAt` | store | 本地记录生命周期 |

### Codex credential

`SubaccountCodexCredential` 只在 `data/subaccounts.json` 保存元数据和额度缓存：

- `accountId`：凭证绑定的 Team workspace account id，来自 credential JSON 的 `account_id`。
- `fileName`：独立凭证文件名，文件位于 `data/subaccount-credentials/<subaccountId>/`。
- `groupName`：CPA 号池分组名，缺省为 `默认号池`。
- `planType`：OAuth token 或 PAT 创建响应对应的套餐摘要。
- 独立凭证文件固定使用 `auth_mode:"personalAccessToken"` 和 `credential_source:"personal_access_token"`。
- 创建 PAT 时，远端响应的 `workspace_id` 必须和用户选择的目标 workspace 一致；OAuth callback 换取的凭证 `account_id` 也必须与目标一致。不一致时拒绝保存，避免凭证和 Team 位置断链。
- `lastQuota` / `lastQuotaAt`：该 workspace 凭证的额度缓存。
- `lastCreatedAt`：该 workspace 当前 OAuth/PAT 凭证最近保存时间。

CPA/Codex OAuth/PAT 凭证明文 JSON 不写入 `subaccounts.json`，只写入独立凭证文件。普通列表和详情接口只返回 `SubaccountCodexCredentialView` 元数据；只有显式导出接口读取并返回目标凭证 JSON。

workspace key 以 `accountId` 为准。store 加载时接受 OAuth 与 PAT 两种 Codex 凭证，并兼容读取恢复功能删除前未标记 `auth_mode` / `credential_source` 的旧 OAuth 文件；其他无效凭证文件和元数据会被移除。

### Team links

`SubaccountTeamLink` 只保存：

| 字段 | 说明 |
|---|---|
| `accountId` | team-manager 母号内部 id |
| `seat` | 子号在该 Team 的席位缓存 |
| `status` | `invited`、`member`、`removed` 或 `unknown` |
| `updatedAt` | 本地更新时间 |

不要在 `teamLinks` 中复制母号备注名、远端 workspace id 或 Team 名称。前端展示时应从当前母号列表按 `accountId` 派生。

### Derived view fields

- `SubaccountSummaryView.hasWebSession` 和 `SubaccountView.hasWebSession` 是列表与详情展示用能力位；可编辑的 Web session 明文只在 `SubaccountLocalProfileView.session` 中按需返回。
- `SubaccountSummaryView.codexCredentialCount`、`teamLinkCount` 和搜索文本从当前 `SubaccountView` 派生，不持久化。
- `SubaccountView.managedAccountEmail` 只表示可选 Account Manager 关联，不复制 Account Manager 的密码、Profile 或支付状态。
- `SubaccountView.codexCredentials[].accountId` 用于展示和按 workspace 发起操作。
- `SubaccountView.codexCredentials[].fileName` 和 `groupName` 用于展示凭证独立文件名和所在 CPA 号池。
- 顶层 `hasCodexCredential`、`lastQuota` 和 `lastQuotaAt` 是冗余字段，不应出现在 view 或持久化数据中。

## 子号写操作规则

| 操作 | 后端写入规则 | 前端更新规则 |
|---|---|---|
| 录入 Web 登录态 | session JSON 对象写入或更新 `email`、`chatgptAccountId`、`webAccessToken`；如 session JSON 包含 `sessionToken`，同时写入 `sessionToken`；追加完整操作日志 | 合并返回的子号 view |
| 自动注册子号 | Team Manager 向 GPT Account Manager 创建持久化账号操作；成功后按邮箱取得 Web Session，幂等写入 `email` 和 `managedAccountEmail`，再清理完成操作 | 立即显示任务项并轮询进度；刷新页面继续读取同一操作；完成后替换为正常子号 view |
| 编辑本地资料 | 更新 `remark`、顶层 `groupName`、`isBanned` 和 `proxy`；提供 session JSON 时更新 `email`、`chatgptAccountId`、`webAccessToken` 和可用的 `sessionToken`；保留 Codex 凭证、Team 关联和日志 | 合并返回的子号 view |
| 同步 Web 账号 | 验证 `sessionToken`，回写新 `webAccessToken`，调用 `/backend-api/me`、个人 profile、notifications settings 和 reset credits；显式同步 GAM 与 Pro 5x 订阅并持久化 `accountManagerHasPro5x`、订阅状态和缓存时间；分别持久化 Cookie/AT 状态、个人资料、设置缓存、错误和完整日志 | 合并返回的子号 view；刷新后状态不丢失 |
| 修改子号个人资料或常用设置 | 通过统一 `ChatGptApi` 修改用户名、显示名、营销 Push/Email 或记忆，成功后更新对应缓存 | 合并返回的子号 view |
| 创建 PAT | 用子号 Web Session 在目标 workspace 调用 `wham/auth-credentials`；远端 `workspace_id` 和目标一致时，返回的 `at-...` token 写入独立凭证文件，并按目标 workspace upsert `codexCredentials[]` 元数据 | 合并返回的子号 view |
| OAuth 授权 | 创建 authorization-code + PKCE 会话；接收 localhost callback 后交换 token，校验凭证 `account_id`，写入同一 workspace 的独立凭证文件 | 合并返回的子号 view |
| 刷新额度 | 只更新目标 workspace 凭证的 `lastQuota` / `lastQuotaAt` | 更新对应子号 view |
| 邀请加入母号 | `isBanned=true` 时在任何 Team Manager 邀请入口拒绝请求；否则远端邀请成功后写入 `teamLinks[].status = "invited"`，不做账单风险预检 | 合并返回的子号 view |
| 同步 Team 关联 | 只用子号 `accounts/check` 读取可见 workspace；保留已有 link 的席位类型，新 link 使用 `usage_based`，汇总后一次落盘 | 合并返回的子号 view |

## 本地资料编辑 API

母号读取本地资料：

```http
GET /api/accounts/:id/local-profile
```

母号写入本地资料：

```http
PATCH /api/accounts/:id/local-profile
Content-Type: application/json

{
  "remark": "本地备注",
  "groupName": "自用",
  "limitType": "monthly",
  "nextRenewalOn": "2026-07-16",
  "proxy": "<proxy-url>",
  "session": {
    "user": { "email": "owner@example.com" },
    "account": { "id": "<workspace-account-id>" },
    "accessToken": "<JWT>",
    "sessionToken": "<next-auth session token>"
  }
}
```

子号读取本地资料：

```http
GET /api/subaccounts/:id/local-profile
```

子号写入本地资料：

```http
PATCH /api/subaccounts/:id/local-profile
Content-Type: application/json

{
  "remark": "本地备注",
  "groupName": "客户 A",
  "proxy": "<proxy-url>",
  "session": {
    "user": { "email": "child@example.com" },
    "account": { "id": "<chatgpt-account-id>" },
    "accessToken": "<JWT>",
    "sessionToken": "<next-auth session token>"
  }
}
```

PATCH 请求中的 `session`、`proxy` 都可省略。母号与子号各自的顶层 `groupName` 为空时归入 `默认分组`；子号 `codexCredentials[].groupName` 仍表示 CPA 号池，缺省为 `默认号池`。`remark` 可为空，`limitType` 只能是 `unknown`、`weekly` 或 `monthly`，`nextRenewalOn` 为空或格式为 `yyyy-mm-dd`。母号和子号接口都不接受 `label` 或 `note` 字段；GPT 账号显示名称统一来自 `email`，本地备注统一来自 `remark`。编辑弹窗先读取对应 GET 接口，用返回的分组、`session` 和 `proxy` 回填表单。

Codex 凭证支持 OAuth authorization-code + PKCE 和 PAT。两种凭证都按目标 Team workspace 保存，同一 workspace 后保存的凭证覆盖前一份。

## rrweb 调试录制

开发模式前端可使用 rrweb 录制页面状态和交互。停止录制后通过 `POST /api/devtools/rrweb-recordings` 上报，服务端生成 UUID，并将内容压缩保存为 `data/rrweb-recordings/<uuid>.json.gz`。目录权限固定为 `0700`，文件权限固定为 `0600`。

单条录制的未压缩 JSON 上限为 25 MB。文件保留 30 天，store 初始化或写入新录制时清理过期文件。`GET /api/devtools/rrweb-recordings/:uuid` 需要管理端鉴权，并返回解压后的录制内容。录制可能包含页面可见信息，只能作为私有运行数据处理，不得复制到源码仓库或项目文档。
