# 母号与 Team 管理

母号是 Team workspace 的管理入口。系统通过母号 session 调用 ChatGPT Web backend-api，完成成员、邀请、默认席位和 Team 名称相关操作。

## 录入母号

母号录入支持 chatgpt.com session JSON，也支持 Cookie Editor 等浏览器扩展导出的 cookies 数组。常用输入是 session JSON：

```json
{
  "user": {
    "email": "owner@example.com"
  },
  "account": {
    "id": "<workspace-account-id>"
  },
  "accessToken": "<JWT>",
  "sessionToken": "<next-auth session token>"
}
```

`sessionToken` 可用于后续按目标 workspace 换取 Web access token；旧导出内容如果没有该字段，系统仍可录入当前 workspace 的 `accessToken`。录入后先创建本地记录。ChatGPT 远端状态需要在母号详情页点击“刷新”获取。

新母号默认进入 `默认分组`。母号列表会默认选中第一个分组，只显示该分组中的母号；可在列表顶部切换其他分组。

## 刷新 Team 状态

母号详情页的“刷新”会更新 workspace 状态和本地缓存。成员列表、待处理邀请和默认席位各有独立刷新入口，页面会先显示已有缓存，再由操作员手动刷新。

刷新后的缓存用于派生以下展示：

- 成员数。
- ChatGPT 固定席位已用数量。
- 待处理邀请数。
- 默认席位。

这些值不是独立持久化字段。写操作成功后，系统会刷新或更新对应缓存并返回最新 view。

## 设置新成员默认席位

母号详情页右上角菜单进入“修改默认席位”。默认席位建议设为 Codex 席位。

默认席位只影响未显式指定席位的邀请。显式邀请 ChatGPT 席位仍可能占用固定席位并触发账单风险确认。

## 设置 Codex 邀请权限

母号详情页右上角菜单进入“Codex 邀请权限”。该设置对应 ChatGPT Web 的 `workspace_referrals_enabled`，页面名称为“允许成员发送 Codex 邀请”。

该设置不替代默认席位。为降低普通成员误邀造成固定席位超额的风险，仍应把新成员默认席位设为 Codex 席位。

## 设置个人访问令牌权限

母号详情页右上角菜单进入“个人访问令牌权限”。该设置对应 ChatGPT Web 的 `personal_access_tokens` beta feature，页面名称为“允许用户创建个人访问令牌”。

该设置控制 Team 成员是否可以创建个人访问令牌。写操作成功后，系统会更新本地母号 settings 缓存并返回最新 view。

## 设置 Codex Local 权限

母号详情页“席位与权限”会展示 `wham_local_access`，即“允许成员使用 Codex Local”。该字段来自完整 settings 读取，当前系统只读展示，不主动切换该开关。

同一区域可切换两个 Codex 相关 beta feature：

- `codex_device_code_auth`：为 Codex CLI 启用设备代码身份验证。
- `codex_remote_control`：允许成员远程发现并控制设备。

写操作使用 ChatGPT Web 的 `/backend-api/accounts/{account_id}/beta_features`，成功后会更新本地母号 settings 缓存并返回最新 view。

## 邀请成员

母号详情页右上角菜单进入“邀请新成员”。邀请时需要填写邮箱并选择席位类型：

- Codex 席位：适合作为默认安全选择，不占用固定 ChatGPT 席位。
- ChatGPT 席位：会占用固定席位，可能产生额外账单。

邀请 ChatGPT 席位或切换成员到 ChatGPT 席位时，如果当前 ChatGPT 席位已达到限制，页面会显示账单风险确认。取消后不执行远端操作；确认后才继续。

邀请时还可填写该邮箱在当前母号下的本地资料：

- 备注文本。
- 到期时间，默认当前日期加 30 天。
- 到期提醒，默认开启。
- 到期移除，默认关闭。

这些资料按“母号 × 邮箱”保存。邀请被接受后，邮箱从待处理邀请进入成员列表，原资料仍按邮箱关联展示。

## 待处理邀请

母号详情页右上角菜单进入“查看待处理邀请”。待处理邀请列表支持刷新和撤销。

pending invite 与正式 member 需要区分。子号处于 pending invite 时，仍可能在 Codex 授权阶段看到目标 Team workspace；但本地 Team 关联状态应保持为 `invited`，直到同步到成员列表后才变为 `member`。

待处理邀请列表支持编辑该邮箱的本地资料。编辑只更新 team-manager 本地数据，不调用 ChatGPT 远端接口。

## 成员席位和移出成员

成员列表支持修改单个成员席位。将成员切到 ChatGPT 席位时适用同一账单风险确认规则。

移出成员不是常规腾 ChatGPT 席位手段。为避免破坏该账号在目标 Team 下已有凭证，腾位应优先把成员从 ChatGPT 席位切到 Codex 席位。

成员列表也支持编辑同一份邮箱本地资料。`到期移除` 目前是运营标记，不会自动执行远端移出；移出成员仍需显式操作。

## 全局通知设置

页面顶栏的“通知设置”用于配置到期提醒：

- 提前提醒天数，默认 `3` 天。
- 每日触发时间，默认 `08:00`。
- 通用 Webhook、飞书、Telegram、企业微信等通知渠道。

通知任务每天按本地时间最多运行一次，扫描所有母号下开启到期提醒且到期日在提醒窗口内的邮箱资料，并扫描母号 Team 的下次续费时间。

## Team 改名、本地备注与分组

Team 改名修改远端 workspace 名称。GPT 账号显示名统一来自 `email`，备注使用 `remark`，两者都不修改 ChatGPT 远端 Team 名称。

编辑母号本地资料可修改备注 `remark`、母号分组 `groupName`、限额类型 `limitType`、下次续费时间 `nextRenewalOn`，也可同时替换 session。替换 session 支持 chatgpt.com session JSON 或浏览器 cookies 数组；session JSON 中的 `sessionToken` 会被保存为后续换取 workspace Web access token 的 cookie 材料。系统会用新 session 的 `user.email` 更新 `email`，旧 session 明文不会回填到前端。

分组用于区分自用、已出租车位等运营集合。分组只是本地展示和筛选字段，不影响远端 Team workspace。
