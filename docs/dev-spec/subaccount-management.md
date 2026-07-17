# Subaccount Management

本文件记录子号管理当前实现边界。运行时主链路不使用 Playwright。Codex 自动授权会通过 curl_cffi worker 调用 auth.openai.com，并使用运行环境配置的授权页面 clearance、GongXi-Mail 邮箱验证码和可选短信 OTP 能力；额度查询不对接外部 credential-status 服务，仅参考 CPA 的凭证格式与额度解析方式，直接用目标 Team workspace 对应的子号 Codex 凭证查询额度。

GongXi-Mail、短信接码、Flaresolverr/curl_cffi worker 地址和相关密钥属于部署运行配置，不是 team-manager 的业务数据。源码和公开文档只描述能力边界；真实连接参数、手机号、短信 inbox URL 和手机号池 YAML 文件放在运行环境、部署挂载数据或本机私有文档中。页面只通过脱敏状态检查展示这些能力是否可用，不提供密钥、域名、路径、手机号或接码渠道编辑入口。

## 已实现

- 子号池：`data/subaccounts.json` 和 `data/subaccount-credentials/<subaccountId>/`
  - 记录邮箱、本地备注 `remark`、ChatGPT account id、web session 状态、按 Team workspace 保存的 Codex 凭证状态，以及该子号加入过的母号关系。
  - `codexCredentials[]` 按凭证里的 `credential.account_id` 保存多份凭证元数据；真实 CPA/Codex auth JSON 写入独立凭证文件。
  - 凭证元数据包含 `accountId`、`fileName`、`groupName`、`planType`、授权时间和额度缓存。`groupName` 用于展示该凭证所在 CPA 号池。
  - 自动注册生成的 OpenAI 密码记录在持久化对象中，并下发给可信自托管管理后台的“注册资料”页签；完整日志同样保留明文，便于排障。
  - `credential.account_id` 是凭证绑定的 Team workspace。OAuth 凭证来自 Codex `id_token` claim 中的 `chatgpt_account_id`；个人访问令牌凭证来自 `wham/auth-credentials` 响应的 `workspace_id`。
  - API 普通 view 返回子号元数据、可编辑 Web session 和代理地址；Codex credential JSON 的 `access_token` / `refresh_token` / `id_token` 只通过显式凭证导出接口返回。
- 子号 Web 登录态录入：
  - `POST /api/subaccounts/session` 只接受 chatgpt.com `/api/auth/session` 输出的 session JSON 对象。
  - session JSON 对象必需字段为 `user.email`、`account.id`、`accessToken`；可选字段 `sessionToken` 会被保存，用于后续按目标 workspace 换取 Web access token。
  - `sessionToken` 写入后端 `data/subaccounts.json`，并通过 `SubaccountView.session` 回填给管理后台本地资料编辑框。
  - 对多 workspace 子号创建 Codex 个人访问令牌时，后端会用保存的 `sessionToken` 请求 ChatGPT `/api/auth/session`，换取目标 workspace 的 Web access token，不要求用户按 workspace 分别录入 session。
  - 子号侧 ChatGPT Web 请求遇到 HTTP 401 且远端错误码为 `token_invalidated` 或 `token_revoked` 时，如果保存了 `sessionToken`，后端会按当前请求 workspace 换取新的 Web access token，回写 `webAccessToken` 并重试一次原请求。
  - 不支持数组输入或扁平字段，不做回退兼容。
- 已有 Codex credential 录入：
  - `POST /api/subaccounts/codex-credential` 接受 CPA/Codex 兼容 auth JSON，或 `{ credential, fileName, groupName }` 包装格式。
  - 按 `credential.email` 创建或更新子号，按 `credential.account_id` 保存对应 Team workspace 凭证。
  - `fileName` 为独立凭证文件名，`groupName` 为 CPA 号池名；缺省文件名由邮箱和 workspace 派生，缺省号池为 `默认号池`。
  - 该子号可以没有 ChatGPT Web session；响应只返回 `hasWebSession:false` 和脱敏的 credential view。
- 子号本地资料编辑：
  - `PATCH /api/subaccounts/:id/local-profile` 支持修改本地备注 `remark` 和独立代理地址 `proxy`。
  - 请求带新的 session JSON 对象时更新 `email`、`chatgptAccountId`、`webAccessToken`，并在存在 `sessionToken` 时更新 `sessionToken`。
  - 保留已有 Codex 凭证、Team 关联和授权日志，响应 view 回填已保存的 Web session 和代理地址；Codex credential JSON 仍不进入普通 view。
- Web 账号同步与个人设置：
  - `POST /api/subaccounts/:id/refresh` 先用 `sessionToken` 调用 `/api/auth/session`，再用新 Web access token调用 `/backend-api/me`、Calpico 个人资料、营销通知设置和 reset credits。
  - `sessionTokenStatus` 与 `webAccessTokenStatus` 分开持久化；前者表示 Session Cookie 是否可换取 Session，后者表示 backend-api 是否接受 Web access token。
  - 同步采用部分成功语义。某项个人接口失败时仍返回最新子号 view，并把失败步骤写入 `lastError` 和完整运行日志。
  - `PATCH /api/subaccounts/:id/personal-settings` 修改用户名、显示名、营销 Push、营销 Email 或记忆；子号不保存也不修改母号的默认席位、邀请权限、PAT 或 Codex Team 设置。
  - 营销通知 PATCH 使用远端要求的 `{updates:{marketing:{push?,email?}}}` 结构；记忆通过 `account_user_setting?feature=m3m&value=...` 修改。
- Codex Auth 授权：
  - 使用 OAuth authorization code + PKCE。
  - 固定 redirect URI：`http://localhost:1455/auth/callback`。
  - 自动授权：后端创建带 `login_hint` 的 OAuth 会话，curl_cffi worker 获取 auth.openai.com clearance，触发 `passwordless/send-otp`，从 GongXi-Mail 的 inbox/junk 读取 OpenAI code 邮件，完成 `email-otp/validate`、必要的手机号验证、目标 `workspace/select`、callback 和 token exchange。
  - 手动兜底：前端按目标 Team 展示登录 URL，用户授权后把 callback URL 粘贴回系统。
  - 两条链路最终都生成 CPA/Codex 兼容 JSON，并按目标 Team workspace 写入独立凭证文件。
  - 如果手动授权返回的 `chatgpt_account_id` 与目标 Team workspace 不一致，后端返回 409 并拒绝保存。
  - 邮箱 OTP 提交被判为错误、无效或过期时，worker 会在 `TEAMMGR_EMAIL_CODE_MAX_ATTEMPTS` 预算内重新从 GongXi-Mail 取可用候选码；事件日志只记录阶段和尝试次数，不记录验证码明文。
  - 若自动授权遇到 `add_phone`，worker 会从运行环境 YAML 手机号池选择未用尽号码，发送短信并校验 OTP；成功后把子号邮箱写入该号码的 `gptAccounts[]`。
  - 若自动授权遇到已绑定手机号的 `phone_otp_select_channel` / `phone_otp_verification`，worker 会按 OpenAI 返回的手机号提示在 YAML 池中匹配号码并读取短信 OTP。
  - 短信验证码提交被判为错误、无效或过期时，worker 会在 `TEAMMGR_PHONE_CODE_MAX_ATTEMPTS` 预算内换用同一 inbox 中其他候选码或新码；事件日志只记录阶段和尝试次数，不记录验证码明文。
  - 遇到 `auth_challenge` 人机校验时，worker 会先用运行环境 FlareSolverr 尝试打开 challenge；如果 solver 返回可继续的 auth JSON 状态，则继续后续手机号验证或授权状态机。
  - 若手机号池为空、绑定手机号无法匹配、尾号匹配到多个号码、短信超时、验证码重试预算耗尽或人机校验无法自动继续，子号状态写为 `verification_required`，日志记录脱敏阶段信息。
  - 若 OpenAI 返回账号锁定、停用或不可用，worker 返回 `account_locked`，后端把子号状态写为 `account_locked`，停止把它混入验证码待验证流程。
- Codex 个人访问令牌凭证：
  - `POST /api/subaccounts/:id/codex-auth/personal-access-token` 默认使用子号自己的 ChatGPT Web `accessToken` 调用 `POST /backend-api/wham/auth-credentials`。
  - 若子号保存了 session JSON `sessionToken`，后端先调用 `/api/auth/session` 换取目标 workspace Web access token，校验返回的 Web access token claim 属于目标 workspace 后，再调用 `wham/auth-credentials`。
  - 子号配置了独立代理地址时，workspace token 换取和 `wham/auth-credentials` 请求都使用该子号代理；未配置时回退到 worker 全局代理。
  - 请求目标 workspace 由 `chatgpt-account-id` header 指定，scope 固定为 `chatgpt.workspace.feature.allow-codex-local-access.access`，TTL 为 30 天。
  - 返回的 `at-...` token 是官方 Codex CLI 支持的 personal access token。官方 Codex 将其保存为 `auth.json.personal_access_token`，不需要 `refresh_token` 或 `id_token`。
  - team-manager 保存为 `auth_mode:"personalAccessToken"` / `credential_source:"personal_access_token"` 的 Codex credential JSON，同时保留 `access_token` 和 `personal_access_token` 便于额度刷新和导出。
  - PAT 创建流程按远端响应 `workspace_id` 写入 `credential.account_id`。该 `workspace_id` 必须和用户选择的目标 workspace 一致；不一致时后端返回 409 并拒绝保存，避免把绑定到其他 workspace 的 PAT 错记到目标 Team。
  - 该流程只操作子号凭证，不会自动修改母号的 `personal_access_tokens`、`wham_local_access`、`codex_device_code_auth` 或 `codex_remote_control` 等 Team 设置。若目标 Team 未允许用户创建个人访问令牌或未命中 Codex Local 后端授权规则，远端错误直接返回给调用方。
- 官方 Codex PAT 兼容性确认：
  - `codex-rs/login/src/auth/access_token.rs` 按 `at-` 前缀把 token 分类为 `PersonalAccessToken`。
  - `codex-rs/login/src/auth/storage.rs` 的 `AuthDotJson` 独立支持 `personal_access_token` 字段。
  - `codex-rs/login/src/auth/manager.rs` 对 PAT 的 `get_token()` 直接返回该 token，`get_account_id()` 使用 PAT 元数据里的 `chatgpt_account_id`；`codex login --with-access-token` 写盘时只写 `personal_access_token`，不写 OAuth `tokens`。
  - `codex-rs/login/src/auth/personal_access_token.rs` 会用 PAT 调 `GET /api/accounts/v1/user-auth-credential/whoami` 补齐 `email`、`chatgpt_user_id`、`chatgpt_account_id`、`chatgpt_plan_type` 和 FedRAMP 标记。
  - `codex-rs/model-provider-info/src/lib.rs` 将 `PersonalAccessToken` 视为使用 ChatGPT Codex backend 的认证模式。
- 自动注册：
  - `POST /api/subaccounts/registration/start` 原子创建持久化后台任务并立即返回；服务端串行队列通过 worker `/subaccounts/register-events` 执行注册和接收阶段事件，只负责 ChatGPT 账号注册和 Web Session 录入，不创建 Codex OAuth 会话。
  - worker 通过 GongXi-Mail `/api/get-email` 申请邮箱，生成随机强密码，执行 `screen_hint:"signup"`；若 OpenAI 默认进入 `passwordless_signup`，则显式切换到同一会话的密码注册分支，再调用 `/api/accounts/user/register`、邮箱 OTP、资料填写和 ChatGPT callback。
  - 新任务若在 signup continue 或 register 阶段发现邮箱已存在、已注册或被占用，worker 会记录 `registration_email_rejected` 并重新从 GongXi-Mail 取邮箱；`TEAMMGR_REGISTRATION_EMAIL_MAX_ATTEMPTS` 控制最大取邮箱次数，默认 3 次。
  - 失败或中断任务可通过 `POST /api/subaccounts/registration/jobs/:jobId/retry` 原子复用原任务。已保存邮箱和密码时重试同一账号；若远端返回邮箱已存在，则改走密码登录并重新取得 Web Session。邮箱分配前失败的任务才重新取邮箱。
  - 若所有候选邮箱都被判定为已注册或被占用，worker 返回 `registration_email_unavailable`，不携带最后一个无效邮箱和密码；后台任务进入失败状态，不创建子号记录。
  - callback 回到 ChatGPT 后，worker 访问 `/api/auth/session` 获取 `accessToken`、`sessionToken` 和账号 ID；后端创建或更新子号记录、保存生成密码，再把邮箱转移到已注册分组。
  - 自动注册按钮不选择 workspace、不执行 Codex OAuth、不生成 PAT，也不写入 Codex credential 文件。
  - 注册阶段 sentinel 或 OpenAI 人机校验失败时，worker 返回 `verification_required` 和完整原始事件；如已经拿到邮箱和密码，后端仍会落库，便于后续恢复。
  - 对已落库的自动注册账号再次执行 Codex 自动授权时，后端会把 `registrationPassword` 传给 worker 走密码登录；可信管理后台的“注册资料”页签显示该密码和注册来源，完整授权日志仍按运行环境规则保存。
- 自动授权运行能力检查：
  - `GET /api/subaccounts/codex-auth/status` 返回 worker 是否配置、worker 是否可连接、GongXi-Mail 是否可用、短信 OTP 能力是否可用、授权页面 clearance 是否可用。
  - 响应只包含布尔状态、可用号码数量、已用尽号码数量和脱敏错误摘要，不返回真实 URL、key、手机号、文件路径或接码渠道配置。
  - 前端在子号页面的“凭证与 Codex Auth”区域只读展示这些能力；配置缺失时禁用自动授权入口，仍保留登录 URL 手动授权。
- 子号加入母号：
  - 选择本地已录入的母号和席位类型。
  - 后端用子号邮箱调用母号邀请接口。
  - ChatGPT 席位账单风险仍复用 `TeamService.invite` 的统一确认机制。
- Team 关联同步：
  - `teamLinks` 是本地缓存，不是唯一事实来源。
  - 有 ChatGPT Web session 的子号，点击同步时用子号自己的 access token 调用 `GET /backend-api/accounts/check/v4-2023-04-27`，从响应 `accounts[].account.account_id` 得到该子号可见的 workspace 列表，再和已录入母号的 workspace `accountId` 做交集。
  - 子号可见且本地已录入对应母号时，继续用子号自己的 access token 调用 `GET /backend-api/accounts/{account_id}/users?offset=0&limit=25&query=<子号邮箱>`，从返回成员记录读取该子号自己的 `seat_type` 并写入 `member` 状态。
  - `accounts/check` 和 users query 均走统一 ChatGPT Web 请求封装。若返回 `token_invalidated` 且子号保存了 `sessionToken`，后端会按当前请求 workspace 换取新 Web access token，保存到子号记录并重试一次。
  - 子号配置了独立代理地址时，`accounts/check`、users query、退出 Team 和 K12 加入请求都使用该子号代理；未配置时回退到 worker 全局代理。
  - 曾经有本地记录但本次子号列表不可见时写入 `removed`。
  - `accounts/check` 不返回成员席位类型，只用于缩小需要查询的 workspace 范围；席位以子号 session 对目标 workspace 的 users query 返回的 `seat_type` 为准。
  - 没有 Web session 的 credential-only 子号无法从子号侧自列 workspace，同步接口返回 400，不使用母号凭证兜底读取。
  - 单个目标 workspace 查询失败时保留该条并写入 `unknown`。
  - 不在进入页面时自动同步，避免远端慢请求阻塞子号详情页。
- 凭证额度查询：
  - 直接使用目标 Team workspace 对应的子号 Codex 凭证里的 `access_token`。
  - 同时使用凭证里的 `account_id` 作为 `Chatgpt-Account-Id` 请求头，保持和 CPA Codex executor 的账户上下文一致。
  - 请求 `GET /backend-api/wham/usage`。
  - 子号配置了独立代理地址时，额度请求使用该子号代理；未配置时回退到 worker 全局代理。
  - 解析 `rate_limit.primary_window`、`secondary_window`、`additional_rate_limits`，输出 5 小时、7 天、月度和模型级窗口。
  - 刷新结果缓存到对应 `codexCredentials[].lastQuota` / `lastQuotaAt`，页面进入详情时先显示旧额度，再由用户按 Team 手动刷新。
  - 不对接外部 credential-status 服务。
- 验证与授权日志：
  - 追加写入 `data/subaccount-auth-logs.jsonl`。
  - 自托管运行实例按排障要求保存完整结构化数据；Web 账号同步日志包含 `/api/auth/session`、`/backend-api/me`、个人资料、通知设置和用量限制的成功响应或完整错误正文，不做字段脱敏。

## 短信接码 YAML 池

curl_cffi worker 通过 `TEAMMGR_PHONE_POOL_YAML` 读取并维护手机号池。实际文件属于运行环境数据，不进入 git 管理文件。旧的 txt 路径和按章节区分“未用/已用”的方式不再作为主链路。

历史 TXT 号池迁移为 YAML 时，使用仓库内迁移脚本生成运行环境私有文件：

```bash
python3 apps/curl-cffi-worker/phone_pool_migration.py \
  --output <phone-pool-yaml-path> \
  <legacy-phone-pool-1.txt> <legacy-phone-pool-2.txt>
```

迁移后运行环境应设置 `TEAMMGR_PHONE_POOL_YAML=<phone-pool-yaml-path>`，并把该 YAML 以可写方式挂载给 worker；不要继续设置 `TEAMMGR_PHONE_POOL_FILES` 或只读挂载旧 TXT 文件。迁移脚本只从旧 TXT 提取手机号和 inbox URL，初始写入 `exhausted:false` 与空 `gptAccounts[]`，后续绑定记录由 worker 自维护。

YAML 结构：

```yaml
version: 1
phones:
  - phone: "<phone-e164>"
    url: "<sms-inbox-url>"
    exhausted: false
    gptAccounts:
      - email: "child@example.com"
        boundAt: "2026-06-22T00:00:00+00:00"
```

字段规则：

- `phone` 是提交给 OpenAI 的 E.164 号码。
- `url` 是 worker 拉取短信内容的运行环境 inbox URL。
- `gptAccounts[]` 记录已经使用该号码绑定或验证过的 GPT 账号；当前 worker 至少写入 `email` 和 `boundAt`。
- `exhausted:true` 表示该号码已被 OpenAI 判定达到可绑定 GPT 账号数量上限，不能再用于新的 `add_phone` 绑定。
- 新账号首次绑定手机号时，worker 跳过 `exhausted:true` 的号码；已绑定手机号二次验证仍可在全池中按尾号匹配，因为用尽只限制新增绑定，不限制已绑定账号收码。
- `POST /api/accounts/add-phone/send` 返回“maximum number of accounts”等上限错误时，worker 会把该号码写回为 `exhausted:true`，并记录 `exhaustedAt` 和 `exhaustedReason`。
- `phone-otp/validate` 成功后，worker 会把当前子号邮箱写入该号码的 `gptAccounts[]`。
- `TEAMMGR_REGISTRATION_EMAIL_MAX_ATTEMPTS` 可控制注册阶段从 GongXi-Mail 重新取邮箱的最大次数，默认 3 次。若所有候选邮箱都被 OpenAI 判定为已注册或被占用，worker 返回 `registration_email_unavailable`，不携带最后一个无效邮箱和密码。
- `TEAMMGR_EMAIL_CODE_MAX_ATTEMPTS` 可控制单次邮箱验证码候选重试次数，默认 3 次。
- `TEAMMGR_PHONE_CODE_MAX_ATTEMPTS` 可控制单次手机号验证的验证码候选重试次数，默认 3 次。

## API

- `GET /api/subaccounts`
- `POST /api/subaccounts/session`
- `POST /api/subaccounts/codex-credential`
- `POST /api/subaccounts/registration/start`，可传 `mailGroup`
- `GET /api/subaccounts/registration/jobs`
- `POST /api/subaccounts/registration/jobs/:jobId/retry`
- `PATCH /api/subaccounts/:id/local-profile`
- `POST /api/subaccounts/:id/refresh`
- `PATCH /api/subaccounts/:id/personal-settings`
- `DELETE /api/subaccounts/:id`
- `POST /api/subaccounts/:id/codex-auth/start`，可传 `chatgptAccountId`
- `GET /api/subaccounts/codex-auth/status`
- `POST /api/subaccounts/:id/codex-auth/auto`，可传 `chatgptAccountId`
- `POST /api/subaccounts/:id/codex-auth/personal-access-token`，可传 `chatgptAccountId`
- `POST /api/subaccounts/:id/codex-auth/callback`
- `GET /api/subaccounts/:id/codex-credential?chatgptAccountId=...`
- `POST /api/subaccounts/:id/quota/refresh`，可传 `chatgptAccountId`
- `POST /api/subaccounts/:id/team-invites`
- `POST /api/subaccounts/:id/team-links/sync`
- `GET /api/subaccounts/:id/logs`
- `GET /api/subaccounts/logs`

## 未纳入当前实现

当前不实现注册阶段 sentinel 的真实浏览器 SDK 级通过、人机校验稳定自动通过、账号锁定恢复、短信接码渠道 UI 管理，也不调用 mail-auto。自动注册和自动授权可以使用运行环境已经提供的 GongXi-Mail 与 YAML 短信 OTP 能力；账号锁定会被标记为 `account_locked` 业务状态，但不会尝试解锁账号。team-manager 不保存或编辑这些连接配置。后续如要继续增强注册/登录执行器，必须继续用真实请求协议补齐脱敏原始接口样本，至少包括：

- 注册起始请求与响应结构
- 手机号输入请求与响应结构
- 短信验证码提交请求与响应结构
- 二次验证只需验证码时的请求与响应结构
- 验证失败、人机校验、账号锁定等状态结构；验证码错误已有通用识别与重试逻辑，账号锁定已有独立状态，但仍需要真实脱敏响应样本校准文案和可恢复性判断

所有样本必须脱敏后放入 `docs/dev-spec/`，不得包含邮箱密码、token、手机号、验证码、cookie、真实代理地址或部署地址。
