# 母号子号本地资料编辑设计

## 目标

母号和子号支持编辑本地备注名 `label`，并支持重新录入 session JSON 更新本地凭证。该功能只修改 team-manager 的运行时持久化数据，不触发 ChatGPT 远端 Team 改名。

现有“修改 Team 名称”保留为母号远端 workspace 名称修改入口，避免与本地备注名混用。

## 范围

- 母号列表卡片增加“编辑本地资料”入口。
- 子号列表卡片增加“编辑本地资料”入口。
- 编辑弹窗包含本地备注名输入框和可选 session JSON 文本框。
- session JSON 为空时只更新 `label`。
- session JSON 非空时复用现有 `parseChatGptSessionInput` 校验并更新本地 session 字段。
- API 响应仍返回脱敏视图，不返回 `accessToken`、`refreshToken`、`webAccessToken` 或 Codex 凭证明文。

## 非目标

- 不修改 ChatGPT Team 远端 workspace 名称。
- 不修改成员名、成员邮箱、邀请邮箱或 Codex 凭证内容。
- 不把已有 session 明文回填到前端编辑框。
- 不新增批量编辑。

## 方案选择

推荐方案为独立“编辑本地资料”弹窗。录入和编辑使用相似的 session 解析规则，但编辑场景需要展示并修改 `label`，且 session 明文不可回填，因此不直接复用现有录入弹窗。

备选方案一是复用录入弹窗并增加编辑模式。代码量较少，但“录入”和“编辑”在空 session、保留旧凭证等语义上不同，后续维护容易误解。

备选方案二是拆成“改备注名”和“更新 session”两个入口。语义清楚，但列表菜单操作过碎，不适合当前后台密集操作场景。

## 后端设计

新增母号本地编辑接口：

```http
PATCH /api/accounts/:id/local-profile
Content-Type: application/json

{
  "label": "本地备注名",
  "session": {
    "user": { "email": "owner@example.com" },
    "account": { "id": "workspace-account-id" },
    "accessToken": "..."
  }
}
```

`session` 字段可省略。处理规则：

- `label` 必须是非空字符串，保存前 `trim`。
- `session` 存在时必须符合现有 session JSON 格式。
- 更新母号 session 时写入 `email`、`accountId`、`accessToken`。
- 更新 session 后清空 `lastError`，保留成员、邀请、默认席位等缓存，后续由用户手动刷新校正。
- 找不到母号返回 404，非法输入返回 400。

新增子号本地编辑接口：

```http
PATCH /api/subaccounts/:id/local-profile
Content-Type: application/json

{
  "label": "本地备注名",
  "session": {
    "user": { "email": "child@example.com" },
    "account": { "id": "child-chatgpt-account-id" },
    "accessToken": "..."
  }
}
```

处理规则：

- `label` 必须是非空字符串，保存前 `trim`。
- `session` 存在时必须符合现有 session JSON 格式。
- 更新子号 session 时写入 `email`、`chatgptAccountId`、`webAccessToken`。
- 保留 Codex 凭证、Team 关联和授权日志。
- 更新 session 后清空 `lastError`，状态按现有凭证判断为 `codex_ready` 或 `session_ready`。

## 前端设计

新增本地资料编辑弹窗组件。弹窗接收当前 `label`、标题、说明、保存回调。

控件：

- `备注名` 文本输入框，默认填当前 `label`。
- `Session JSON` 文本框，默认空白，用于粘贴新的 session JSON。
- `识别邮箱` 只读输入框，仅在文本框内 JSON 可解析时显示解析出的 `user.email`。
- 保存按钮在备注名为空或请求处理中禁用。

母号卡片菜单：

- “编辑本地资料”调用本地编辑弹窗。
- “修改 Team 名称”继续调用远端改名接口。
- “删除母号”保持不变。

子号卡片菜单：

- “编辑本地资料”调用本地编辑弹窗。
- “删除子号”保持不变。

保存成功后合并返回的视图到当前列表，并保持当前选中项。

## 数据流

1. 前端打开编辑弹窗，只带入脱敏视图中的 `label`。
2. 用户保存备注名，或同时粘贴新的 session JSON。
3. 后端校验输入并更新 `data/accounts.json` 或 `data/subaccounts.json`。
4. 后端返回脱敏 `AccountView` 或 `SubaccountView`。
5. 前端用返回值更新列表和详情区。

## 错误处理

- 备注名为空：前端禁用保存，后端仍返回 400。
- session JSON 格式不支持：后端返回解析错误文案。
- 记录不存在：后端返回 404。
- 保存失败：前端在当前页面 banner 中显示错误，不关闭弹窗。

## 测试

后端测试：

- 母号本地编辑可只更新 `label`，不调用 ChatGPT 远端。
- 母号本地编辑可更新 session 字段，响应不泄露 token。
- 母号非法 session 返回 400。
- 子号本地编辑可只更新 `label`，保留 Codex 凭证和 Team 关联。
- 子号本地编辑可更新 session 字段，响应不泄露 token。
- 子号非法 session 返回 400。

前端验证：

- 母号卡片菜单可打开编辑弹窗，保存后列表标题更新。
- 子号卡片菜单可打开编辑弹窗，保存后列表标题更新。
- session 文本框不会预填旧 token。
