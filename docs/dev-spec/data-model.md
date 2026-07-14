# 数据模型与本地缓存规则

本文件定义 team-manager 的本地数据模型边界。目标是避免操作成功后 UI、运行时 JSON、缓存和列表项之间出现重复、冗余或断链。

## 总原则

- 后端 store 中的对象是本地事实源；前端消费后端返回的 view。管理后台 view 可回填账号 Web session JSON 和代理地址；Codex credential JSON、注册密码和运行环境密钥仍不得进入普通 view。
- 写操作成功后必须更新对应本地事实源，或返回已经更新的 view 供前端合并。
- 计数、标签、状态徽标等能从已有数组或关联对象派生的信息，不作为独立字段持久化。
- 运行时 JSON 文件是持久化介质，不是业务 API。不要通过手工编辑 JSON 执行管理动作。
- curl_cffi worker、GongXi-Mail、短信接码和授权页面 clearance 属于运行环境能力，不是账号业务模型字段；后端只暴露脱敏可用状态，前端只读展示。
- store 只按当前 schema 持久化对象；历史冗余字段应通过离线数据清洗删除，不在业务代码中做兼容映射。
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

旧版 `memberProfiles` 不是 canonical 字段。store 加载旧数据时会把其中尚未对应现有 slot 的资料迁移为 `seatSlots`，随后删除 `memberProfiles`；前后端类型、API 和 view 不再暴露该旧模型。

免登录换号使用 `seatKey` 定位固定席位位置。换号开始时写入一条 `SeatSlotSwapState` 到 `swapHistory`，流程中的同步、确认、移除、撤销、邀请、保存资料和最终刷新步骤会更新同一条历史记录。`lastSwap` 只保存最近一次，供列表和公开页快速展示当前进度；`swapHistory` 保留该席位的完整换号历史。store 初始化清洗时，旧数据中的 `lastSwap` 会并入 `swapHistory`。

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
- 请求遇到 HTTP 401 且远端错误码为 `token_invalidated` 时，如果母号保存了 `sessionToken`，封装会换取目标 Team workspace 的新 Web access token，回写 `accessToken` 并重试一次原请求。
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

通用 webhook payload 使用 `type=expiration_reminder`，同时返回 `itemCount`、`teamRenewalCount`、`seatExpirationCount`、格式化文本和明细数组。明细类型只使用 `team_renewal` 与 `seat_expiration`，不再使用旧的 member expiration 命名。

## 子号模型

子号持久化对象为 `Subaccount`，前端使用 `SubaccountView`。管理后台可信，`SubaccountView.session` 会回填本地保存的 Web session JSON；Codex 凭证明文只在独立凭证文件和显式导出接口中出现。

### Canonical fields

| 字段 | 来源 | 说明 |
|---|---|---|
| `id` | team-manager | 内部 id |
| `email` | session JSON、注册结果或 Codex credential | 子号邮箱 |
| `remark` | 本地输入 | 子号本地备注 |
| `chatgptAccountId` | session JSON | 子号自身 ChatGPT account id |
| `webAccessToken` | session JSON | 子号 ChatGPT Web access token；通过 `SubaccountView.session` 回填给管理后台 |
| `sessionToken` | session JSON | 用于按目标 workspace 通过 `/api/auth/session` 换取 Web access token；通过 `SubaccountView.session` 回填给管理后台 |
| `proxy` | 本地输入 | 子号独立代理地址，用于该子号 ChatGPT Web、PAT/K12 凭证创建和额度请求 |
| `codexCredentials[]` | Codex OAuth token exchange 或已有 CPA/Codex auth JSON | 子号在某 Team workspace 下的 Codex 凭证元数据 |
| `registrationPassword` / `registeredAt` / `registrationSource` | 自动注册结果 | OpenAI 注册密码和来源元数据，仅后端持久化，不下发前端 |
| `teamLinks[]` | 邀请/同步结果 | 子号与已录入母号的本地关系缓存 |
| `status` / `lastError` | 授权或同步流程 | 子号流程状态和错误摘要；账号锁定使用独立 `account_locked` 状态，不与待验证混用 |
| `createdAt` / `updatedAt` | store | 本地记录生命周期 |

### Codex credential

`SubaccountCodexCredential` 只在 `data/subaccounts.json` 保存元数据和额度缓存：

- `accountId`：凭证绑定的 Team workspace account id，来自 credential JSON 的 `account_id`。
- `fileName`：独立凭证文件名，文件位于 `data/subaccount-credentials/<subaccountId>/`。
- `groupName`：CPA 号池分组名，缺省为 `默认号池`。
- `planType`：导入或授权时凭证里的 `plan_type` 摘要。
- `auth_mode` / `credential_source`：独立凭证文件内的敏感 JSON 可记录凭证来源。OAuth 凭证通常有 `refresh_token` 和 `id_token`；Codex 个人访问令牌凭证使用 `auth_mode:"personalAccessToken"` 和 `credential_source:"personal_access_token"`，可以没有 `refresh_token` / `id_token`。
- `issued_account_id`：仅写入独立凭证 JSON。创建个人访问令牌时，远端响应的 `workspace_id` 必须和用户选择的目标 workspace 一致；不一致时拒绝保存，避免凭证和 Team 位置断链。
- `lastQuota` / `lastQuotaAt`：该 workspace 凭证的额度缓存。
- `lastAuthAt`：该 workspace 凭证最近授权时间。

CPA/Codex 兼容凭证明文 JSON 不写入 `subaccounts.json`，只写入独立凭证文件。普通列表和详情接口只返回 `SubaccountCodexCredentialView` 元数据；只有显式导出接口读取并返回目标凭证 JSON。

workspace key 以 `accountId` 为准。旧数据中的内嵌 `credential` 会在 store 初始化时迁移到独立文件，并从 `subaccounts.json` 中移除。

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
- `SubaccountView.codexCredentials[].accountId` 用于展示和按 workspace 发起操作。
- `SubaccountView.codexCredentials[].fileName` 和 `groupName` 用于展示凭证独立文件名和所在 CPA 号池。
- 顶层 `hasCodexCredential`、`lastQuota`、`lastQuotaAt`、`lastAuthAt` 是冗余字段，不应出现在 view 或持久化数据中。

## 子号写操作规则

| 操作 | 后端写入规则 | 前端更新规则 |
|---|---|---|
| 导入 Web 登录态 | session JSON 对象写入或更新 `email`、`chatgptAccountId`、`webAccessToken`；如 session JSON 包含 `sessionToken`，同时写入 `sessionToken`；追加脱敏日志 | 合并返回的子号 view |
| 导入已有 Codex credential | 按 `credential.email` 创建或更新子号；不写入 `webAccessToken`；凭证 JSON 写入独立文件，按 `credential.account_id` upsert `codexCredentials[]` 元数据 | 合并返回的子号 view |
| 自动注册子号 | 通过 worker 申请邮箱并注册 OpenAI 账号；写入 `email`、`registrationPassword`、`registeredAt`、`registrationSource`；如授权成功则写入独立凭证文件并 upsert `codexCredentials[]` 元数据 | 合并返回的子号 view，密码不下发 |
| 编辑本地资料 | 更新 `remark` 和 `proxy`；提供 session JSON 时更新 `email`、`chatgptAccountId`、`webAccessToken` 和可用的 `sessionToken`；保留 Codex 凭证、Team 关联和日志 | 合并返回的子号 view |
| Codex 授权成功 | 凭证 JSON 写入独立文件，按 `credential.account_id` upsert `codexCredentials[]` 元数据，更新状态和日志 | 合并返回的子号 view 或重新拉取 |
| 创建 Codex 个人访问令牌 | 用子号 Web Session 在目标 workspace 调用 `wham/auth-credentials`；远端 `workspace_id` 和目标一致时，返回的 `at-...` token 写入独立凭证文件，并按目标 workspace upsert `codexCredentials[]` 元数据 | 合并返回的子号 view |
| 刷新额度 | 只更新目标 workspace 凭证的 `lastQuota` / `lastQuotaAt` | 更新对应子号 view |
| 邀请加入母号 | 远端邀请成功后写入 `teamLinks[].status = "invited"`，账单风险沿用母号邀请规则 | 合并返回的子号 view |
| 同步 Team 关联 | 有 Web session 时先用子号 `accounts/check` 找可见 workspace，再用子号 Web session 查询匹配 workspace 的 users 列表读取自己的 `seat_type`；credential-only 子号缺少子号侧 Web session 时返回错误，不使用母号凭证兜底读取 | 合并返回的子号 view |

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
  "proxy": "<proxy-url>",
  "session": {
    "user": { "email": "child@example.com" },
    "account": { "id": "<chatgpt-account-id>" },
    "accessToken": "<JWT>",
    "sessionToken": "<next-auth session token>"
  }
}
```

母号和子号的 `session`、`proxy` 都可省略。`groupName` 为空时归入 `默认分组`，`remark` 可为空，`limitType` 只能是 `unknown`、`weekly` 或 `monthly`，`nextRenewalOn` 为空或格式为 `yyyy-mm-dd`。母号和子号接口都不接受 `label` 或 `note` 字段；GPT 账号显示名称统一来自 `email`，本地备注统一来自 `remark`。响应 view 会返回已保存的 `session` 和 `proxy`，用于管理后台本地资料编辑回填；Codex credential JSON 仍只通过显式导出接口返回。

## Codex 凭证导入 API

`POST /api/subaccounts/codex-credential` 支持两种格式。旧格式为直接提交 CPA/Codex credential JSON；新格式可同时指定独立文件名和 CPA 号池：

```http
POST /api/subaccounts/codex-credential
Content-Type: application/json

{
  "fileName": "cpa-a-child.json",
  "groupName": "CPA-A",
  "credential": {
    "email": "child@example.com",
    "account_id": "<team-workspace-account-id>",
    "access_token": "<redacted>",
    "refresh_token": "<redacted>",
    "id_token": "<redacted>",
    "last_refresh": "2026-06-18T00:00:00.000Z",
    "expired": "2026-06-18T01:00:00.000Z",
    "type": "codex",
    "plan_type": "team"
  }
}
```

`fileName` 只作为 `data/subaccount-credentials/<subaccountId>/` 下的文件名使用，后端会去除路径成分。响应只返回 `accountId`、`fileName`、`groupName`、额度缓存等脱敏元数据。
