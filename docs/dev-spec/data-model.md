# 数据模型与本地缓存规则

本文件定义 team-manager 的本地数据模型边界。目标是避免操作成功后 UI、运行时 JSON、缓存和列表项之间出现重复、冗余或断链。

## 总原则

- 后端 store 中的对象是本地事实源；前端只消费后端返回的脱敏 view。
- 写操作成功后必须更新对应本地事实源，或返回已经更新的 view 供前端合并。
- 计数、标签、状态徽标等能从已有数组或关联对象派生的信息，不作为独立字段持久化。
- 运行时 JSON 文件是持久化介质，不是业务 API。不要通过手工编辑 JSON 执行管理动作。
- curl_cffi worker、GongXi-Mail、短信接码和授权页面 clearance 属于运行环境能力，不是账号业务模型字段；后端只暴露脱敏可用状态，前端只读展示。
- store 只按当前 schema 持久化对象；历史冗余字段应通过离线数据清洗删除，不在业务代码中做兼容映射。

## 母号模型

母号持久化对象为 `Account`，只在后端保存敏感字段。前端使用 `AccountView`，不包含 access token、refresh token、cookie 或指纹明文。

### Canonical fields

| 字段 | 来源 | 说明 |
|---|---|---|
| `id` | team-manager | 内部 id，所有 UI/API 操作使用该 id 定位母号 |
| `note` | 本地输入 | 母号备注，不等同远端 Team 名称 |
| `groupName` | 本地输入 | 母号本地分组，缺省归入 `默认分组` |
| `limitType` | 本地输入 | 本地记录的额度窗口类型：`unknown`、`weekly`、`monthly` |
| `accountId` | session JSON | ChatGPT workspace account id，用于 `chatgpt-account-id` 上下文 |
| `email` | session JSON | 母号 owner 邮箱 |
| `accessToken` / `refreshToken` | session JSON | 后端调用 ChatGPT Web backend-api 使用，不下发前端 |
| `workspaceName` | accounts/check 或远端改名结果 | 远端 Team workspace 名称 |
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
| `memberProfiles` | 本地输入 | 母号下邮箱维度资料，key 为小写邮箱 |

### Member profiles

`memberProfiles` 保存母号下某个邮箱的本地运营资料：

| 字段 | 说明 |
|---|---|
| `email` | 小写邮箱，和 map key 一致 |
| `note` | 邮箱备注文本，可为空 |
| `expiresOn` | 到期日期，格式为 `yyyy-mm-dd` |
| `expireRemove` | 到期移除标记，默认 `false` |
| `expireReminder` | 是否进入到期提醒，邀请默认 `true` |
| `updatedAt` | 本地更新时间 |

该资料的维度是“母号内部 id × 邮箱”，不是 invite id 或 user id。pending invite 被接受后，该邮箱会从 `pendingInvitesCache` 移动到 `membersCache`，但 `memberProfiles[邮箱]` 保持不变。前端展示时按当前行邮箱关联资料。

### Derived values

以下信息不得作为独立字段持久化：

- 成员数：从 `membersCache.length` 派生。
- ChatGPT 席位数：从 `membersCache[].seat === "default"` 派生。
- pending invite 数：从 `pendingInvitesCache.length` 派生。
- 列表 item 上的席位标签、状态标签和分组计数：从当前 `AccountView` 派生。

`memberCount`、`chatgptSeatCount`、`pendingInviteCount` 不属于 `Account` schema，应通过数据清洗删除。母号不保存 `label`，显示邮箱统一来自 `email`，备注统一来自 `note`。

## 母号写操作规则

| 操作 | 后端写入规则 | 前端更新规则 |
|---|---|---|
| 邀请成员 | 远端邀请成功后刷新 `pendingInvitesCache`，返回 `AccountView` | 合并返回的母号 view |
| 编辑邮箱资料 | 更新 `memberProfiles[lowercase(email)]`，不调用 ChatGPT 远端 | 合并返回的母号 view |
| 撤销邀请 | 远端撤销成功后刷新 `pendingInvitesCache`，返回 `AccountView` | 合并返回的母号 view |
| 移除成员 | 远端移除成功后刷新 `membersCache`，返回 `AccountView` | 合并返回的母号 view |
| 改成员席位 | 远端修改成功后刷新 `membersCache`；目标席位未变化时也保存当前成员缓存 | 合并返回的母号 view |
| 改默认席位 | 远端修改成功后更新 `defaultSeat` 和缓存时间 | 合并返回的母号 view |
| 改 Codex 邀请开关 | 远端修改成功后更新 `workspaceReferralsEnabled`、`workspaceReferralsEnabledVisible` 和缓存时间 | 合并返回的母号 view |
| 改个人访问令牌开关 | 远端修改成功后更新 `personalAccessTokensEnabled` 和缓存时间 | 合并返回的母号 view |
| 改 Codex 设备代码身份验证开关 | 远端修改成功后更新 `codexDeviceCodeAuthEnabled` 和缓存时间 | 合并返回的母号 view |
| 改 Codex 远程控制开关 | 远端修改成功后更新 `codexRemoteControlEnabled` 和缓存时间 | 合并返回的母号 view |
| 远端 Team 改名 | 远端修改成功后更新 `workspaceName` | 合并返回的母号 view |
| 编辑本地资料 | 更新 `note`、`groupName`、`limitType`；提供 session 时更新 `email`、`accountId`、`accessToken`，并清空 `lastError` | 合并返回的母号 view，旧 session 明文不回填 |

邀请或升席位到 `default` 可能增加账单。service 层必须先进行账单风险检查，风险存在时返回 HTTP 409；调用方只有显式传 `confirmBillingRisk:true` 才能继续。邀请成功后，service 会为目标邮箱 upsert `memberProfiles`。如果调用方未提供邮箱资料，到期日期默认为当前日期加 30 天，`expireRemove=false`，`expireReminder=true`。

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

通知任务按 `triggerTime` 每天最多运行一次，扫描所有母号 `memberProfiles` 中 `expireReminder=true` 且到期日在提醒窗口内的邮箱。通知内容会包含邮箱、母号 workspace、当前行状态（`invited`、`member` 或仅本地记录）、到期日期、剩余天数、到期移除标记和备注。

## 子号模型

子号持久化对象为 `Subaccount`，前端使用 `SubaccountView`。子号的 ChatGPT Web session 和 Codex 凭证明文只在后端持久化。

### Canonical fields

| 字段 | 来源 | 说明 |
|---|---|---|
| `id` | team-manager | 内部 id |
| `email` | session JSON、注册结果或 Codex credential | 子号邮箱 |
| `label` | 本地输入 | 本地备注名 |
| `chatgptAccountId` | session JSON | 子号自身 ChatGPT account id |
| `webAccessToken` | session JSON | 子号 ChatGPT Web access token，不下发前端 |
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
- `issued_account_id`：仅写入独立凭证 JSON。创建个人访问令牌时，如果远端响应的 `workspace_id` 和用户选择的目标 workspace 不一致，`account_id` 仍按用户目标保存，远端返回值记录到该字段，便于验证多 workspace PAT 行为。
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

- `SubaccountView.hasWebSession` 是允许下发的脱敏能力位，因为前端不能接收 `webAccessToken`。
- `SubaccountView.codexCredentials[].accountId` 用于展示和按 workspace 发起操作。
- `SubaccountView.codexCredentials[].fileName` 和 `groupName` 用于展示凭证独立文件名和所在 CPA 号池。
- 顶层 `hasCodexCredential`、`lastQuota`、`lastQuotaAt`、`lastAuthAt` 是冗余字段，不应出现在 view 或持久化数据中。

## 子号写操作规则

| 操作 | 后端写入规则 | 前端更新规则 |
|---|---|---|
| 导入 session | 写入或更新 `email`、`chatgptAccountId`、`webAccessToken`、`status`，追加脱敏日志 | 合并返回的子号 view |
| 导入已有 Codex credential | 按 `credential.email` 创建或更新子号；不写入 `webAccessToken`；凭证 JSON 写入独立文件，按 `credential.account_id` upsert `codexCredentials[]` 元数据 | 合并返回的子号 view |
| 自动注册子号 | 通过 worker 申请邮箱并注册 OpenAI 账号；写入 `email`、`registrationPassword`、`registeredAt`、`registrationSource`；如授权成功则写入独立凭证文件并 upsert `codexCredentials[]` 元数据 | 合并返回的子号 view，密码不下发 |
| 编辑本地资料 | 更新 `label`；提供 session 时更新 `email`、`chatgptAccountId`、`webAccessToken`；保留 Codex 凭证、Team 关联和日志 | 合并返回的子号 view |
| Codex 授权成功 | 凭证 JSON 写入独立文件，按 `credential.account_id` upsert `codexCredentials[]` 元数据，更新状态和日志 | 合并返回的子号 view 或重新拉取 |
| 创建 Codex 个人访问令牌 | 用子号 Web Session 在目标 workspace 调用 `wham/auth-credentials`；返回的 `at-...` token 写入独立凭证文件，按 `workspace_id` upsert `codexCredentials[]` 元数据 | 合并返回的子号 view |
| 刷新额度 | 只更新目标 workspace 凭证的 `lastQuota` / `lastQuotaAt` | 更新对应子号 view |
| 邀请加入母号 | 远端邀请成功后写入 `teamLinks[].status = "invited"`，账单风险沿用母号邀请规则 | 合并返回的子号 view |
| 同步 Team 关联 | 逐个母号查询 members 和 pending invites，写入 `member` / `invited` / `removed` / `unknown` | 合并返回的子号 view |

## 本地资料编辑 API

母号：

```http
PATCH /api/accounts/:id/local-profile
Content-Type: application/json

{
  "note": "本地备注",
  "groupName": "自用",
  "limitType": "monthly",
  "session": {
    "user": { "email": "owner@example.com" },
    "account": { "id": "<workspace-account-id>" },
    "accessToken": "<JWT>"
  }
}
```

子号：

```http
PATCH /api/subaccounts/:id/local-profile
Content-Type: application/json

{
  "label": "本地备注名",
  "session": {
    "user": { "email": "child@example.com" },
    "account": { "id": "<chatgpt-account-id>" },
    "accessToken": "<JWT>"
  }
}
```

母号 `session` 可省略。`groupName` 为空时归入 `默认分组`，`note` 可为空，`limitType` 只能是 `unknown`、`weekly` 或 `monthly`。母号接口不接受 `label` 字段；母号邮箱显示名统一来自 `email`。子号 `session` 可省略，`label` 必须是非空字符串。响应返回脱敏 view，不返回旧 session 或新 session 明文。

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
