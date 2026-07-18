# 子号与 Codex 凭证

子号页管理子号本地资料、Team 关联、Codex 授权、已有凭证导入、额度缓存和授权日志。GPT 账号显示名统一来自 `email`，本地备注统一来自 `remark`。子号可以只有 Codex 凭证，没有 Web session。

## 子号录入方式

### 自动注册子号

子号页可通过“自动注册”申请 GongXi-Mail 邮箱，并为该邮箱创建独立 CloakBrowser profile，在真实浏览器页面中完成 OpenAI 注册。完整顺序是：取邮箱、创建隔离 profile、进入 ChatGPT 注册入口、设置密码、验证邮箱验证码、填写姓名和生日、完成 ChatGPT 回调、访问 `chatgpt.com/api/auth/session` 取得 Web Session、录入为子号，最后把邮箱转移到已注册分组。

点击开始后，按钮只在创建后台任务期间短暂显示 loading。任务创建成功后，子号列表立即出现注册任务项，并显示邮箱分配、验证码、资料提交和 Web Session 获取进度；页面仍可继续操作。任务状态保存在运行数据中，刷新页面不会丢失。注册完成后任务项自动变为正常子号记录；自动注册密码、注册时间和来源集中显示在子号详情的“注册资料”页签，可直接复制。

注册任务失败或服务重启中断后，任务项提供重试按钮。若任务已经分配并保存邮箱与密码，重试会继续使用同一邮箱和密码。Cloudflare/CAPTCHA 前两次会自动删除 profile、执行可选换 IP hook 并从头重试；第三次仍失败时任务显示“等待人工处理”，保留最后一个 profile。人工验证完成后点击“人工验证后继续”，系统在同一 profile 中继续取得 `/api/auth/session`。

自动注册只负责账号注册和 Web Session 录入，不生成 Codex OAuth 或 PAT 凭证。每个邮箱都保留自己的设备指纹、Cookie、登录环境和家宽代理 sid，不和其他邮箱共享。部署启用 Mihomo 分流时，ChatGPT/OpenAI 登录与 API 主域名使用家宽，`oaistatic.com`、`cdn.openai.com` 等静态/CDN 域名使用普通代理，减少家宽计费流量。该自托管实例的注册追踪日志会原样保存请求头、请求体、响应头、响应体、Cookie、邮箱、密码、验证码、Session、页面截图、HTML、Playwright trace 与错误堆栈，便于完整排障；这些日志属于高敏感运行数据，不应对外公开。

### 录入子号 session

子号 Web 登录态只支持 chatgpt.com `/api/auth/session` 输出的 session JSON。输入框会即时识别类型并显示提示。

```json
{
  "user": {
    "email": "child@example.com"
  },
  "account": {
    "id": "<chatgpt-account-id>"
  },
  "accessToken": "<JWT>",
  "sessionToken": "<next-auth session token>"
}
```

该输入中的 `accessToken` 绑定 `account.id` 对应的当前 workspace；如果同时包含 `sessionToken`，系统会保存 `sessionToken`。页面会提示“识别到含 sessionToken 的 session JSON，将允许跨 workspace 操作”。

创建 Codex 个人访问令牌时，若子号保存了 session JSON 的 `sessionToken`，系统会向 ChatGPT `/api/auth/session` 换取目标 workspace 的 Web access token；多 workspace 子号只需录入一次带 `sessionToken` 的 session JSON，不需要为每个 workspace 分别录入 session。

子号侧 ChatGPT Web 请求也会复用 `sessionToken`。同步账号、同步 Team 关联或修改设置时，如果 backend-api 返回 401 `token_invalidated` 或 `token_revoked`，系统会按当前请求的 workspace 换取新的 Web access token，回写子号本地记录并重试一次。

录入后子号进入子号池，页面显示 Web Session 已录入。该 session 用于 ChatGPT Web 请求和后续授权流程。本地资料弹窗会回填已保存的 session JSON，便于直接检查或替换。

子号本地资料可配置独立代理地址 `proxy`。子号代理会用于子号侧 Team 关联同步、退出 Team、请求加入 K12 workspace、按 `sessionToken` 换取目标 workspace Web access token、创建 Team PAT/K12 凭证，以及刷新该子号 Codex 额度；未配置子号代理时，curl_cffi worker 才回退到运行环境全局代理。

## 个人资料、常用设置与 Web 登录态

子号详情页提供“同步账号”和“设置”页签。同步账号使用本系统后端完成以下步骤：

1. 用已保存的 `sessionToken` 请求 ChatGPT `/api/auth/session`，验证 Session Cookie 并回写新 Web access token。
2. 调用 `/backend-api/me` 验证 Web access token，并缓存个人 user id、显示名和头像。
3. 按 user id 读取 Calpico 个人资料，缓存用户名和显示名。
4. 读取营销通知设置与 `/backend-api/wham/rate-limit-reset-credits` 用量限制数据。

Session Cookie 与 Web access token 分别保存最近验证状态和时间。Session Cookie 有效但新 Web access token 被远端返回 `token_revoked` 时，页面会分别显示“有效”和“无效”，不会把两者合并成一个模糊状态。同步结果、错误正文以及成功响应原样写入子号运行日志，刷新页面后仍可查看。

设置页只管理子号个人空间中的常用项目，不复制母号 Team workspace 设置：

- 修改个人用户名和显示名。
- 开关营销 Push 与营销 Email 通知。
- 开关记忆；远端没有提供已确认可用的读取接口，因此首次同步时显示“未知”，用户修改后再保存明确状态。
- 只读展示 reset credits 的当前可用数、累计获得数和原始 credits 明细。

登录态区域分别显示 Session Cookie 与 Web Access Token 的验证状态。未知值会明确标记为“未知”或“尚未同步”，不会伪装成关闭状态。

### 导入已有 Codex 凭证

已有 CPA/Codex auth JSON 可以通过“导入凭证”录入。导入内容需要包含 `email`、`account_id`、`access_token`、`last_refresh`、`expired` 和 `type:"codex"`。OAuth 凭证还需要 `refresh_token` 和 `id_token`；Codex 个人访问令牌凭证可使用 `personal_access_token` / `access_token` 和 `auth_mode:"personalAccessToken"`，不需要 `refresh_token` 或 `id_token`。

导入时可填写自定义文件名和 CPA 号池。系统按 `credential.email` 创建或更新子号，按 `credential.account_id` 保存对应 Team workspace 的 Codex 凭证元数据，并把 credential JSON 写入独立凭证文件。该子号可以没有 Web session，页面会显示“无 Web Session”和对应凭证数量。

## 子号 Team 关联

子号页的“Team 关联”优先使用子号自己的 ChatGPT Web session 调用 `accounts/check`，读取该子号当前可见的 workspace 列表，再和已录入母号的 workspace `account_id` 做匹配：

- 子号可见且本地已录入对应母号时，会继续用子号自己的 Web session 查询目标 workspace 的 users 列表，并按该子号成员记录里的 `seat_type` 更新席位，状态为 `已在 Team`。
- 若同步过程中子号 Web access token 已被远端失效，且本地保存了 `sessionToken`，系统会自动换取目标 workspace 的新 Web access token 后重试一次。
- 曾经有记录但本次查不到时，状态为 `未找到`。
- 没有 Web session 的 credential-only 子号不能从子号侧刷新 Team 关联；同步接口会返回错误，不使用母号凭证兜底读取。
- 单个目标 workspace 查询失败时，状态为 `未确认`。

Team 关联是本地缓存，不是唯一事实来源。邀请子号进入 Team 后，需要刷新 Team 关联。

## 邀请子号进入 Team

当前网页主入口是在母号页使用“邀请新成员”，填写子号邮箱并选择席位类型。邀请完成后，到子号页点击“刷新”同步 Team 关联。

后端也提供 `POST /api/subaccounts/:id/team-invites` 用于自动化调用。该 API 会用子号邮箱发起母号邀请，并写入本地 `teamLinks[].status = "invited"`。

## Codex 授权

子号在某个 Team 下使用 Codex 额度，需要生成绑定该 Team workspace 的 Codex 凭证。一个子号加入多个 Team 时，需要分别保留多份凭证。

子号页的“凭证与 Codex Auth”按 Team workspace 展示操作行。操作行会显示 Team、凭证文件名、CPA 号池、授权时间和额度缓存；如果凭证已导入但 Team 关联还没同步，也会先按凭证里的 workspace `account_id` 显示。

- 自动授权：使用运行环境已配置的 worker、授权页面 clearance、GongXi-Mail 和可选短信 OTP 能力完成授权。短信 OTP 能力可处理首次手机号绑定、已绑定手机号二次验证，以及验证码被拒后的候选码重试。
- 创建令牌：使用已录入的子号 Web Session 在目标 Team workspace 下创建 Codex 个人访问令牌，并保存为该 workspace 的凭证。若录入的 session JSON 含 `sessionToken`，系统会先按目标 workspace 换取 workspace-scoped Web access token，再调用 `wham/auth-credentials`。远端响应里的 `workspace_id` 必须和目标一致，否则系统返回错误并拒绝保存。该操作不会修改母号的个人访问令牌权限开关；如果目标 Team 未允许用户创建个人访问令牌，页面会显示远端错误。
- 若个人访问令牌能创建但 Codex CLI 或 CPA 调用仍返回 access enforcement 401，应先检查母号设置里的 Codex Local、个人访问令牌、设备代码身份验证和远程控制状态，再结合 OpenAI 远端返回判断是否为 workspace/成员授权规则问题。
- 登录 URL：生成手动授权 URL。授权完成后，把 callback URL 粘贴回系统。
- 刷新额度：使用该 Team workspace 对应凭证查询 `/backend-api/wham/usage`。
- 凭证 JSON：显式导出该 Team workspace 对应的 Codex credential JSON。

如果自动授权运行能力不可用，页面会禁用自动授权入口，但保留登录 URL 手动授权。

官方 Codex CLI 支持 `at-...` 个人访问令牌作为独立认证方式，保存时只需要 `personal_access_token`，不需要 OAuth 的 `refresh_token` 或 `id_token`。team-manager 导出的这类凭证会标记 `auth_mode:"personalAccessToken"`，并同时保留 `access_token` 供额度刷新使用。

## 自动授权运行能力

页面只读展示以下能力：

| 能力 | 含义 |
|---|---|
| worker | 后端能连接 curl_cffi worker |
| GongXi-Mail | 邮箱验证码读取能力已配置 |
| 自动注册 | CloakBrowser 与 GongXi-Mail 均可用，可创建邮箱独立 profile 并执行页面注册 |
| 短信接码 | 运行环境 YAML 手机号池有可用短信 OTP 槽；页面只显示可用和用尽数量 |
| 授权页面 | 授权页面 clearance 能力已配置 |

这些连接参数属于运行环境配置。页面和公开文档不保存真实 URL、API key、手机号、接码渠道、手机号池文件路径或本机路径。号码达到 OpenAI 可绑定账号数量上限后，worker 会在 YAML 池中标记为用尽，后续新账号取号会跳过该号码。

## 凭证导入与重新授权的选择

- 已有可用 CPA/Codex auth JSON 时，优先导入已有凭证。
- 子号已加入目标 Team 但没有凭证时，按目标 Team 生成新凭证。
- 同一子号在另一个 Team 下使用额度时，不能改已有凭证字段，需要在目标 Team 下重新授权。
- 为同一 Team 腾 ChatGPT 席位时，优先切席位，不移除成员；后续切回 ChatGPT 席位即可继续复用同 Team 凭证。
