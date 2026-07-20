# 数据模型与本地缓存规则

本文件定义 team-manager 的本地数据模型边界。目标是避免操作成功后 UI、运行时 JSON、缓存和列表项之间出现重复、冗余或断链。

## 总原则

- 后端 store 中的对象是本地事实源；前端消费后端返回的 view。可信管理后台 view 可回填账号 Web Session JSON 和代理地址；注册密码、CloakBrowser profile、Codex credential JSON 和运行环境密钥不得进入普通 view。
- 写操作成功后必须更新对应本地事实源，或返回已经更新的 view 供前端合并。
- 计数、标签、状态徽标等能从已有数组或关联对象派生的信息，不作为独立字段持久化。
- 运行时 JSON 文件是持久化介质，不是业务 API。不要通过手工编辑 JSON 执行管理动作。
- 运行数据目录固定使用 `0700`；包含 Web Session、PAT、账单、通知密钥或操作日志的文件固定使用 `0600`。
- curl_cffi worker 是通用 ChatGPT 请求转发能力。注册密码、GongXi-Mail、CloakBrowser、Mihomo、家宽代理和支付状态属于 GPT Account Manager，不是 Team Manager 账号业务模型字段。
- store 只接受并持久化当前 schema；不属于当前 schema 的输入字段不会写入事实源。
- GPT 账号基础字段统一为 `email` 和 `remark`。`email` 是账号名称和唯一可读身份；`remark` 是本系统本地备注。母号、子号和席位资料不得再使用 `label`、`note`、`displayName` 或 `name` 表示本地账号名称/备注。

## 母号模型

母号持久化对象为 `Account`，前端使用 `AccountView`。管理后台可信，`AccountView.session` 会回填本地保存的 Web session JSON；`refreshToken` 和指纹明文不下发。

### Canonical fields

| 字段 | 来源 | 说明 |
|---|---|---|
| `id` | team-manager | 内部 id，所有 UI/API 操作使用该 id 定位母号 |
| `remark` | 本地输入 | 母号本地备注，不等同远端 Team 名称 |
| `groupName` | 本地输入 | 母号本地分组，缺省归入 `默认分组` |
| `limitType` | 本地输入 | 本地记录的额度窗口类型：`unknown`、`weekly`、`monthly` |
| `accountId` | `accounts/check` 解析结果 | ChatGPT Team workspace account id，用于 `chatgpt-account-id` 上下文；母号录入和替换 session 时不得直接信任输入 JSON 的 `account.id` |
| `email` | session JSON | 母号 owner 邮箱 |
| `accessToken` / `refreshToken` | session JSON | 后端调用 ChatGPT Web backend-api 使用；`accessToken` 通过 `AccountView.session` 回填给管理后台，`refreshToken` 不下发 |
| `sessionToken` | session JSON | 用于后续按 workspace 通过 `/api/auth/session` 换取 Web access token；通过 `AccountView.session` 回填给管理后台 |
| `proxy` | 本地输入 | 母号独立代理地址，用于该母号 ChatGPT Web 请求和 workspace token 换取 |
| `workspaceName` | accounts/check 或远端改名结果 | 远端 Team workspace 名称 |
| `nextRenewalOn` | accounts/check 自动识别或本地输入 | Team 下次续费日期，格式为 `yyyy-mm-dd` |
| `planType` / `role` / `status` / `lastError` | refresh 结果 | 远端状态与错误摘要 |
| `membersCache` / `membersCachedAt` | 成员刷新或成员写操作 | 成员列表本地缓存 |
| `pendingInvitesCache` / `pendingInvitesCachedAt` | 邀请刷新或邀请写操作 | pending invite 本地缓存 |
| `defaultSeat` / `defaultSeatCachedAt` | settings 刷新或默认席位写操作 | 新成员默认席位缓存 |
| `workspaceReferralsEnabled` / `workspaceReferralsEnabledCachedAt` | settings 刷新或 Codex 邀请开关写操作 | “允许成员发送 Codex 邀请”缓存 |
| `workspaceReferralsEnabledVisible` | settings 刷新或 Codex 邀请开关写操作 | 远端是否展示该设置 |
| `personalAccessTokensEnabled` / `personalAccessTokensCachedAt` | settings 刷新或 beta feature 写操作 | “允许用户创建个人访问令牌”缓存 |
| `codexLocalAccessEnabled` / `codexLocalAccessCachedAt` | settings 刷新 | “允许成员使用 Codex Local”缓存，来自 `beta_settings.wham_local_access` |
| `codexDeviceCodeAuthEnabled` / `codexDeviceCodeAuthCachedAt` | settings 刷新或 beta feature 写操作 | “为 Codex CLI 启用设备代码身份验证”缓存 |
| `codexRemoteControlEnabled` / `codexRemoteControlCachedAt` | settings 刷新或 beta feature 写操作 | “允许成员远程发现并控制设备”缓存 |
| `seatSlots` | 本地输入或迁移 | 母号下 ChatGPT 固定席位位置资料，按 `seatKey` 定位 |

### Seat slots

`membersCache[]` 中的成员显示名来自 ChatGPT 远端 `users[].name` 时，只能落到 `remoteName`。本地账号名称仍以 `email` 为准，不能把远端显示名复制成账号 `name`。

`seatSlots` 保存母号下已运营的 ChatGPT 固定席位位置。该资料的维度是“母号内部 id × 席位位置”，不是邮箱、invite id 或 user id。邮箱只是当前位置的占用者，换号后 `remark`、`expiresOn`、`price` 和 `seatKey` 继续属于同一个 slot。

| 字段 | 说明 |
|---|---|
| `seatKey` | 16 位随机字符，用于免登录席位页鉴权 |
| `email` | 当前绑定邮箱，可为空 |
| `remark` | 席位备注文本，可为空 |
| `expiresOn` | 到期日期，格式为 `yyyy-mm-dd` |
| `price` | 本地价格文本，可为空 |
| `seat` | 固定为 `default`，只表示 ChatGPT 固定席位 |
| `status` | 本地派生状态：`empty`、`invited`、`member`、`unknown` |
| `currentUserId` / `currentInviteId` | 最近一次同步到的远端成员或邀请 id |
| `expireRemove` | 到期移除标记，默认 `false` |
| `expireReminder` | 是否进入到期提醒，默认 `true` |
| `lastSwap` | 最近一次免登录换号任务状态和步骤 |
| `swapHistory` | 同一席位的免登录换号历史数组，按换号发生时间追加 |
| `updatedAt` | 本地更新时间 |

`seatSlots` 不表示 `usage_based` / Codex 席位。`usage_based` 邀请不会创建 slot。

免登录换号使用 `seatKey` 定位固定席位位置。换号开始时写入一条 `SeatSlotSwapState` 到 `swapHistory`，流程中的同步、确认、移除、撤销、邀请、保存资料和最终刷新步骤会更新同一条记录。`lastSwap` 保存最近一次，供列表和公开页快速展示当前进度；`swapHistory` 保留该席位的完整换号记录。store 会确保 `lastSwap` 同步存在于 `swapHistory`。

### Derived values

以下信息不得作为独立字段持久化：

- 成员数：从 `membersCache.length` 派生。
- ChatGPT 席位数：从 `membersCache[].seat === "default"` 派生。
- pending invite 数：从 `pendingInvitesCache.length` 派生。
- 列表 item 上的席位标签、状态标签和分组计数：从当前 `AccountView` 派生。

`memberCount`、`chatgptSeatCount`、`pendingInviteCount` 不属于 `Account` schema，应通过数据清洗删除。母号不保存 `label`、`note` 或本地 `name`，显示邮箱统一来自 `email`，备注统一来自 `remark`。

母号 session 录入规则：

- 后端先用输入 session 调用 `accounts/check`，只接受 `structure=workspace` 且角色为 `account-owner` 或 `account-admin` 的 Team workspace。
- 替换已有母号 session 时，如果新 session 仍可访问原 `accountId`，优先保留原 Team workspace，只更新该 workspace 的 Web access token。
- 新录入时，如果当前 session 指向某个可管理 Team workspace，保存该 workspace；如果只发现一个可管理 Team workspace，保存该 workspace；如果发现多个候选且无法自动判断目标，返回 409，禁止随机选择。
- 当目标 Team workspace 与输入 session 的 `account.id` 不一致时，必须存在 `sessionToken`，后端通过 `/api/auth/session` 换取目标 workspace Web access token 后再保存。

母号 backend-api 请求认证规则：

- `ChatGptApi` 是母号远端请求的统一封装。成员、邀请、设置、账单和改名等远端请求都通过该封装发送。
- 请求遇到 HTTP 401 且远端错误码为 `token_invalidated` 或 `token_revoked` 时，如果账号保存了 `sessionToken`，封装会换取目标 workspace 的新 Web access token，回写 token 并重试一次原请求。
- 权限不足、目标不存在、账单风险确认等非认证失效错误不得被重试逻辑吞掉。

## 母号写操作规则

| 操作 | 后端写入规则 | 前端更新规则 |
|---|---|---|
| 邀请成员 | 远端邀请成功后刷新 `pendingInvitesCache`，返回 `AccountView` | 合并返回的母号 view |
| 编辑席位资料 | 按当前邮箱更新或创建对应 `seatSlots[]`，不调用 ChatGPT 远端 | 合并返回的母号 view |
| 免登录席位换号 | 按 `seatKey` 定位固定席位，刷新母号成员/邀请后只移除或撤销该 slot 当前邮箱，再邀请新邮箱为 `default`，保留 `remark`、`expiresOn`、`price`、`seatKey` 和历史记录 | 公开席位页重新读取返回的 slot view |
| 撤销邀请 | 远端撤销成功后刷新 `pendingInvitesCache`，返回 `AccountView` | 合并返回的母号 view |
| 移除成员 | 远端移除成功后刷新 `membersCache`，返回 `AccountView` | 合并返回的母号 view |
| 改成员席位 | 远端修改成功后刷新 `membersCache`；目标席位未变化时也保存当前成员缓存 | 合并返回的母号 view |
| 改默认席位 | 远端修改成功后更新 `defaultSeat` 和缓存时间 | 合并返回的母号 view |
| 改 Codex 邀请开关 | 远端修改成功后更新 `workspaceReferralsEnabled`、`workspaceReferralsEnabledVisible` 和缓存时间 | 合并返回的母号 view |
| 改个人访问令牌开关 | 远端修改成功后更新 `personalAccessTokensEnabled` 和缓存时间 | 合并返回的母号 view |
| 改 Codex 设备代码身份验证开关 | 远端修改成功后更新 `codexDeviceCodeAuthEnabled` 和缓存时间 | 合并返回的母号 view |
| 改 Codex 远程控制开关 | 远端修改成功后更新 `codexRemoteControlEnabled` 和缓存时间 | 合并返回的母号 view |
| 远端 Team 改名 | 远端修改成功后更新 `workspaceName` | 合并返回的母号 view |
| 编辑本地资料 | 更新 `remark`、`groupName`、`limitType`、`nextRenewalOn` 和 `proxy`；提供 session JSON 时先按母号 session 录入规则解析 Team workspace，再更新 `email`、`accountId`、`accessToken`、workspace 元数据和可用的 `sessionToken`，并清空 `lastError` | 合并返回的母号 view，已保存 session 明文回填到 `session` 字段 |

邀请或升席位到 `default` 可能增加账单。service 层必须先进行账单风险检查，风险存在时返回 HTTP 409；调用方只有显式传 `confirmBillingRisk:true` 才能继续。`default` 邀请成功后，service 会为目标邮箱 upsert 一个 `seatSlots[]` 条目。`usage_based` 邀请不创建 slot。如果调用方未提供席位资料，到期日期默认为当前日期加 30 天，`expireRemove=false`，`expireReminder=true`。

`expireRemove` 是本地运营标记，不会在提醒任务中自动移除远端成员。远端移除仍必须由页面、API 或 service 显式调用。

## 全局通知设置

全局通知设置持久化在 `data/app-settings.json`，不属于任何母号。当前模型只保存到期提醒所需配置：

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

子号持久化对象为 `Subaccount`，前端使用 `SubaccountView`。管理后台可信，`SubaccountView.session` 会回填本地保存的 Web session JSON；Codex 凭证明文只在独立凭证文件和显式导出接口中出现。

### Canonical fields

| 字段 | 来源 | 说明 |
|---|---|---|
| `id` | team-manager | 内部 id |
| `email` | Session JSON 或 Account Manager 交付 | 子号邮箱 |
| `remark` | 本地输入 | 子号本地备注 |
| `groupName` | 本地输入 | 子号本地分组，缺省为 `默认分组`；与 Codex credential 的 CPA 号池分组无关 |
| `chatgptAccountId` | session JSON | 子号自身 ChatGPT account id |
| `webAccessToken` | session JSON | 子号 ChatGPT Web access token；通过 `SubaccountView.session` 回填给管理后台 |
| `sessionToken` | session JSON | 用于按目标 workspace 通过 `/api/auth/session` 换取 Web access token；通过 `SubaccountView.session` 回填给管理后台 |
| `proxy` | 本地输入 | 子号独立代理地址，用于该子号 ChatGPT Web、PAT 创建和额度请求 |
| `sessionTokenStatus` / `sessionTokenCheckedAt` | Web 账号同步 | Session Cookie 最近一次通过 `/api/auth/session` 验证的结果和时间 |
| `webAccessTokenStatus` / `webAccessTokenCheckedAt` | Web 账号同步 | Web access token 最近一次通过 backend-api 验证的结果和时间 |
| `chatgptUserId`、`remoteUsername`、`remoteDisplayName`、`remotePictureUrl` | `/backend-api/me` 与 Calpico profile | 子号个人资料缓存 |
| `marketingPushEnabled` / `marketingEmailEnabled` | notifications settings | 子号个人营销通知缓存 |
| `memoryEnabled` | `account_user_setting?feature=m3m` 写操作 | 子号记忆开关最近一次明确修改结果；未修改前可为未知 |
| `rateLimitResetCredits` | `wham/rate-limit-reset-credits` | reset credits 明细、当前可用数、累计获得数和缓存时间 |
| `codexCredentials[]` | PAT 创建结果 | 子号在某 Team workspace 下的 PAT 凭证元数据 |
| `managedAccountEmail` | Account Manager 交付 | 可选的规范化邮箱账号引用；手工录入且未受管的子号不设置 |
| `teamLinks[]` | 邀请/同步结果 | 子号与已录入母号的本地关系缓存 |
| `status` / `lastError` | 注册、PAT 或同步流程 | 子号流程状态和错误摘要；账号锁定使用独立 `account_locked` 状态，不与待验证混用 |
| `createdAt` / `updatedAt` | store | 本地记录生命周期 |

### Codex credential

`SubaccountCodexCredential` 只在 `data/subaccounts.json` 保存元数据和额度缓存：

- `accountId`：凭证绑定的 Team workspace account id，来自 credential JSON 的 `account_id`。
- `fileName`：独立凭证文件名，文件位于 `data/subaccount-credentials/<subaccountId>/`。
- `groupName`：CPA 号池分组名，缺省为 `默认号池`。
- `planType`：PAT 创建响应对应的套餐摘要。
- 独立凭证文件固定使用 `auth_mode:"personalAccessToken"` 和 `credential_source:"personal_access_token"`。
- 创建 PAT 时，远端响应的 `workspace_id` 必须和用户选择的目标 workspace 一致；不一致时拒绝保存，避免凭证和 Team 位置断链。
- `lastQuota` / `lastQuotaAt`：该 workspace 凭证的额度缓存。
- `lastCreatedAt`：该 workspace PAT 最近创建时间。

CPA/Codex PAT 凭证明文 JSON 不写入 `subaccounts.json`，只写入独立凭证文件。普通列表和详情接口只返回 `SubaccountCodexCredentialView` 元数据；只有显式导出接口读取并返回目标凭证 JSON。

workspace key 以 `accountId` 为准。store 加载时只接受 PAT 文件，其他凭证文件和元数据会被移除。

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

- `SubaccountView.hasWebSession` 是列表和详情展示用能力位；可编辑的 Web session 明文放在 `SubaccountView.session`。
- `SubaccountView.managedAccountEmail` 只表示可选 Account Manager 关联，不复制 Account Manager 的密码、Profile 或支付状态。
- `SubaccountView.codexCredentials[].accountId` 用于展示和按 workspace 发起操作。
- `SubaccountView.codexCredentials[].fileName` 和 `groupName` 用于展示凭证独立文件名和所在 CPA 号池。
- 顶层 `hasCodexCredential`、`lastQuota` 和 `lastQuotaAt` 是冗余字段，不应出现在 view 或持久化数据中。

## 子号写操作规则

| 操作 | 后端写入规则 | 前端更新规则 |
|---|---|---|
| 录入 Web 登录态 | session JSON 对象写入或更新 `email`、`chatgptAccountId`、`webAccessToken`；如 session JSON 包含 `sessionToken`，同时写入 `sessionToken`；追加完整操作日志 | 合并返回的子号 view |
| 自动注册子号 | Team Manager 向 GPT Account Manager 创建持久化账号操作；成功后按邮箱取得 Web Session，幂等写入 `email` 和 `managedAccountEmail`，再清理完成操作 | 立即显示任务项并轮询进度；刷新页面继续读取同一操作；完成后替换为正常子号 view |
| 编辑本地资料 | 更新 `remark`、顶层 `groupName` 和 `proxy`；提供 session JSON 时更新 `email`、`chatgptAccountId`、`webAccessToken` 和可用的 `sessionToken`；保留 Codex 凭证、Team 关联和日志 | 合并返回的子号 view |
| 同步 Web 账号 | 验证 `sessionToken`，回写新 `webAccessToken`，调用 `/backend-api/me`、个人 profile、notifications settings 和 reset credits；分别持久化 Cookie/AT 状态、个人资料、设置缓存、错误和完整日志 | 合并返回的子号 view；刷新后状态不丢失 |
| 修改子号个人资料或常用设置 | 通过统一 `ChatGptApi` 修改用户名、显示名、营销 Push/Email 或记忆，成功后更新对应缓存 | 合并返回的子号 view |
| 创建 PAT | 用子号 Web Session 在目标 workspace 调用 `wham/auth-credentials`；远端 `workspace_id` 和目标一致时，返回的 `at-...` token 写入独立凭证文件，并按目标 workspace upsert `codexCredentials[]` 元数据 | 合并返回的子号 view |
| 刷新额度 | 只更新目标 workspace 凭证的 `lastQuota` / `lastQuotaAt` | 更新对应子号 view |
| 邀请加入母号 | 远端邀请成功后写入 `teamLinks[].status = "invited"`，账单风险沿用母号邀请规则 | 合并返回的子号 view |
| 同步 Team 关联 | 用子号 `accounts/check` 找可见 workspace，再用子号 Web session 查询匹配 workspace 的 users 列表读取自己的 `seat_type` | 合并返回的子号 view |

## 本地资料编辑 API

母号：

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

子号：

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

母号和子号的 `session`、`proxy` 都可省略。母号与子号各自的顶层 `groupName` 为空时归入 `默认分组`；子号 `codexCredentials[].groupName` 仍表示 CPA 号池，缺省为 `默认号池`。`remark` 可为空，`limitType` 只能是 `unknown`、`weekly` 或 `monthly`，`nextRenewalOn` 为空或格式为 `yyyy-mm-dd`。母号和子号接口都不接受 `label` 或 `note` 字段；GPT 账号显示名称统一来自 `email`，本地备注统一来自 `remark`。响应 view 会返回已保存的分组、`session` 和 `proxy`，用于管理后台本地资料编辑回填。

Codex 凭证只有 PAT，由当前子号 Web Session 针对目标 Team workspace 创建。
