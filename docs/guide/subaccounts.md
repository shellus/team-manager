# 子号与 PAT 凭证

## 创建或录入子号

推荐使用“自动注册”。按钮发起任务后立即释放，子号列表出现独立任务项并展示进度。任务保存在注册服务中，刷新页面不会丢失。

也可以手动录入 chatgpt.com `/api/auth/session` JSON：

```json
{
  "user": { "email": "child@example.com" },
  "account": { "id": "<chatgpt-account-id>" },
  "accessToken": "<JWT>",
  "sessionToken": "<next-auth session token>"
}
```

建议保留 `sessionToken`，这样同一子号加入多个 Team 后，系统可以按目标 workspace 换取 Web access token。

## 本地资料与设置

子号本地资料可编辑备注、分组、代理和 Web Session。注册资料单独显示自动注册密码、注册时间、来源和 Cloak profile。

“设置”页提供：

- 用户名和显示名
- 营销 Push 与营销 Email
- 记忆开关
- reset credits 只读信息
- Session Cookie 与 Web access token 的独立检查结果

## Team 关联

邀请子号加入 Team 后，在“Team 关联”页刷新。系统使用子号自己的 Web Session 读取可见 workspace 和席位状态，不使用母号凭证代查。

一个子号可以加入多个 Team。PAT 和额度都按“子号 × Team workspace”分别保存。

## 创建 PAT

进入“PAT 凭证”页签，在目标 Team 行点击“创建 PAT”。系统会：

1. 按目标 workspace 获取 Web access token。
2. 调用 ChatGPT 的个人访问令牌接口。
3. 校验返回的 workspace 与目标一致。
4. 保存 PAT 文件和元数据。

页面只提供四个凭证动作：

- 创建或重新创建 PAT
- 刷新额度
- 下载 PAT
- 删除 PAT

PAT 必须由当前子号 Web Session 针对目标 workspace 创建。

## 额度

“刷新额度”使用目标 PAT 调用 `/backend-api/wham/usage`。结果按 workspace 缓存，不同 Team 的额度互不影响。

## 常见问题

- 创建 PAT 返回 workspace 不一致：重新录入含 `sessionToken` 的当前 ChatGPT Session，并确认子号已加入目标 Team。
- 创建 PAT 被拒绝：检查母号 Team 是否允许成员创建个人访问令牌，以及子号的席位与成员状态。
- 额度返回 401：确认子号仍在目标 Team，然后重新创建该 Team 的 PAT。
- 注册等待人工处理：完成注册服务保留 profile 中的人机验证，再点击“人工验证后继续”。
