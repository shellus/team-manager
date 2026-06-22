# Subaccount Management

本文件记录子号管理当前实现边界。运行时主链路不使用 Playwright。Codex 自动授权会通过 curl_cffi worker 调用 auth.openai.com，并使用运行环境配置的授权页面 clearance、GongXi-Mail 邮箱验证码和可选短信 OTP 能力；额度查询不对接外部 credential-status 服务，仅参考 CPA 的凭证格式与额度解析方式，直接用目标 Team workspace 对应的子号 Codex 凭证查询额度。

GongXi-Mail、短信接码、Flaresolverr/curl_cffi worker 地址和相关密钥属于部署运行配置，不是 team-manager 的业务数据。源码和公开文档只描述能力边界；真实连接参数放在运行环境变量、部署目录或本机私有文档中。页面只通过脱敏状态检查展示这些能力是否可用，不提供密钥、域名、路径、手机号或接码渠道编辑入口。

## 已实现

- 子号池：`data/subaccounts.json` 和 `data/subaccount-credentials/<subaccountId>/`
  - 记录邮箱、备注名、ChatGPT account id、web session 状态、按 Team workspace 保存的 Codex 凭证状态，以及该子号加入过的母号关系。
  - `codexCredentials[]` 按凭证里的 `credential.account_id` 保存多份凭证元数据；真实 CPA/Codex auth JSON 写入独立凭证文件。
  - 凭证元数据包含 `accountId`、`fileName`、`groupName`、`planType`、授权时间和额度缓存。`groupName` 用于展示该凭证所在 CPA 号池。
  - API 默认只返回脱敏视图，不返回 `access_token` / `refresh_token` / `id_token`。
- 子号 session JSON 录入：
  - 只接受一种格式：`user.email`、`account.id`、`accessToken`。
  - 不支持扁平字段，不做回退兼容。
- 已有 Codex credential 录入：
  - `POST /api/subaccounts/codex-credential` 接受 CPA/Codex 兼容 auth JSON，或 `{ credential, fileName, groupName }` 包装格式。
  - 按 `credential.email` 创建或更新子号，按 `credential.account_id` 保存对应 Team workspace 凭证。
  - `fileName` 为独立凭证文件名，`groupName` 为 CPA 号池名；缺省文件名由邮箱和 workspace 派生，缺省号池为 `默认号池`。
  - 该子号可以没有 ChatGPT Web session；响应只返回 `hasWebSession:false` 和脱敏的 credential view。
- 子号本地资料编辑：
  - `PATCH /api/subaccounts/:id/local-profile` 支持修改本地备注名 `label`。
  - 请求带新的 session JSON 时更新 `email`、`chatgptAccountId`、`webAccessToken`。
  - 保留已有 Codex 凭证、Team 关联和授权日志，响应仍为脱敏视图。
- Codex Auth 授权：
  - 使用 OAuth authorization code + PKCE。
  - 固定 redirect URI：`http://localhost:1455/auth/callback`。
  - 自动授权：后端创建带 `login_hint` 的 OAuth 会话，curl_cffi worker 获取 auth.openai.com clearance，触发 `passwordless/send-otp`，从 GongXi-Mail 的 inbox/junk 读取 OpenAI code 邮件，完成 `email-otp/validate`、目标 `workspace/select`、callback 和 token exchange。
  - 手动兜底：前端按目标 Team 展示登录 URL，用户授权后把 callback URL 粘贴回系统。
  - 两条链路最终都生成 CPA/Codex 兼容 JSON，并按目标 Team workspace 写入独立凭证文件。
  - 如果手动授权返回的 `chatgpt_account_id` 与目标 Team workspace 不一致，后端返回 409 并拒绝保存。
  - 若自动授权遇到 `add_phone` / `phone_otp_verification` / `auth_challenge`，子号状态写为 `verification_required`，日志记录脱敏阶段信息。
- 自动授权运行能力检查：
  - `GET /api/subaccounts/codex-auth/status` 返回 worker 是否配置、worker 是否可连接、GongXi-Mail 是否可用、短信 OTP 能力是否可用、授权页面 clearance 是否可用。
  - 响应只包含布尔状态、可选数量和脱敏错误摘要，不返回真实 URL、key、手机号、文件路径或接码渠道配置。
  - 前端在子号页面的“凭证与 Codex Auth”区域只读展示这些能力；配置缺失时禁用自动授权入口，仍保留登录 URL 手动授权。
- 子号加入母号：
  - 选择本地已录入的母号和席位类型。
  - 后端用子号邮箱调用母号邀请接口。
  - ChatGPT 席位账单风险仍复用 `TeamService.invite` 的统一确认机制。
- Team 关联同步：
  - `teamLinks` 是本地缓存，不是唯一事实来源。
  - 点击同步时，后端按子号邮箱逐个查询已录入母号的 members 和 pending invites。
  - 查到成员写入 `member`，查到 pending invite 写入 `invited`。
  - 曾经有本地记录但本次查不到时写入 `removed`；单个母号查询失败时保留该条并写入 `unknown`。
  - 不在进入页面时自动同步，避免多个母号慢请求阻塞子号详情页。
- 凭证额度查询：
  - 直接使用目标 Team workspace 对应的子号 Codex 凭证里的 `access_token`。
  - 同时使用凭证里的 `account_id` 作为 `Chatgpt-Account-Id` 请求头，保持和 CPA Codex executor 的账户上下文一致。
  - 请求 `GET /backend-api/wham/usage`。
  - 解析 `rate_limit.primary_window`、`secondary_window`、`additional_rate_limits`，输出 5 小时、7 天、月度和模型级窗口。
  - 刷新结果缓存到对应 `codexCredentials[].lastQuota` / `lastQuotaAt`，页面进入详情时先显示旧额度，再由用户按 Team 手动刷新。
  - 不对接外部 credential-status 服务。
- 验证与授权日志：
  - 追加写入 `data/subaccount-auth-logs.jsonl`。
  - 日志只保存阶段、状态、短消息和脱敏结构化元数据。

## API

- `GET /api/subaccounts`
- `POST /api/subaccounts/session`
- `POST /api/subaccounts/codex-credential`
- `PATCH /api/subaccounts/:id/local-profile`
- `DELETE /api/subaccounts/:id`
- `POST /api/subaccounts/:id/codex-auth/start`，可传 `chatgptAccountId`
- `GET /api/subaccounts/codex-auth/status`
- `POST /api/subaccounts/:id/codex-auth/auto`，可传 `chatgptAccountId`
- `POST /api/subaccounts/:id/codex-auth/callback`
- `GET /api/subaccounts/:id/codex-credential?chatgptAccountId=...`
- `POST /api/subaccounts/:id/quota/refresh`，可传 `chatgptAccountId`
- `POST /api/subaccounts/:id/team-invites`
- `POST /api/subaccounts/:id/team-links/sync`
- `GET /api/subaccounts/:id/logs`
- `GET /api/subaccounts/logs`

## 未纳入当前实现

当前不实现系统内自动注册、手机号首次绑定、短信接码渠道管理、二次验证识别，也不调用 mail-auto。自动授权可以使用运行环境已经提供的短信 OTP 能力，但 team-manager 不保存或编辑这些连接配置。后续如要做完整注册/登录执行器，必须继续用真实请求协议补齐脱敏原始接口样本，至少包括：

- 注册起始请求与响应结构
- 手机号输入请求与响应结构
- 短信验证码提交请求与响应结构
- 二次验证只需验证码时的请求与响应结构
- 验证失败、验证码错误、人机校验、账号锁定等状态结构

所有样本必须脱敏后放入 `docs/dev-spec/`，不得包含邮箱密码、token、手机号、验证码、cookie、真实代理地址或部署地址。
