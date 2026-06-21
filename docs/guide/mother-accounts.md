# 母号与 Team 管理

母号是 Team workspace 的管理入口。系统通过母号 session 调用 ChatGPT Web backend-api，完成成员、邀请、默认席位和 Team 名称相关操作。

## 录入母号

母号录入只接受 chatgpt.com session JSON：

```json
{
  "user": {
    "email": "owner@example.com"
  },
  "account": {
    "id": "<workspace-account-id>"
  },
  "accessToken": "<JWT>"
}
```

录入后先创建本地记录。ChatGPT 远端状态需要在母号详情页点击“刷新”获取。

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

## 邀请成员

母号详情页右上角菜单进入“邀请新成员”。邀请时需要填写邮箱并选择席位类型：

- Codex 席位：适合作为默认安全选择，不占用固定 ChatGPT 席位。
- ChatGPT 席位：会占用固定席位，可能产生额外账单。

邀请 ChatGPT 席位或切换成员到 ChatGPT 席位时，如果当前 ChatGPT 席位已达到限制，页面会显示账单风险确认。取消后不执行远端操作；确认后才继续。

## 待处理邀请

母号详情页右上角菜单进入“查看待处理邀请”。待处理邀请列表支持刷新和撤销。

pending invite 与正式 member 需要区分。子号处于 pending invite 时，仍可能在 Codex 授权阶段看到目标 Team workspace；但本地 Team 关联状态应保持为 `invited`，直到同步到成员列表后才变为 `member`。

## 成员席位和移出成员

成员列表支持修改单个成员席位。将成员切到 ChatGPT 席位时适用同一账单风险确认规则。

移出成员不是常规腾 ChatGPT 席位手段。为避免破坏该账号在目标 Team 下已有凭证，腾位应优先把成员从 ChatGPT 席位切到 Codex 席位。

## Team 改名与本地备注

Team 改名修改远端 workspace 名称。本地备注名 `label` 只影响本系统列表展示，不修改 ChatGPT 远端 Team 名称。

编辑母号本地资料可只修改备注名，也可同时替换 session。替换 session 时，旧 session 明文不会回填到前端。
