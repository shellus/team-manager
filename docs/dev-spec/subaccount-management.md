# 子号管理实现边界

Team Manager 负责保存子号 Web Session、Team 关联和 PAT 凭证，不负责执行 GPT 账号注册。账号注册由独立的 GPT Account Manager 完成，Team Manager 只创建账号操作、查询进度并取得最终 Web Session。

已保存 `managedAccountEmail` 的子号可通过账号管理页启动或关闭 Account Manager 运行 Profile，并编辑国家、ASN、州/省、城市和上游 SID。ASN 有值时州/省与城市清空并禁用。Team Manager 只转发控制请求并展示状态，不保存 Profile ID 或住宅代理配置、不提供浏览器查看能力，也不绕过 Account Manager 调用 CloakBrowser。

子号列表通过 Account Manager 批量状态派生“Profile 已启动”标签。只有 `running` 状态置顶，未启动记录保持原备注/邮箱自然排序；Profile 状态不进入子号持久化模型。详情页启动、关闭或轮询到状态变化后立即更新列表派生状态。

## 子号数据

- `data/subaccounts.json` 保存子号邮箱、本地备注与分组、Web Session、可选 `managedAccountEmail` 引用、Team 关联和 PAT 凭证元数据。
- `data/subaccount-credentials/<subaccountId>/` 只保存 PAT 凭证文件。
- PAT 元数据按“子号 × Team workspace”保存，包含 `accountId`、`fileName`、`groupName`、额度缓存和创建时间。
- 普通子号 view 不返回 PAT 明文；只有显式下载接口返回完整 PAT JSON。
- Codex 凭证数据结构固定为 PAT。

## 注册服务对接

运行环境通过以下变量连接 GPT Account Manager：

- `TEAMMGR_ACCOUNT_MANAGER_BASE_URL`
- `TEAMMGR_ACCOUNT_MANAGER_TOKEN`

Team Manager 对外保持稳定的注册任务 API：

- `POST /api/subaccounts/registration/start`
- `GET /api/subaccounts/registration/jobs`
- `POST /api/subaccounts/registration/jobs/:jobId/retry`
- `GET /api/subaccounts/registration/jobs/:jobId/proxy`
- `PUT /api/subaccounts/registration/jobs/:jobId/proxy`
- `DELETE /api/subaccounts/registration/jobs/:jobId`
- `GET /api/subaccounts/registration/status`

注册操作成功后，Team Manager 按邮箱账号引用从 Account Manager 显式取得 ChatGPT Web Session，写入 `managedAccountEmail` 后清理已完成操作。密码、Cloak profile 和完整浏览器事件不会进入 Team Manager 数据或日志。

注册进行中、失败和等待人工处理都由 Account Manager 持久化，因此刷新 Team Manager 页面不会丢失任务。Team Manager 不保存注册密码、CloakBrowser、GongXi-Mail、Mihomo、家宽代理或支付状态。

注册任务卡在成功前都可选中，并使用 `/subaccounts/registrations/:jobId?tab=account-manager` 保持页面状态。临时详情只显示账号管理 Tab，允许在 profile 创建前保存住宅代理配置；运行中保存时由 Account Manager 断开旧连接并刷新当前注册页面。注册成功并导入正式子号后，页面自动切换到 `/subaccounts/:id?tab=account-manager`。正式子号通过 `GET/PUT /api/subaccounts/:id/account-manager/proxy` 使用同一配置面板。

## Web Session 与个人设置

- `POST /api/subaccounts/session` 只接受 chatgpt.com `/api/auth/session` 输出的 session JSON。
- 必需字段是 `user.email`、`account.id` 和 `accessToken`；建议同时提供 `sessionToken`。
- `sessionToken` 用于按目标 workspace 换取新的 Web access token。
- `PATCH /api/subaccounts/:id/local-profile` 修改本地备注、分组、代理和 Web Session。
- `POST /api/subaccounts/:id/refresh` 同步 Session Cookie、Web access token、个人资料、通知设置、记忆和 reset credits。
- `PATCH /api/subaccounts/:id/personal-settings` 修改用户名、显示名、营销通知和记忆。

## Team 关联

- `POST /api/subaccounts/:id/team-invites` 使用子号邮箱邀请加入本地母号对应的 Team。
- `POST /api/subaccounts/:id/team-links/sync` 只使用子号 Web Session 的一次 `accounts/check` 读取当前可见 workspace。同步保留已有 link 的席位类型，新 link 使用 `usage_based`，最终一次写入完整关联列表。
- `DELETE /api/subaccounts/:id/team-links/:accountId` 使用子号 Web Session 退出目标 Team。
- `teamLinks` 是本地缓存，不是远端唯一事实源。

## PAT 凭证

- `POST /api/subaccounts/:id/pat-credentials` 为目标 workspace 创建 PAT。
- 若子号保存了 `sessionToken`，先换取目标 workspace 的 Web access token。
- 创建请求调用 `POST /backend-api/wham/auth-credentials`，scope 固定为 `chatgpt.workspace.feature.allow-codex-local-access.access`，TTL 为 30 天。
- 返回的 `workspace_id` 必须和目标 workspace 一致，否则拒绝保存。
- 保存格式固定为 `auth_mode:"personalAccessToken"`、`credential_source:"personal_access_token"`，并同时写入 `access_token` 与 `personal_access_token`。
- `GET /api/subaccounts/:id/pat-credentials?chatgptAccountId=...` 下载目标 PAT。
- `DELETE /api/subaccounts/:id/pat-credentials?chatgptAccountId=...` 删除目标 PAT。
- `POST /api/subaccounts/:id/quota/refresh` 使用目标 PAT 调用 `/backend-api/wham/usage` 并缓存额度窗口。

## curl_cffi worker

Team Manager 的 curl_cffi sidecar 只提供通用 ChatGPT 请求转发：

- `GET /health`
- `POST /fetch`

它不执行注册、邮箱操作、短信验证或凭证创建。每账号代理仍由请求中的 `proxy` 字段传入，未配置时使用 worker 全局代理。

## 日志

子号操作日志写入 `data/subaccount-auth-logs.jsonl`。当前实例按自托管排障要求保存完整错误正文和注册服务交付，不做字段脱敏；运行日志属于高敏感数据，不应公开。服务启动及追加日志时会清理超过 30 天的记录，并只保留最近 2000 条，避免日志文件和内存占用持续增长。
