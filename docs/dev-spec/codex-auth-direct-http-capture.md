# Codex Auth Direct HTTP Capture

本文件记录 2026-06-18 对 Codex Auth 授权页的脱敏抓包结论。`remote-browser` 仅用于调试与录制请求结构，不作为 team-manager 运行时链路。

## 目标

子号 Codex 凭证生成仍使用 OAuth authorization code + PKCE。运行时目标是由后端直接发送 HTTP 请求完成流程，而不是借助 Playwright。

## 已确认请求

### 1. 进入 Codex 授权 URL

```http
GET https://auth.openai.com/oauth/authorize?client_id=app_EMoamEEZ73f0CkXaXp7hrann&response_type=code&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid+email+profile+offline_access&state=<state>&code_challenge=<challenge>&code_challenge_method=S256&prompt=login&id_token_add_organizations=true&codex_cli_simplified_flow=true
```

远程浏览器中已有 auth.openai.com 登录态时，服务端返回：

```http
302 Location: https://auth.openai.com/choose-an-account
```

页面会加载 Cloudflare JS challenge。该步骤依赖 auth.openai.com 浏览器 cookie，浏览器请求没有携带 `Authorization: Bearer`。

### 2. 选择已登录账号

在 `https://auth.openai.com/choose-an-account` 点击目标账号后，页面发送：

```http
POST https://auth.openai.com/api/accounts/session/select
Content-Type: application/json

{"session_id":"<auth-account-session-id>"}
```

响应：

```http
200 Content-Type: application/json
```

本次实测随后跳转到：

```text
https://auth.openai.com/add-phone
```

页面状态是“电话号码是必填项”，说明该子号当前无法直接完成 Codex OAuth callback，需要手机号验证。

### 3. 后端 passwordless email OTP 登录

Codex OAuth URL 带 `login_hint=<email>` 后，auth 页面可能落在 `/log-in/password`。不强制使用密码时，可从该页面直接触发邮箱一次性码：

```http
POST https://auth.openai.com/api/accounts/passwordless/send-otp
Content-Type: application/json

<empty body>
```

响应：

```json
{
  "continue_url": "https://auth.openai.com/email-verification",
  "page": {
    "type": "email_otp_verification",
    "payload": {
      "email_verification_mode": "passwordless_login"
    }
  },
  "oai-client-auth-session": {
    "destination_app_name": "Codex",
    "openai_client_id": "app_EMoamEEZ73f0CkXaXp7hrann",
    "username": { "kind": "email", "value": "<email>" }
  }
}
```

GongXi-Mail 中真正的验证码邮件主题是 `Your temporary ChatGPT login code` 或 `Your temporary OpenAI verification code`，可能在 `junk`。不要从 `New sign-in to your OpenAI account` 安全提醒邮件里取 6 位数字。

验证码提交：

```http
POST https://auth.openai.com/api/accounts/email-otp/validate
Content-Type: application/json

{"code":"<6-digit-code>"}
```

实测成功后，`workspaces` 位于响应顶层 `oai-client-auth-session.workspaces`，不在 `page`：

```json
{
  "continue_url": "https://auth.openai.com/sign-in-with-chatgpt/codex/consent",
  "page": { "type": "sign_in_with_chatgpt_codex_consent" },
  "oai-client-auth-session": {
    "email_verified": true,
    "workspaces": [
      { "id": "<workspace-id>", "name": null, "kind": "personal" }
    ]
  }
}
```

### 4. Codex workspace consent

前端模块 `route-Gk2lYBYB.js` 的 client action 调用：

```http
POST https://auth.openai.com/api/accounts/workspace/select
Content-Type: application/json

{"workspace_id":"<workspace-id>"}
```

实测响应 `page.type` 为 `external_url`，`continue_url` 指向：

```text
https://auth.openai.com/api/oauth/oauth2/auth?client_id=app_EMoamEEZ73f0CkXaXp7hrann&...
```

随后按 302/303 跟随：

```text
/api/accounts/consent?consent_challenge=<...>
http://localhost:1455/auth/callback?code=<code>&scope=openid+email+profile+offline_access&state=<state>
```

如果进入 API organization 选择页，前端模块 `route-Dc1J7EFy.js` 的 client action 调用：

```http
POST https://auth.openai.com/api/accounts/organization/select
Content-Type: application/json

{"org_id":"<org-id>","project_id":"<project-id>"}
```

### 5. Token exchange

拿到 callback code 后：

```http
POST https://auth.openai.com/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code&
client_id=app_EMoamEEZ73f0CkXaXp7hrann&
code=<callback-code>&
redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&
code_verifier=<pkce-verifier>
```

响应包含 `access_token` / `refresh_token` / `id_token`，可转换为 CPA/Codex 兼容凭证 JSON。

## 当前 session JSON 的限制

team-manager 当前只保存子号 session JSON 的三项：

```json
{
  "user": { "email": "child@example.com" },
  "account": { "id": "<chatgpt account id>" },
  "accessToken": "<chatgpt web access token>"
}
```

最小实验确认：把该 `accessToken` 作为 `Authorization: Bearer` 请求 Codex OAuth authorize，不会进入已登录授权态，返回登录页。因此 `accessToken` 不能替代 auth.openai.com 的浏览器登录 cookie，也不能直接生成 OAuth authorization code。

## 直接请求实现前置条件

要把 Codex OAuth 完全自动化为后端 HTTP 请求，后端必须至少拥有以下登录态来源之一：

1. auth.openai.com 的有效登录 cookie，以及从 choose-account 页解析出的 `session_id`。
2. 子号邮箱 + 密码，并复用 chatgpt2api 已验证的 `password/verify` 请求协议完成登录。
3. auth.openai.com passwordless email OTP 流程可用，且系统能通过 GongXi-Mail 获取该邮箱的 OpenAI 验证码。
4. 系统内自动注册子号时，由注册流程直接持有 auth session，并继续执行 Codex authorize。

没有上述任一来源时，后端只能生成授权 URL 并等待用户手动完成 callback，不能仅凭 ChatGPT Web `accessToken` 自动完成 Codex OAuth。

## 后续待抓

- 注册分支已按 `screen_hint:"signup"`、`create_account_password`、`/api/accounts/user/register`、邮箱 OTP 和后续授权链路接入 worker；`user/register` 的 sentinel/proof token 仍需持续对照浏览器真实 SDK 验证。
- `add-phone` 提交手机号请求与响应结构已确认：`POST /api/accounts/add-phone/send`，body `{"phone_number":"+1...","channel":"sms"}`。
- `phone-otp` 提交短信验证码请求结构已确认：`POST /api/accounts/phone-otp/validate`，body `{"code":"<6-digit-code>"}`。
- curl_cffi worker 已把邮箱 OTP 错误换码重试、首次绑手机、已绑定手机号二次验证、`phone_otp_select_channel` 选 SMS、YAML 手机号池取号、短信验证码错误换候选码重试、FlareSolverr 人机校验继续尝试和号码用尽标记整理为可执行状态机。
- 仍需继续补齐验证码错误、人机校验、账号锁定等分支的脱敏原始响应样本，并用真实响应校准可恢复/不可恢复状态。
