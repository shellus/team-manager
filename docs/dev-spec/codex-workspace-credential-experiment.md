# Codex workspace credential experiment

记录日期：2026-06-18

## 问题

同一个子号同时在多个 ChatGPT Team workspace 中时，Codex 凭证是否可以通过更换 `Chatgpt-Account-Id` 请求头查询不同 workspace 的额度，还是必须为每个 workspace 单独生成凭证。

## 实验 A：同一凭证切换 `Chatgpt-Account-Id`

使用一个已在两个 Team 中的子号 Codex access token 请求：

`GET /backend-api/wham/usage`

请求头保持相同 `Authorization: Bearer <redacted>`，只改变 `Chatgpt-Account-Id`：

- 不带 `Chatgpt-Account-Id`
- 凭证 `id_token` claim 中的 `chatgpt_account_id`
- 该子号所在的另一个 Team workspace account id
- 其他未关联 Team workspace account id
- 随机 UUID

结果：

- HTTP 均为 200。
- 响应 body 的 `account_id` 始终是凭证 claim 中的原始 `chatgpt_account_id`。
- 传另一个真实 workspace 或随机 UUID 时，响应没有切换上下文。

结论：`/backend-api/wham/usage` 不接受通过请求头把一个 Codex token 切换到另一个 workspace。Codex token 本身带 workspace 绑定。

## 实验 B：按目标 workspace 自动授权

调整 worker 后，把目标 Team workspace account id 传入自动授权流程：

- auth.openai.com passwordless email OTP 正常完成。
- worker 在 Codex consent 的 `workspaces` 中选择目标 workspace。
- token exchange 后，`id_token` claim 中的 `chatgpt_account_id` 等于目标 workspace。
- 系统为同一个子号保存了第二份 Codex 凭证。

额度刷新：

- 对第二份 workspace 凭证请求 `/backend-api/wham/usage` 成功返回 JSON。
- 当前该 workspace 返回 `No quota windows`，系统按 `unavailable` 缓存到该 workspace 凭证记录。

## 实现要求

- 子号不能只存单个 `codexCredential`。
- Codex 凭证必须按 `subaccountId + chatgptAccountId` 维度保存。
- 导出凭证、刷新额度、自动授权、手动 callback 都应支持传入目标 `chatgptAccountId`。
- 如果手动授权时用户选择了错误 workspace，后端必须拒绝保存，避免把凭证挂到错误 Team。
