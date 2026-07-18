# 子号注册服务对接 SOP

## 目标

Team Manager 不执行 GPT 注册，只向 GPT Account Registrar 发起注册任务，并在任务成功后录入账号交付。

账号交付必须包含：

- 邮箱与注册密码
- chatgpt.com `/api/auth/session` 结构
- 注册时间与注册方式
- Cloak profile 标识
- 完整注册事件
- GongXi-Mail 分组结果或分组失败信息

## 流程

1. 页面调用 `POST /api/subaccounts/registration/start`。
2. Team Manager 调用注册服务 `POST /v1/registrations`，立即返回持久化任务。
3. 页面在子号列表展示独立任务项，按钮 loading 随请求返回后释放。
4. 页面轮询 Team Manager 注册任务列表。
5. 注册服务负责邮箱、浏览器 profile、代理、注册、资料填写、Session 获取和邮箱分组。
6. 成功任务被 Team Manager 幂等录入为子号，并清理注册服务中的完成任务。
7. 失败、中断或等待人工处理的任务可通过原任务 ID 重试，注册服务复用已保存的邮箱和密码。

## 状态

| 状态 | 含义 |
|---|---|
| `queued` | 已进入注册服务队列 |
| `running` | 浏览器流程正在执行 |
| `waiting_manual` | 连续三次 Cloudflare/CAPTCHA 后等待人工处理 |
| `succeeded` | Web Session 已交付 |
| `failed` | 流程失败，可按原邮箱重试 |
| `interrupted` | 注册服务重启导致任务中断 |

## 原子性与幂等

- 注册任务由注册服务持久化，页面刷新不会丢失。
- Team Manager 在子号记录保存 `registrationJobId`。
- 同一成功任务重复查询不会创建重复子号。
- 完成任务录入后从注册服务删除，避免用户删除子号后被旧任务重新录入。

## 人工处理

Cloudflare/CAPTCHA 前两次由注册服务删除 profile、切换 SID 并重新开始。第三次仍失败时保留当前 profile，任务进入 `waiting_manual`。人工处理完成后，Team Manager 的“人工验证后继续”仍调用同一任务重试接口。

## 日志

注册服务保存截图、HTML、Playwright trace、请求与响应、Cookie、邮箱、密码、验证码、Session 和错误堆栈。Team Manager 录入成功交付时也保存完整交付对象。两边日志均属于私有运行数据。
