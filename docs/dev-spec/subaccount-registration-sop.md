# 子号注册服务对接 SOP

## 目标

Team Manager 不执行 GPT 注册，只向 GPT Account Manager 发起注册操作，并在操作成功后按邮箱取得业务所需 Web Session。

Team Manager 最终只保存：

- 规范化邮箱 `managedAccountEmail` 引用
- ChatGPT Web Session
- Team Manager 自己的分组、Team 关系和 PAT 数据

注册密码、CloakBrowser profile、验证码、代理和浏览器事件只保存在 Account Manager。

## 流程

1. 页面调用 `POST /api/subaccounts/registration/start`。
2. Team Manager 调用 Account Manager `POST /v1/accounts/register`，取得持久化账号操作。
3. 页面在子号列表展示操作进度，并通过 Team Manager 继续轮询。
4. Team Manager 查询 Account Manager `GET /v1/operations?type=register`。
5. 操作成功后，Team Manager 使用邮箱调用 `GET /v1/accounts/:email/session`。
6. Team Manager 按邮箱幂等录入子号，保存 `managedAccountEmail` 与 Web Session。
7. Team Manager 删除完成操作；Account Manager 保留受管账号、密码、Profile 和审计数据。

## 状态

| 状态 | 含义 |
|---|---|
| `queued` | 已进入 Account Manager 注册队列 |
| `running` | 浏览器流程正在执行 |
| `waiting_manual` | 连续三次 Cloudflare/CAPTCHA 后等待人工处理 |
| `succeeded` | 受管账号和 Web Session 已就绪 |
| `failed` | 流程失败，可按原邮箱重试 |
| `interrupted` | Account Manager 重启导致操作中断 |

## 原子性与幂等

- 注册操作由 Account Manager 持久化，页面刷新不会丢失。
- Team Manager 使用 `managedAccountEmail` 判断成功操作是否已经导入。
- 同一邮箱重复查询不会创建重复子号。
- 完成操作清理后，删除 Team Manager 子号不会删除 Account Manager 中的受管账号。

## 独立运行边界

- Team Manager 不连接 Account Manager 时，手工录入的 Web Session 仍可完成母号、子号、Team 和 PAT 管理。
- Account Manager 不连接 Team Manager 时，仍可完成账号注册、导入、状态同步和支付操作。
