# ChatGPT Backend API Captures

本目录保存从 ChatGPT Web 页面抓到的 backend-api 请求样本。样本用于验证 team-manager 的请求路径、方法、header 口径和 body 结构。

## 脱敏规则

- `Authorization`、`Cookie`、token、session、账号凭证必须写成 `<redacted>`。
- 邮箱、workspace 名称、workspace id、org id、user id、subscription id、头像文件 id 必须写成占位符。
- 响应只保留验证接口所需的短片段或结构摘要。
- 样本文件应记录抓取日期、页面入口、操作、请求、响应、备注。

## 已确认样本

| 操作 | 样本 | 结论 |
|---|---|---|
| 成员列表 | [members-page.json](./members-page.json) | `GET /backend-api/accounts/{account_id}/users?offset=0&limit=25&query=` 返回 `items[].seat_type` |
| 账单页只读接口 | [billing-page.json](./billing-page.json) | 账单页会读取 subscription settings、seat_type_counts、invoice、pricing config 等接口 |
| 改 Team 名称 | [rename-team.json](./rename-team.json) | 使用 `PATCH /backend-api/accounts/{account_id}`，不是 `/settings` |
| 成员席位切到 ChatGPT | [member-seat-change-to-chatgpt.json](./member-seat-change-to-chatgpt.json) | 使用 `PATCH /backend-api/accounts/{account_id}/users/{user_id}`，body `{"seat_type":"default"}` |
| 成员席位切到 Codex | [member-seat-change-to-codex.json](./member-seat-change-to-codex.json) | 同一端点，body `{"seat_type":"usage_based"}` |
| 邀请成员 | [invite-member.json](./invite-member.json) | 使用 `POST /backend-api/accounts/{account_id}/invites`，body 包含 `email_addresses`、`role`、`seat_type`、`resend_emails` |
| 待处理邀请列表 | [pending-invites-page.json](./pending-invites-page.json) | 使用 `GET /backend-api/accounts/{account_id}/invites?offset=0&limit=25&query=` |
| 撤销邀请 | [revoke-invite.json](./revoke-invite.json) | 使用 `DELETE /backend-api/accounts/{account_id}/invites`，body `{email_address}` |
| 移除成员 | [remove-member.json](./remove-member.json) | 使用 `DELETE /backend-api/accounts/{account_id}/users/{user_id}`，body 为空 |
| 改默认席位 | [default-seat-type.json](./default-seat-type.json) | 使用 `POST /backend-api/accounts/{account_id}/settings/default_seat_type`，body `{value}` |

> 席位样本的 `records[].body` 可能为空，因为 Playwright 原生 request 事件没有读取页面 `Request` 对象 body；以同文件 `browser_request_log[].body` 为准。

## 待补样本

- 成员列表分页、搜索和 pending invite 状态
