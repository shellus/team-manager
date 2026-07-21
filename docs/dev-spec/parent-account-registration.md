# 母号自动注册与独立开通动作

## 目标

Team Manager 不直接执行 GPT 账号注册或支付。母号页面通过 GPT Account Manager 创建受管账号；账号与 Web Session 交付完成即结束注册流程。0.52 Codex 空间和双席位 Team 是注册后的两个独立动作，互不作为前置条件。

## 自动注册

1. `POST /api/accounts/registration/start` 创建用途标记为 `team-manager:parent` 的注册操作，并把当前母号分组作为 Account Manager 的调用方关联值持久化。
2. `GET /api/accounts/registration/tasks` 返回注册、人工验证、失败或导入状态。
3. 注册成功后，Team Manager 读取 Account Manager 交付的 Web Session，按规范化邮箱幂等保存 GAM 母号，并写入发起任务时选中的母号分组。
4. 新母号在尚无 Team workspace 时保存个人账号上下文，并立即从注册任务切换为正常母号列表项。
5. 完成导入后清理注册操作；0.52 和双席位按钮在母号详情中独立提供。

Account Manager 已完成注册、Session 校验和账号同步，因此导入成功的个人母号直接保存为 `active`。没有 Workspace 只影响成员、邀请、设置和账单能力，不得把账号标记为“待同步”；后续 0.52、双席位、本地资料和 Workspace 同步入口仍可使用。

注册中出现 Cloudflare 挑战页时，Account Manager 先保持 `running` 并等待中间页自动通过。最后一次 profile 中挑战持续存在时才进入 `waiting_manual`；Team Manager 把该状态视为活跃任务并继续轮询。挑战通过后自动回到 `running`，并从当前邮箱、密码、验证码或资料页继续。输入框因导航或 DOM 替换而消失时，Account Manager 重新识别当前阶段；资料页按姓名字段优先识别，年龄数字框不参与验证码判断。验证码或资料提交后仍停在原 DOM 时停止重复提交，进入活跃监听，DOM 推进后再回到 `running`。最终仍无法识别时保留 profile 并短暂等待后自动复用。Account Manager 重启后也会复用保留的 profile 恢复监听。

母号和子号页面分别保存最后一次选中的分组。进入页面时优先恢复该选择；若该分组已不存在，选中第一个实际分组；只有没有任何实际分组时才回退到“所有”。明确带 `group` 的 URL 仍优先于本地偏好。

## 开通 0.52

`POST /api/accounts/:id/account-manager/open-codex-space` 只使用母号显式保存的 `managedAccountEmail`。请求包含两位国家代码、三位货币代码、正整数 Credits 数量和完整卡片字段；默认表单值为 `IT`、`EUR`、`16`。Team Manager 只负责校验和转发，不保存完整卡号、CVC、CloakBrowser profile 或付款状态。

Account Manager 把国家、货币和 Credits 数量写入任务公开参数，卡片只保留在当前进程私有请求中。扩展使用这些参数构造 usage-based Checkout；付款前校准 Checkout Session 的货币和 Credits 数量，不再依赖固定的 `US`、`USD`、13 Credits 或 52 分金额。

开通成功后，母号列表的 `0.52` 标记从 Account Manager 的可见 usage-based workspace 派生。该结果不替换母号的 `accountId`，也不启用 Team 成员和席位操作。

## 开通双席位

`POST /api/accounts/:id/account-manager/open-team-subscription` 接受可选目标 Workspace ID、优惠码、两位国家代码、三位货币代码、`autoPay` 和可选信用卡。席位数固定为两个。目标为空时创建新 Team；目标存在时只能选择 Account Manager 当前返回的该账号可见 Workspace。

Account Manager 执行以下顺序：

1. 停止目标 CloakBrowser profile。
2. 保留原代理 SID，只把该 SID 的 1024 国家区域临时切换为请求国家。
3. 重新启动 profile，通过目标国家出口创建 Team Hosted Checkout；选择既有空间时携带 `existing_workspace_id`。
4. 取得订单链接后停止 profile，清除国家覆盖并恢复原出口配置。
5. 在原出口重新启动 profile，打开 Stripe Hosted Checkout。
6. 提供卡片时填写卡片；未提供时使用 Stripe 已保存的支付方式。
7. `autoPay=true` 时自动点击 Pay；默认不点击，保留付款页面并进入 `waiting_manual`，监听器继续等待人工付款。
8. 新建 Team 时继续 Workspace onboarding；升级既有空间时按所选 Workspace ID 确认其套餐变为 `team`，不执行命名 onboarding。
9. Team workspace 就绪后，Team Manager 按返回的 Workspace ID 更新同一 GAM 母号记录，并启用 Team 管理能力。

优惠输入兼容 `优惠码|国家|货币`。界面同时保留国家和货币选择器；粘贴三段式文本时自动带入对应选择。

## 列表状态

每个母号列表项展示三个独立标记：

- `GAM`：是否保存 `managedAccountEmail`。
- `0.52`：Account Manager 是否存在可见的 `self_serve_business_usage_based` workspace。
- `双席位`：Account Manager 是否存在可见的 `team` workspace，或当前母号同步到有效的 Team 月付订阅。

`0.52` 继续由 Account Manager 关联状态派生；双席位状态会缓存到母号记录，并兼容 `planType="team"`。当双席位为已开通且 0.52 为未开通时，界面省略“未开 0.52”负面标签。

## 运行中任务控制

母号列表在 0.52 或双席位任务处于 `queued`、`running`、`waiting_manual` 时提供“更换IP”和“终止任务”。控制请求只作用于当前 Account Manager 操作，不创建新的母号开通操作。

- “更换IP”保持 profile 的 Mihomo 本地 SID 不变，只替换对应的上游住宅 SID，并通过 Mihomo 控制端关闭该本地 SID 的现有连接。排队任务在开始前执行；自动阶段轮换后重试当前步骤；人工接管阶段保留当前 profile、VNC 和 Checkout 页面并恢复监听，不停止或重新启动 profile。
- Pay 已触发或 Workspace 正在自动收尾时拒绝更换IP，避免重复扣款或中断已确认的 onboarding。
- “终止任务”把任务置为 `interrupted`，取消尚未开始的调度，停止活跃 profile，并阻止后续异步回调把终止结果覆盖成普通失败或成功。
- `failed` 或 `interrupted` 操作保留错误摘要，并提供纯图标清除入口。清除只删除该终态操作记录，不修改母号、Workspace、账单或 Profile。
- 同一任务同时只执行一个出口轮换指令。指令的排队、执行、成功和失败状态随操作进度返回。

## 安全与幂等

- 手工录入且未关联 Account Manager 的母号不会按邮箱猜测关联。
- 注册、0.52 和双席位操作使用相同母号用途标记，但操作类型彼此独立。
- 完整卡号和 CVC 不写入 Team Manager 运行数据或日志；Account Manager 也只在当前进程内保存待提交卡片。
- 已开通的 0.52 或双席位操作返回幂等成功，不重复生成订单或扣款。
- `waiting_manual` 是活跃状态。服务重启只恢复页面监听，不重新提交付款。
- 任务控制指令属于父操作，不单独竞争账号、profile 或卡片调度锁。
