# 数据模型与本地缓存规则

本文件定义 team-manager 的本地数据模型边界。目标是避免操作成功后 UI、运行时 JSON、缓存和列表项之间出现重复、冗余或断链。

## 总原则

- 后端 store 中的对象是本地事实源；前端只消费后端返回的脱敏 view。
- 写操作成功后必须更新对应本地事实源，或返回已经更新的 view 供前端合并。
- 计数、标签、状态徽标等能从已有数组或关联对象派生的信息，不作为独立字段持久化。
- 运行时 JSON 文件是持久化介质，不是业务 API。不要通过手工编辑 JSON 执行管理动作。
- curl_cffi worker、GongXi-Mail、短信接码和授权页面 clearance 属于运行环境能力，不是账号业务模型字段；后端只暴露脱敏可用状态，前端只读展示。
- 兼容旧数据时允许在 store 初始化阶段清理遗留冗余字段，并立即按当前 schema 持久化。

## 母号模型

母号持久化对象为 `Account`，只在后端保存敏感字段。前端使用 `AccountView`，不包含 access token、refresh token、cookie 或指纹明文。

### Canonical fields

| 字段 | 来源 | 说明 |
|---|---|---|
| `id` | team-manager | 内部 id，所有 UI/API 操作使用该 id 定位母号 |
| `label` | 本地输入 | 本地备注名，不等同远端 Team 名称 |
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

### Derived values

以下信息不得作为独立字段持久化：

- 成员数：从 `membersCache.length` 派生。
- ChatGPT 席位数：从 `membersCache[].seat === "default"` 派生。
- pending invite 数：从 `pendingInvitesCache.length` 派生。
- 列表 item 上的席位标签和状态标签：从当前 `AccountView` 派生。

历史字段 `memberCount`、`chatgptSeatCount`、`pendingInviteCount` 属于冗余字段，store 初始化和持久化时应移除。

## 母号写操作规则

| 操作 | 后端写入规则 | 前端更新规则 |
|---|---|---|
| 邀请成员 | 远端邀请成功后刷新 `pendingInvitesCache`，返回 `AccountView` | 合并返回的母号 view |
| 撤销邀请 | 远端撤销成功后刷新 `pendingInvitesCache`，返回 `AccountView` | 合并返回的母号 view |
| 移除成员 | 远端移除成功后刷新 `membersCache`，返回 `AccountView` | 合并返回的母号 view |
| 改成员席位 | 远端修改成功后刷新 `membersCache`；目标席位未变化时也保存当前成员缓存 | 合并返回的母号 view |
| 改默认席位 | 远端修改成功后更新 `defaultSeat` 和缓存时间 | 合并返回的母号 view |
| 改 Codex 邀请开关 | 远端修改成功后更新 `workspaceReferralsEnabled`、`workspaceReferralsEnabledVisible` 和缓存时间 | 合并返回的母号 view |
| 远端 Team 改名 | 远端修改成功后更新 `workspaceName` | 合并返回的母号 view |
| 编辑本地资料 | 更新 `label`；提供 session 时更新 `email`、`accountId`、`accessToken`，并清空 `lastError` | 合并返回的母号 view，旧 session 明文不回填 |

邀请或升席位到 `default` 可能增加账单。service 层必须先进行账单风险检查，风险存在时返回 HTTP 409；调用方只有显式传 `confirmBillingRisk:true` 才能继续。

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
| `codexCredentials[]` | Codex OAuth token exchange 或已有 CPA/Codex auth JSON | 子号在某 Team workspace 下的 Codex 凭证 |
| `teamLinks[]` | 邀请/同步结果 | 子号与已录入母号的本地关系缓存 |
| `status` / `lastError` | 授权或同步流程 | 子号流程状态和错误摘要 |
| `createdAt` / `updatedAt` | store | 本地记录生命周期 |

### Codex credential

`SubaccountCodexCredential` 只保存：

- `credential`：CPA/Codex 兼容凭证 JSON，含 `credential.account_id`。
- `lastQuota` / `lastQuotaAt`：该 workspace 凭证的额度缓存。
- `lastAuthAt`：该 workspace 凭证最近授权时间。

workspace key 以 `credential.account_id` 为准。历史字段 `SubaccountCodexCredential.accountId` 是冗余字段，初始化和持久化时应移除。前端 view 中的 `SubaccountCodexCredentialView.accountId` 从 `credential.account_id` 派生。

### Team links

`SubaccountTeamLink` 只保存：

| 字段 | 说明 |
|---|---|
| `accountId` | team-manager 母号内部 id |
| `seat` | 子号在该 Team 的席位缓存 |
| `status` | `invited`、`member`、`removed` 或 `unknown` |
| `updatedAt` | 本地更新时间 |

不要在 `teamLinks` 中复制母号备注名、远端 workspace id 或 Team 名称。前端展示时应从当前母号列表按 `accountId` 派生。历史字段 `accountLabel`、`chatgptAccountId` 属于冗余字段，初始化和持久化时应移除。

### Derived view fields

- `SubaccountView.hasWebSession` 是允许下发的脱敏能力位，因为前端不能接收 `webAccessToken`。
- `SubaccountView.codexCredentials[].accountId` 从后端凭证 JSON 中派生，用于展示和按 workspace 发起操作。
- 顶层 `hasCodexCredential`、`lastQuota`、`lastQuotaAt`、`lastAuthAt` 是历史冗余字段，不应继续出现在 view 或持久化数据中。

## 子号写操作规则

| 操作 | 后端写入规则 | 前端更新规则 |
|---|---|---|
| 导入 session | 写入或更新 `email`、`chatgptAccountId`、`webAccessToken`、`status`，追加脱敏日志 | 合并返回的子号 view |
| 导入已有 Codex credential | 按 `credential.email` 创建或更新子号；不写入 `webAccessToken`；按 `credential.account_id` upsert `codexCredentials[]` | 合并返回的子号 view |
| 编辑本地资料 | 更新 `label`；提供 session 时更新 `email`、`chatgptAccountId`、`webAccessToken`；保留 Codex 凭证、Team 关联和日志 | 合并返回的子号 view |
| Codex 授权成功 | 按 `credential.account_id` upsert `codexCredentials[]`，更新状态和日志 | 合并返回的子号 view 或重新拉取 |
| 刷新额度 | 只更新目标 workspace 凭证的 `lastQuota` / `lastQuotaAt` | 更新对应子号 view |
| 邀请加入母号 | 远端邀请成功后写入 `teamLinks[].status = "invited"`，账单风险沿用母号邀请规则 | 合并返回的子号 view |
| 同步 Team 关联 | 逐个母号查询 members 和 pending invites，写入 `member` / `invited` / `removed` / `unknown` | 合并返回的子号 view |

## 本地资料编辑 API

母号：

```http
PATCH /api/accounts/:id/local-profile
Content-Type: application/json

{
  "label": "本地备注名",
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

`session` 可省略。`label` 必须是非空字符串。响应返回脱敏 view，不返回旧 session 或新 session 明文。
