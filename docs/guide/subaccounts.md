# 子号与 PAT 凭证

## 创建或录入子号

推荐使用“自动注册”。按钮发起任务后立即释放，子号列表出现独立任务项并展示进度。任务保存在注册服务中，刷新页面不会丢失。

Cloudflare 中间挑战页会先在自动阶段等待自行通过。持续存在时任务显示“等待人工处理”，后台仍监听原 profile；挑战通过后会自动恢复注册，并从当前验证码或资料页继续。服务重启也会复用原 profile 恢复监听。

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

子号本地资料可编辑备注、分组、代理和 Web Session。自动注册子号只额外显示规范化邮箱账号引用；注册密码、CloakBrowser Profile 和浏览器事件由 GPT Account Manager 管理。

“设置”页提供：

- 用户名和显示名
- 营销 Push 与营销 Email
- 记忆开关
- reset credits 只读信息
- Session Cookie 与 Web access token 的独立检查结果

## 开通 Pro 5x

通过 GPT Account Manager 注册并关联的子号，可在详情页直接开通个人账号 Pro 5x。该动作与子号是否加入 Team、是否已有 PAT 相互独立。

开通流程与母号一致：

1. 使用运行环境配置的新加坡国家代理和指定 ASN。
2. 在 ChatGPT 页面中创建 Prolite 5x custom Checkout，并直接进入站内付款页。
3. 使用弹窗中的信用卡字段或“卡号----有效期----CVC”快捷输入。
4. 自动填写新加坡账单地址并直接点击 Subscribe。
5. 任务结束后恢复账号原住宅代理配置。

遇到 Cloudflare、额外验证或页面暂时不可操作时，子号详情会持续显示任务状态，GAM Profile 保持现场可检查；人工完成验证后，后台会重新接管并继续创建 Checkout、填卡和提交。GAM 对未完成任务的付款资料加密持久化，服务热重载后自动恢复；旧任务缺少密文时，按钮会切换为“补充卡片并继续”，复用快捷输入把卡片交给原任务并立即恢复自动提交，无需终止任务。失败或手动终止的任务记录可清除后重新发起；Pro 5x 最终状态以 GAM 同步到的个人套餐为准。

## Team 关联

邀请子号加入 Team 后，在“Team 关联”页刷新。系统只使用子号自己的 Web Session 请求一次可见 workspace 列表，不使用母号凭证，也不逐 Workspace 查询成员。已有关联保留原席位类型，新发现的 Workspace 默认按 Codex 席位展示。

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
