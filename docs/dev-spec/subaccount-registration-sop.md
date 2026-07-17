# 子号自动注册与 Web Session 录入 SOP

本文件记录“自动注册子号”按钮的职责、协议顺序、持久化边界和排错证据。Codex 凭证仍按 [`../core/seat-and-credential-model.md`](../core/seat-and-credential-model.md) 的“子号 × Team workspace”模型单独生成，不属于本按钮。

## 按钮职责

“自动注册子号”只完成以下闭环：

1. 从 GongXi-Mail 的待注册分组取得一个邮箱。
2. 通过 ChatGPT NextAuth 登录入口建立同一浏览器会话所需的 CSRF、state 和 Cookie。
3. 使用同一代理、浏览器指纹和 Cookie 会话进入 OpenAI 注册页。
4. 提交邮箱；若 OpenAI 默认进入 `passwordless_signup`，显式切换到同一注册会话支持的密码注册分支。
5. 生成随机强密码并调用账号注册接口。
6. 从 GongXi-Mail 读取 OpenAI 邮件验证码并完成验证。
7. 生成姓名和生日并提交账号资料。
8. 沿 OpenAI callback 返回 ChatGPT。
9. 访问 `https://chatgpt.com/api/auth/session`，取得 `user.email`、`account.id`、`accessToken` 和 NextAuth `sessionToken`。
10. 按子号 Web Session 模型写入 team-manager，同时保存注册密码。
11. 子号持久化成功后，把该邮箱转移到 GongXi-Mail 的已注册分组。

本按钮不邀请 Team、不选择 workspace、不执行 Codex OAuth、不生成 PAT，也不写入 Codex credential 文件。注册完成后的 Team 关联和凭证生成由子号页其他操作负责。

## 后台任务与页面状态

- `POST /api/subaccounts/registration/start` 只负责原子创建持久化任务并立即返回，不等待远端注册完成。
- 任务保存在 `data/subaccount-registration-jobs.json`；页面刷新后通过任务列表接口恢复排队、执行、失败或完成状态。
- worker 使用 NDJSON 事件流上报当前阶段，后端只把阶段、进度和邮箱摘要写入任务文件；密码、验证码、Cookie 和 Token 仍只进入完整原始日志。
- 当前后台队列按单任务串行执行，避免同一代理出口、FlareSolverr 和 JSON 数据文件发生并发竞争。
- 成功落库后任务关联 `subaccountId`，前端隐藏任务占位并显示正常子号记录；失败但已经取得邮箱时显示异常子号，取邮箱前失败则保留失败任务项。
- 服务进程重启时，尚未完成的任务标记为 `interrupted`，不会在刷新页面后消失或被误报为成功。
- 失败或中断任务显示重试按钮。已关联子号且保存了注册密码时，后端复用同一任务 id、邮箱和密码；取邮箱前失败时才重新开始邮箱分配。
- 自动注册密码、注册时间和来源只集中展示在子号详情的“注册资料”页签，不铺在概览或设置页。

## 关键协议

### ChatGPT NextAuth 会话

必须先在同一个 HTTP Session 中完成：

1. `GET https://chatgpt.com/api/auth/csrf`
2. `POST https://chatgpt.com/api/auth/signin/openai`
3. 沿返回的 OpenAI authorize URL 完成注册
4. 沿 callback 回到 `chatgpt.com`
5. 收集 `__Secure-next-auth.session-token`；如果 Cookie 被分片，则按 `.0`、`.1` 顺序拼接
6. `GET https://chatgpt.com/api/auth/session`

NextAuth 的 CSRF 响应正文 token 与 `__Host-next-auth.csrf-token` Cookie 左侧 token 偶尔不一致。提交 signin 时以当前 Session 中的 CSRF Cookie token 为准，并记录 `chatgpt_auth_csrf_cookie_mismatch` 原始事件；否则远端会以 200 返回 `https://chatgpt.com/api/auth/signin?csrf=true`，但实际上没有进入 OpenAI authorize 流程。

不能只拿 OpenAI 登录结果后另建 Session 请求 `/api/auth/session`，否则会丢失 NextAuth state 和 session Cookie。

### OpenAI 注册状态机

当前密码注册主链路为：

1. `POST /api/accounts/authorize/continue`，`screen_hint:"signup"`
2. 若响应已经是 `create_account_password`，直接继续；若响应是 `email_otp_verification` 且 `email_verification_mode:"passwordless_signup"`，按页面提供的“使用密码创建账户”分支继续
3. `POST /api/accounts/user/register`，提交邮箱和密码
4. `GET /api/accounts/email-otp/send`
5. `POST /api/accounts/email-otp/validate`
6. `POST /api/accounts/create_account`，提交姓名和生日
7. 沿 `continue_url` 完成 callback

注册请求使用稳定浏览器指纹，并在整条链路中复用同一个代理出口。Sentinel 按接口返回计算 proof-of-work；Turnstile 要把 `dx` 解为 SO token。创建账号资料时同时发送 `openai-sentinel-token`、`openai-sentinel-so-token`，并设置 `oai-sc` Cookie。

每个注册任务创建一个独占 FlareSolverr Session，并在 ChatGPT CSRF 与 OpenAI authorize 两次浏览器请求之间复用。任务结束后无论成功或失败都销毁该 Session。不同注册任务不得共享同一个浏览器 Session，避免 NextAuth、OpenAI 登录 Cookie 和账号状态串号。

## 邮箱与分组

- 待注册分组由 `TEAMMGR_GONGXI_MAIL_GROUP` 配置。
- 注册完成分组由 `TEAMMGR_GONGXI_MAIL_REGISTERED_GROUP` 配置。
- 邮箱只有在 Web Session 已验证并成功写入子号后才转移分组。
- 如果分组转移失败，已经录入的子号不回滚；子号保留错误状态和完整日志，便于重试邮箱收尾动作。
- 若候选邮箱已注册或被占用，worker 会重新取邮箱，最多尝试 `TEAMMGR_REGISTRATION_EMAIL_MAX_ATTEMPTS` 次。
- 对指定邮箱的失败任务重试时不换邮箱；若 signup 响应表明该邮箱已存在，worker 使用保存密码切换到登录流程，重新获取该账号的 Web Session。

## 原始日志

该自托管实例按排障需要保存完整原始注册日志，不做脱敏。日志包括：

- 代理出口探测结果
- GongXi-Mail 请求头、请求体、响应头和响应体
- 邮箱、生成密码、验证码、姓名和生日
- ChatGPT/OpenAI 请求头、请求体、响应头和响应体
- Sentinel proof、Turnstile 输入与 SO token
- 完整 Cookie、callback URL、Web Session 和 sessionToken
- 异常类型、错误文本和 Python traceback

这些日志包含可以直接登录账号的高敏感数据，只能保存在本机运行时数据和受控日志中，不应进入源码仓库、公开文档或外部日志平台。

## 失败边界

- 取邮箱失败：不创建子号。
- 注册尚未取得有效 Web Session：若已经取得邮箱和密码，可保留为待验证/异常子号，并记录完整追踪证据。
- Web Session 邮箱与注册邮箱不一致：视为失败，不以错误 Session 覆盖目标子号。
- 子号写入失败：不移动邮箱分组。
- 子号写入成功、邮箱分组转移失败：保留子号并记录 `lastError`，不得删除已注册账号。

## 与后续 Codex 流程的关系

注册成功只代表子号已拥有可用 ChatGPT Web Session。之后可按业务需要：

1. 邀请或同步子号的 Team 关联。
2. 在目标 Team workspace 下单独创建 PAT、K12 或 Codex OAuth 凭证。
3. 按目标 workspace 刷新 Codex 额度。

同一个子号加入多个 Team 时，仍需为每个目标 workspace 分别保留对应凭证，不能通过修改 `account_id` 复用已有凭证。
