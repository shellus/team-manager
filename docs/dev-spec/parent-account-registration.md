# 母号自动注册与独立开通动作

## 目标

Team Manager 不直接执行 GPT 账号注册或支付。母号页面通过 GPT Account Manager 创建受管账号；账号与 Web Session 交付完成即结束注册流程。0.52 Codex 空间和双席位 Team 是注册后的两个独立动作，互不作为前置条件。

母号的账号管理页通过 `GET /api/accounts/:id/account-manager/profile`、`POST /api/accounts/:id/account-manager/profile/start` 和 `POST /api/accounts/:id/account-manager/profile/stop` 转发运行 Profile 控制，并通过 `GET/PUT /api/accounts/:id/account-manager/proxy` 管理正式账号的住宅代理配置。Team Manager 只展示运行状态和临时 Profile ID，不生成查看地址，也不连接 CloakBrowser。

## 自动注册

1. `POST /api/accounts/registration/start` 接收两位国家代码和母号分组。Team Manager 先把本次值保存到 `taskFormPreferences.parentRegistration`，再创建用途标记为 `team-manager:parent` 的注册操作；国家在任务入队前写入 GAM 住宅代理配置，分组作为 Account Manager 的调用方关联值持久化。
2. `GET /api/accounts/registration/tasks` 返回注册、人工验证、失败或导入状态。
3. 注册成功后，Team Manager 读取 Account Manager 交付的 Web Session，按规范化邮箱幂等保存 GAM 母号，并写入发起任务时提交的母号分组。
4. 新母号在尚无 Team workspace 时保存个人账号上下文，并立即从注册任务切换为正常母号列表项。
5. 完成导入后清理注册操作；0.52 和双席位按钮在母号详情中独立提供。

注册任务只出现在创建时提交的母号分组中；选择“所有”时聚合展示全部分组的任务。任务卡在成功前始终可选中，并使用 `/parents/registrations/:operationId?tab=account-manager` 持久化当前记录和 Tab。右侧临时详情只提供账号管理 Tab，通过 `GET/PUT /api/accounts/registration/tasks/:operationId/proxy` 编辑必填国家、可空 ASN、可空州/省、可空城市和上游 SID；ASN 有值时清空并禁用州/省与城市。SID 默认回填上次值，并提供随机生成。注册成功并导入本地母号后，页面切换到 `/parents/:id?tab=account-manager`，不创建半成品母号记录。

Account Manager 已完成注册、Session 校验和账号同步，因此导入成功的个人母号直接保存为 `active`。没有 Workspace 只影响成员、邀请、设置和账单能力，不得把账号标记为“待同步”；后续 0.52、双席位、本地资料和 Workspace 同步入口仍可使用。

## 已有母号纳管

手工录入且尚无 `managedAccountEmail` 的母号可调用 `POST /api/accounts/:id/account-manager/manage` 纳入 GAM。Team Manager 优先把已有 `sessionToken`、当前 Workspace Web access token 和账号上下文交给 Account Manager；Account Manager 在自己的隔离 Profile 中写入 Session Cookie、校验 ChatGPT Session、保存浏览器身份归档并同步可见 Workspace。该流程不要求在 Team Manager 再次输入或持久化密码，也不得覆盖母号现有 `remark`、`groupName`、Workspace `accountId`、席位资料或成员邀请缓存。

纳管操作类型为 `import`，以规范化邮箱幂等绑定。页面刷新后从 Account Manager 操作列表恢复进度；成功后只给原母号补写 `managedAccountEmail`，不创建第二条本地母号。同步 Workspace 失败但浏览器身份和 Session 已成功接收时，Account Manager 保留受管账号并记录 `lifecycleStatus=error` 与同步错误，便于后续重新授权；不得把它退回成“未纳管”。同一邮箱重试前清理所有失败、终止和已完成的历史导入操作，运行中的操作不得重复创建。

没有 `sessionToken` 时才回退到 Account Manager 的交互式登录导入。Cloudflare、密码或验证码页面必须停留在该账号自己的 GAM Profile，不得借用默认浏览器或其他账号 Profile。

注册中出现 Cloudflare 挑战页时，Account Manager 先保持 `running` 并等待中间页自动通过。最后一次 profile 中挑战持续存在时才进入 `waiting_manual`；Team Manager 把该状态视为活跃任务并继续轮询。挑战通过后自动回到 `running`，并从当前邮箱、密码、验证码或资料页继续。输入框因导航或 DOM 替换而消失时，Account Manager 重新识别当前阶段；资料页按姓名字段优先识别，年龄数字框不参与验证码判断。验证码或资料提交后仍停在原 DOM 时停止重复提交，进入活跃监听，DOM 推进后再回到 `running`。最终仍无法识别时保留 profile 并短暂等待后自动复用。Account Manager 重启后也会复用保留的 profile 恢复监听。

母号和子号页面分别保存最后一次选中的分组。进入页面时优先恢复该选择；若该分组已不存在，选中第一个实际分组；只有没有任何实际分组时才回退到“所有”。明确带 `group` 的 URL 仍优先于本地偏好。

## 开通 0.52

`POST /api/accounts/:id/account-manager/open-codex-space` 只使用母号显式保存的 `managedAccountEmail`。请求包含两位国家代码、三位货币代码、正整数 Credits 数量和完整卡片字段。前端订单配置初始为空，必须由操作员先选择一种快捷配置才能提交：“美区”为 `US`、`USD`、13 Credits，“欧区”为 `IT`、`EUR`、16 Credits；选择后可以继续调整单个字段。后端拒绝缺省值，不静默补默认配置。Team Manager 只负责校验和转发，不保存完整卡号、CVC、CloakBrowser profile 或付款状态。

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

每个母号列表项按独立维度展示状态：

- 通过批量 Profile 状态接口派生“Profile 已启动”标签。只有 `running` 算作已启动并排在未启动账号之前；`queued`、`stopping` 和 `failed` 不冒充已启动。同一组内继续使用原备注/邮箱自然排序，状态不写入母号数据文件。

- `GAM` / `非 GAM`：是否保存 `managedAccountEmail`。
- `0.52`：只在 Account Manager 存在可见的 `self_serve_business_usage_based` workspace 时展示。
- `双席位`：只在 Account Manager 存在可见的 `team` workspace，或当前母号同步到有效的 Team 月付订阅时展示。
- `周限` / `月限` / `未知`：只在已经开通双席位时展示当前本地限额类型。

`0.52` 继续由 Account Manager 关联状态派生；双席位状态会缓存到母号记录，并兼容 `planType="team"`。未开通的 0.52 或双席位不显示负面标签。

## 代理配置与任务控制

母号列表的注册、0.52 和双席位状态卡不再提供“更换IP”。住宅代理统一放在账号管理 Tab，并且不限制注册、支付或 onboarding 阶段。保存正式账号配置时，GPT Account Manager 持久化国家、ASN、州/省、城市和上游 SID；ASN 与州/省、城市互斥，上游用户名按 `region-<country>-asn-<asn>` 或州/城市结构生成。保存后重载 Mihomo 并断开该账号旧连接；未运行时等价于只修改后续运行配置。注册页面正在运行时还会刷新当前页面。浏览器身份使用的 Mihomo 本地 SID 不变。

- “终止任务”仍只作用于当前 Account Manager 开通操作，把任务置为 `interrupted`，取消尚未开始的调度，停止活跃 profile，并阻止后续异步回调覆盖终止结果。
- `failed` 或 `interrupted` 操作保留错误摘要，并提供纯图标清除入口。清除只删除该终态操作记录，不修改母号、Workspace、账单或 Profile。
- 双席位 Checkout 的临时国家覆盖优先于账号永久代理配置；Hosted Checkout 创建完成或失败后清除覆盖，恢复账号保存的国家、州/省和城市。

## 安全与幂等

- 手工录入且未关联 Account Manager 的母号不会按邮箱猜测关联。
- 已有母号纳管必须由显式操作触发；只有同一邮箱的成功导入操作或 GAM 中已存在的同邮箱账号才能补写引用。
- 注册、0.52 和双席位操作使用相同母号用途标记，但操作类型彼此独立。
- 完整卡号和 CVC 不写入 Team Manager 运行数据或日志；Account Manager 使用账号管理密钥加密保存未完成任务的付款请求，并在任务终态或删除时清除。
- 已开通的 0.52 或双席位操作返回幂等成功，不重复生成订单或扣款。
- `waiting_manual` 是活跃状态。服务热重载后恢复任务、加密付款请求和页面监听，并按当前页面状态继续自动化。
- 账号住宅代理配置由 GPT Account Manager 持久化，Team Manager 只按需读取和提交，不复制到母号数据文件。
