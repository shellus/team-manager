# 子号自动注册与 Web Session 录入 SOP

本文件记录“自动注册子号”按钮的职责、协议顺序、持久化边界和排错证据。Codex 凭证仍按 [`../core/seat-and-credential-model.md`](../core/seat-and-credential-model.md) 的“子号 × Team workspace”模型单独生成，不属于本按钮。

## 按钮职责

“自动注册子号”只完成以下闭环：

1. 从 GongXi-Mail 的待注册分组取得一个邮箱。
2. 为该邮箱在 CloakBrowser-Manager 创建一个独立、持久化的浏览器 profile；不同邮箱不得共用 profile。
3. 使用配置的注册代理启动该 profile，并在真实 ChatGPT/OpenAI 页面中进入注册流程；运行环境可用 Mihomo 将登录/API 主域名送往独立家宽 sid，把静态/CDN 域名送往普通出口。
4. 提交邮箱并选择密码注册分支。
5. 生成随机强密码并在页面中填写。
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
- 浏览器执行器把页面阶段、邮箱、profile id/name 和进度写入任务文件；密码、验证码、Cookie、Token、页面请求响应和错误堆栈进入完整原始日志。
- 当前后台队列按单任务串行执行，避免同一代理出口和 JSON 数据文件发生并发竞争；profile 隔离已为后续受控并发保留边界。
- 成功落库后任务关联 `subaccountId`，前端隐藏任务占位并显示正常子号记录；失败但已经取得邮箱时显示异常子号，取邮箱前失败则保留失败任务项。
- 服务进程重启时，尚未完成的任务标记为 `interrupted`，不会在刷新页面后消失或被误报为成功。
- 普通失败或中断任务显示重试按钮。已关联子号且保存了注册密码时，后端复用同一任务 id、邮箱和密码；取邮箱前失败时才重新开始邮箱分配。
- 连续三次遇到 Cloudflare/CAPTCHA 后，任务进入 `waiting_manual`，最后一个 profile 保留。操作员在 CloakBrowser 中完成人工验证后，点击“人工验证后继续”，系统复用同一邮箱、密码和 profile 继续执行。
- 自动注册密码、注册时间和来源只集中展示在子号详情的“注册资料”页签，不铺在概览或设置页。

## 浏览器注册状态机

默认且唯一的自动注册执行器是 CloakBrowser。主链路为：

1. GongXi-Mail 分配邮箱，生成固定密码、姓名和生日。
2. 创建以邮箱命名的独立 profile，记录 `cloakProfileId` 和 `cloakProfileName`。
3. 打开 `chatgpt.com/auth/login` 建立认证会话；提交邮箱后由远端进入密码注册分支。
4. 在页面中依次填写邮箱、密码、邮箱验证码、姓名和生日，并处理可见的同意项。
5. 回到 `chatgpt.com` 后，在同一持久化浏览器上下文中访问 `/api/auth/session`。
6. 从浏览器 Cookie 中取得 `__Secure-next-auth.session-token`；如果 Cookie 被分片，则按 `.0`、`.1` 顺序拼接。
7. 校验 Session 邮箱与注册邮箱一致，再写入子号。

浏览器页面、Cookie、NextAuth state、OpenAI 登录态和设备指纹都随 profile 持久化。应用不再调用旧的 `/subaccounts/register` HTTP worker 注册接口；curl_cffi worker 仍可服务 Codex 自动授权和其他既有传输能力，但不参与新建子号注册。

注册页可能在 Cloudflare JS 校验成功后回到空邮箱表单，或在密码提交时短暂返回 `Operation timed out`。执行器会在同一 profile 内重新填写邮箱或点击 `Try again` 后重交密码；连续三次仍无法进入下一步骤时，才把它视为环境错误并重建 profile。

### Mihomo 分流边界

- `TEAMMGR_CLOAK_PROXY` 使用 `{session}` 占位符，每个新 profile 生成独立 Basic 用户名。
- Team Manager 把 sid 持久化，并为每个 sid 生成单独的家宽 SOCKS outbound；失败且删除 profile 时同步释放 sid，成功或等待人工的 profile 保留 sid。
- `oaistatic.com`、`oaiusercontent.com`、`cdn.openai.com` 等静态/CDN 域名优先走普通 HTTP 代理；其余该用户流量按 `IN-USER` 规则走家宽。
- 家宽 SOCKS 使用普通代理作为 `dialer-proxy`，避免容器直接连接境外上游。
- HTTPS CONNECT 只能看到目标主机名，不能区分 `chatgpt.com/api/*` 与同域名静态 path；因此同域名请求无法在不做 TLS MITM 的前提下按 path 分流。
- 动态 Mihomo 配置和 sid 列表属于运行时数据，不进入源码仓库；配置更新使用临时文件加 rename，并通过 controller 热加载。

### Cloudflare/CAPTCHA 策略

- 页面标题、正文、HTML 或 URL 出现 Cloudflare challenge、Turnstile、CAPTCHA 或“验证您是真人”等特征时，视为出口质量失败。
- 第 1、2 次遇到挑战：停止并删除当前 profile，调用可选的 `TEAMMGR_CLOAK_PROXY_ROTATE_URL` 换 IP hook，然后从注册起点创建新 profile 重试。
- 使用 `{session}` 家宽代理时，重建 profile 会自然生成新的 sid；当前只配置固定出口时，也可以不设置换 IP hook，系统会在完整日志中记录实际行为。
- 第 3 次仍遇到挑战：不再删除 profile，任务进入等待人工处理，保留邮箱、密码、profile 和完整证据。

## 邮箱与分组

- 待注册分组由 `TEAMMGR_GONGXI_MAIL_GROUP` 配置。
- 注册完成分组由 `TEAMMGR_GONGXI_MAIL_REGISTERED_GROUP` 配置。
- 邮箱只有在 Web Session 已验证并成功写入子号后才转移分组。
- 如果分组转移失败，已经录入的子号不回滚；子号保留错误状态和完整日志，便于重试邮箱收尾动作。
- 对指定邮箱的失败任务重试时不换邮箱。等待人工处理任务还会复用最后一个 profile；普通失败会保留邮箱和密码并新建隔离 profile。

## 原始日志

该自托管实例按排障需要保存完整原始注册日志，不做脱敏。日志包括：

- Cloak profile 创建、启动、停止、删除和换 IP hook 请求响应
- 每次页面截图、HTML 和 Playwright trace，保存在 `data/subaccount-registration-artifacts/<job-id>/attempt-<n>-<profile-id>/`
- GongXi-Mail 请求头、请求体、响应头和响应体
- 邮箱、生成密码、验证码、姓名和生日
- ChatGPT/OpenAI 请求头、请求体、响应头和响应体
- 页面 console、pageerror 以及 ChatGPT/OpenAI 网络请求响应
- 完整 Cookie、callback URL、Web Session 和 sessionToken
- 异常类型、错误文本和 JavaScript stack

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
