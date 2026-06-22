# 子号与 Codex 凭证

子号页管理子号本地资料、Team 关联、Codex 授权、已有凭证导入、额度缓存和授权日志。子号可以只有 Codex 凭证，没有 Web session。

## 子号录入方式

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

录入后子号进入子号池，页面显示 Web Session 已录入。该 session 用于 ChatGPT Web 请求和后续授权流程。

### 导入已有 Codex 凭证

已有 CPA/Codex auth JSON 可以通过“导入凭证”录入。导入内容需要包含 `email`、`account_id`、`access_token`、`refresh_token`、`id_token`、`last_refresh`、`expired` 和 `type:"codex"`。

导入时可填写自定义文件名和 CPA 号池。系统按 `credential.email` 创建或更新子号，按 `credential.account_id` 保存对应 Team workspace 的 Codex 凭证元数据，并把 credential JSON 写入独立凭证文件。该子号可以没有 Web session，页面会显示“无 Web Session”和对应凭证数量。

## 子号 Team 关联

子号页的“Team 关联”通过子号邮箱逐个查询已录入母号的成员和 pending invite：

- 查到正式成员时，状态为 `已在 Team`。
- 查到待处理邀请时，状态为 `邀请中`。
- 曾经有记录但本次查不到时，状态为 `未找到`。
- 单个母号查询失败时，状态为 `未确认`。

Team 关联是本地缓存，不是唯一事实来源。邀请子号进入 Team 后，需要刷新 Team 关联。

## 邀请子号进入 Team

当前网页主入口是在母号页使用“邀请新成员”，填写子号邮箱并选择席位类型。邀请完成后，到子号页点击“刷新”同步 Team 关联。

后端也提供 `POST /api/subaccounts/:id/team-invites` 用于自动化调用。该 API 会用子号邮箱发起母号邀请，并写入本地 `teamLinks[].status = "invited"`。

## Codex 授权

子号在某个 Team 下使用 Codex 额度，需要生成绑定该 Team workspace 的 Codex 凭证。一个子号加入多个 Team 时，需要分别保留多份凭证。

子号页的“凭证与 Codex Auth”按 Team workspace 展示操作行。操作行会显示 Team、凭证文件名、CPA 号池、授权时间和额度缓存；如果凭证已导入但 Team 关联还没同步，也会先按凭证里的 workspace `account_id` 显示。

- 自动授权：使用运行环境已配置的 worker、授权页面 clearance、GongXi-Mail 和可选短信 OTP 能力完成授权。
- 登录 URL：生成手动授权 URL。授权完成后，把 callback URL 粘贴回系统。
- 刷新额度：使用该 Team workspace 对应凭证查询 `/backend-api/wham/usage`。
- 凭证 JSON：显式导出该 Team workspace 对应的 Codex credential JSON。

如果自动授权运行能力不可用，页面会禁用自动授权入口，但保留登录 URL 手动授权。

## 自动授权运行能力

页面只读展示以下能力：

| 能力 | 含义 |
|---|---|
| worker | 后端能连接 curl_cffi worker |
| GongXi-Mail | 邮箱验证码读取能力已配置 |
| 短信接码 | 运行环境有可用短信 OTP 槽 |
| 授权页面 | 授权页面 clearance 能力已配置 |

这些连接参数属于运行环境配置。页面和公开文档不保存真实 URL、API key、手机号、接码渠道或本机路径。

## 凭证导入与重新授权的选择

- 已有可用 CPA/Codex auth JSON 时，优先导入已有凭证。
- 子号已加入目标 Team 但没有凭证时，按目标 Team 生成新凭证。
- 同一子号在另一个 Team 下使用额度时，不能改已有凭证字段，需要在目标 Team 下重新授权。
- 为同一 Team 腾 ChatGPT 席位时，优先切席位，不移除成员；后续切回 ChatGPT 席位即可继续复用同 Team 凭证。
