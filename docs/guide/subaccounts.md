# 子号与 Codex 凭证

子号页管理子号本地资料、Team 关联、Codex 授权、已有凭证导入、额度缓存和授权日志。子号可以只有 Codex 凭证，没有 Web session。

## 子号录入方式

### 自动注册子号

子号页可通过“自动注册”调用运行环境 worker 申请 GongXi-Mail 邮箱并注册 OpenAI 账号。注册流程会生成随机密码，密码只保存在后端运行时数据，不在页面、普通 API view 或授权日志中展示。若分配到已存在、已注册或被占用的邮箱，worker 会自动重新取邮箱，不会把这类脏邮箱作为新子号落库。

自动注册会继续尝试完成 Codex 授权；成功后页面显示对应 Team workspace 的 Codex 凭证。注册阶段遇到 sentinel、人机校验或短信问题时，子号会进入待验证或异常状态；账号锁定会进入单独的账号锁定状态。日志只展示脱敏阶段信息。对这类已落库账号再次点击“自动授权”时，后端会复用私有保存的注册密码继续登录，但页面和日志仍不会展示密码。

### 录入子号 session

子号 session 录入只接受 chatgpt.com session JSON：

```json
{
  "user": {
    "email": "child@example.com"
  },
  "account": {
    "id": "<chatgpt-account-id>"
  },
  "accessToken": "<JWT>"
}
```

session JSON 可额外携带同一浏览器登录态的 `cookies` 数组。创建 Codex 个人访问令牌时，系统会用这些 cookie 设置 `_account=<目标 workspace>` 并向 ChatGPT `/api/auth/session` 换取目标 workspace 的 Web access token；多 workspace 子号只需录入一次完整浏览器会话，不需要为每个 workspace 分别录入 session。

录入后子号进入子号池，页面显示 Web Session 已录入。该 session 用于 ChatGPT Web 请求和后续授权流程。旧 session 明文不会回填到前端。

### 导入已有 Codex 凭证

已有 CPA/Codex auth JSON 可以通过“导入凭证”录入。导入内容需要包含 `email`、`account_id`、`access_token`、`last_refresh`、`expired` 和 `type:"codex"`。OAuth 凭证还需要 `refresh_token` 和 `id_token`；Codex 个人访问令牌凭证可使用 `personal_access_token` / `access_token` 和 `auth_mode:"personalAccessToken"`，不需要 `refresh_token` 或 `id_token`。

导入时可填写自定义文件名和 CPA 号池。系统按 `credential.email` 创建或更新子号，按 `credential.account_id` 保存对应 Team workspace 的 Codex 凭证元数据，并把 credential JSON 写入独立凭证文件。该子号可以没有 Web session，页面会显示“无 Web Session”和对应凭证数量。

## 子号 Team 关联

子号页的“Team 关联”优先使用子号自己的 ChatGPT Web session 调用 `accounts/check`，读取该子号当前可见的 workspace 列表，再和已录入母号的 workspace `account_id` 做匹配：

- 子号可见且本地已录入对应母号时，会继续用子号自己的 Web session 查询目标 workspace 的 users 列表，并按该子号成员记录里的 `seat_type` 更新席位，状态为 `已在 Team`。
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
- 创建令牌：使用已录入的子号 Web Session 在目标 Team workspace 下创建 Codex 个人访问令牌，并保存为该 workspace 的凭证。若录入了浏览器 cookie，系统会先按目标 workspace 换取 workspace-scoped Web access token，再调用 `wham/auth-credentials`。远端响应里的 `workspace_id` 必须和目标一致，否则系统返回错误并拒绝保存。该操作不会修改母号的个人访问令牌权限开关；如果目标 Team 未允许用户创建个人访问令牌，页面会显示远端错误。
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
| 自动注册 | worker 可申请邮箱并执行注册入口 |
| 短信接码 | 运行环境 YAML 手机号池有可用短信 OTP 槽；页面只显示可用和用尽数量 |
| 授权页面 | 授权页面 clearance 能力已配置 |

这些连接参数属于运行环境配置。页面和公开文档不保存真实 URL、API key、手机号、接码渠道、手机号池文件路径或本机路径。号码达到 OpenAI 可绑定账号数量上限后，worker 会在 YAML 池中标记为用尽，后续新账号取号会跳过该号码。

## 凭证导入与重新授权的选择

- 已有可用 CPA/Codex auth JSON 时，优先导入已有凭证。
- 子号已加入目标 Team 但没有凭证时，按目标 Team 生成新凭证。
- 同一子号在另一个 Team 下使用额度时，不能改已有凭证字段，需要在目标 Team 下重新授权。
- 为同一 Team 腾 ChatGPT 席位时，优先切席位，不移除成员；后续切回 ChatGPT 席位即可继续复用同 Team 凭证。
