# 母号与 Team 管理

母号是作为 Workspace 业务主体管理的 GPT 账号。母号注册完成时可以尚未拥有 Workspace；0.52 usage-based Workspace 和双席位 Team Workspace 都可以通过母号 session 管理成员、邀请、设置和账单。

## 录入母号

母号页面提供“自动注册”和“录入母号”两个入口。

自动注册只负责创建 GPT 账号：

1. GPT Account Manager 注册新 GPT 账号并交付 Web Session。
2. Team Manager 按邮箱保存 GAM 关联并立即录入母号。
3. 新母号可以尚未拥有 Workspace；0.52 和双席位在母号详情中独立开通。

注册和开通任务都由 Account Manager 持久化，刷新页面不会丢失进度。完整卡号和 CVC 只会转发给 Account Manager 当前进程，不写入 Team Manager 数据或日志。

注册成功并取得 Account Manager 已校验的 Session 后，个人态母号直接显示“正常”。尚未开通任何 Workspace 不等于“待同步”：此时成员、邀请、设置和账单不可用，但 0.52、双席位、本地资料和同步 Workspace 仍可操作。

注册时短暂出现 Cloudflare 中间挑战页，任务保持“注册中”并先等待页面自动通过。挑战持续存在时会显示“等待人工”，母号列表仍持续轮询任务；无论挑战自动通过还是由操作员完成，系统都会按当前 DOM 从邮箱、密码、验证码或资料页自动接管，不需要再点击“继续”。页面跳转导致输入框被替换时也会重新识别阶段；验证码或资料提交后若页面暂未推进，系统停止重复提交并保持活跃监听。最终仍无法识别时保留并自动复用原 profile。服务重启后同样恢复监听。

自动付款不能确认成功或付款页面需要人工检查时，对应的 0.52 或双席位操作进入“等待人工处理”。Account Manager 保留原 Hosted Checkout 页面并继续监听；当前进程仍持有付款资料时，Checkout 页面首次进入或刷新后会自动补填一次，操作员可在提交前修改。操作员在对应 CloakBrowser profile 中完成处理后，无需重新提交 Team Manager 表单。服务重启只恢复页面监听，不恢复付款资料，也不会再次提交付款。

开通任务处于排队、自动执行或等待人工处理时，母号列表提供两个控制按钮：

- “更换IP”：保留当前 profile、Chromium、VNC 和页面，只轮换其上游住宅代理 SID，并断开该 SID 的旧代理连接。Pay 已触发或 Workspace 正在收尾时不可使用。
- “终止任务”：结束当前任务并停止对应 profile。终止后任务不会自动继续，需要重新发起开通操作。

开通失败或任务被终止后，列表保留错误摘要，并在状态右侧显示“×”图标。点击后清除该终态操作记录；母号、Workspace、账单和 Profile 不受影响。

母号录入只支持 chatgpt.com `/api/auth/session` 输出的 session JSON：

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

录入母号时，系统会通过 `accounts/check` 识别当前 session 可管理的 Workspace，不直接信任输入里的 `account.id`。只有当前 session 可访问且角色为 owner/admin 的 Workspace 会被保存为母号 `accountId`。

`sessionToken` 可用于按目标 workspace 换取 Web access token。输入本身已指向目标 Workspace 时可直接录入；输入是个人 session 或其他 workspace session 时，必须提供 `sessionToken`，系统才能切换到目标 Workspace 并保存正确的 access token。录入后先创建本地记录。ChatGPT 远端状态需要在母号详情页点击“同步 Workspace”获取。

母号后续所有 ChatGPT Web backend-api 请求会复用统一认证封装。若远端返回 401 且错误码为 `token_invalidated`，并且本地保存了 `sessionToken`，系统会通过 `/api/auth/session` 换取目标 Workspace 的新 Web access token，回写本地记录并重试一次原请求。

“自动注册”和“录入母号”都使用当前选中的母号分组；当前选中“所有”时归入 `默认分组`。自动注册的目标分组跟随持久化任务，即使页面或服务重启，交付后也不会丢失归属。

母号和子号页面会分别记住上次选中的分组。首次进入或原分组已删除时，默认选中第一个非“所有”的实际分组；仅当没有实际分组时才选中“所有”。用户主动选择“所有”后，下次进入也会恢复该选择。

## 开通 0.52 Codex 空间

母号尚未开通 0.52 时，详情页显示“开通 0.52”操作；未受管账号会显示禁用原因。已经开通后只保留 `0.52` 状态标签，不再显示“已开通 0.52”禁用按钮。

开通表单的订单国家、账单货币和积分数量初始为空，必须先选择一种快捷配置才能提交：“美区”填写美国、美元和 13 Credits，“欧区”填写意大利、欧元和 16 Credits；快捷填写后仍可调整单个字段。信用卡既可分别填写卡号、有效期和 CVC，也可粘贴 `卡号----有效期----CVC` 一次填充；有效期支持 `MM/YY` 和 `MM/YYYY`。

开通操作是持久化后台任务。页面会展示运行状态；成功后母号列表显示 `0.52` 标记。0.52 Workspace 不会被误标为双席位 Team，但它与 Team Workspace 一样属于可管理 Workspace，可执行成员、邀请、设置和账单操作。已开通账号不再显示开通按钮，也不会重复发起付款。

母号详情页的账号信息和 `GAM`、`0.52`、`双席位` 状态集中在标题信息区；邀请、开通、本地资料和同步操作位于下一行。同步时间只在母号列表展示。删除母号只保留列表“更多操作”菜单入口，该入口打开与原详情按钮相同的确认流程。

## 开通双席位 Team

有 GPT Account Manager 关联的母号可以执行“开通双席位”。该动作创建两个固定席位的 Team 月付订单，与 0.52 是否已开通无关。

表单支持：

- 可选目标 Workspace。留空时新建 Team；选择后把该 GAM 账号下的指定空间升级为 Team。
- 优惠码，可直接粘贴 `优惠码|国家|货币`。
- 订单国家和账单货币。
- 可选信用卡。留空时尝试复用 Stripe 已保存的支付方式。
- “自动支付”开关，默认关闭。关闭时只准备 Stripe 页面，由操作员核对并点击 Pay；后台继续监听支付和 Workspace 状态。

创建订单时，Account Manager 会把该账号的 1024 代理临时切到所选国家。订单链接生成后立即恢复原出口，再继续 Stripe 支付；因此所选国家只作用于创建订单阶段。选择既有 Workspace 时，订单携带该空间 ID，付款后按原 ID 确认升级结果，不进入新空间命名流程。付款等待人工点击或无法自动确认时，页面保留并进入人工接管。既有 usage-based Workspace 在升级前后都保留管理能力；开通成功只改变双席位套餐状态。

母号列表显示 `GAM` / `非 GAM` 和已经开通的能力状态。0.52 与双席位仍是独立能力；未开通的能力不显示负面标签，但仍保留各自的开通操作入口。周限、月限和未知限额只在已经开通双席位时显示。

`双席位` 状态以当前有效 Team 月付订阅为准，并兼容 `planType="team"`。既有 usage-based Workspace 升级 Team 后，`accounts/check` 可能仍保留 usage-based `planType`；系统会通过 recurring upcoming invoice 识别实际订阅。历史母号不需要补建 GAM profile。

首页“空位”只统计双席位 Team 的两个固定 ChatGPT 位置。仅有 0.52 usage-based Workspace 的母号不会产生空位；开启“显示 Codex 席位”后仍可查看其实际 Codex 成员或邀请。

## 同步 Workspace 状态

“同步 Workspace”对所有母号开放，不以当前双席位或本地 `planType` 为前提。它会读取已保存 Session 当前可见的 owner/admin Workspace：个人态母号如果在其他地方开通了 0.52 或 Team，会自动切换本地 `accountId` 和 Web access token；已有 Workspace 会并行刷新成员、邀请和当前 Team 月付订阅状态。关联 GAM 的母号还会在同一次操作中请求 GPT Account Manager 同步账号 Workspace。只要本地识别到 `self_serve_business_usage_based` Workspace，就会标记为已开 0.52，不依赖付款任务必须以成功状态结束；这样人工终止了异常跳转后的任务，也不会丢失已经成功创建的空间状态。即使 `accounts/check` 仍返回 usage-based `planType`，系统也能另外识别已升级的双席位 Workspace。

如果当前 Session 没有任何可管理 Workspace，同步仍视为成功。页面不显示 0.52 或双席位能力标签，继续保留开通入口，也不会额外显示错误。

个人 Session 切换到目标 Workspace 时需要已保存的 `sessionToken`。如果当前 Session 同时可管理多个 Workspace 且现有记录不能确定目标，系统不会猜测，操作员需要在“本地资料”中录入目标 Workspace 的 session 后再次同步。

成员列表、待处理邀请和默认席位各有独立刷新入口，页面会先显示已有缓存，再由操作员手动刷新。

刷新后的缓存用于派生以下展示：

- 成员数。
- ChatGPT 固定席位已用数量。
- 待处理邀请数。
- 默认席位。

这些值不是独立持久化字段。写操作成功后，系统会刷新或更新对应缓存并返回最新 view。

## 设置新成员默认席位

母号详情页右上角菜单进入“修改默认席位”。默认席位建议设为 Codex 席位。

默认席位只影响未显式指定席位的邀请。显式邀请 ChatGPT 席位仍可能占用固定席位，系统不做额外风险确认。

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

## 设置 Automatic reload

母号详情页“设置”中的 Credits 区域可切换 Automatic reload。关闭操作立即生效；开启前会提示该动作可能使用默认支付方式立即补款。

该开关只控制 Credits 自动补款，不表示 Team 套餐自动续费，也不影响 0.52 或双席位的开通状态。刷新设置时会读取远端当前值并更新本地缓存。

## 邀请成员

母号详情页右上角菜单进入“邀请新成员”。邀请时需要填写邮箱并选择席位类型：

- Codex 席位：适合作为默认安全选择，不占用固定 ChatGPT 席位。
- ChatGPT 席位：会占用固定席位，可能产生额外账单。

邀请 ChatGPT 席位或切换成员到 ChatGPT 席位时，系统直接执行请求，不增加二次确认。操作员需要自行确认 Billing；当前成员数量不能反映移除后仍在临时计费的标准席位。

发送邀请时，前台只等待一次远端邀请提交。提交成功后，Team Manager 根据本次请求立即更新本地待处理邀请列表和客户席位资料，不再等待远端邀请列表刷新。

邀请任一席位类型时都可填写客户席位资料：

- 席位备注。
- 席位到期日期，默认当前日期加 30 天。
- 到期提醒，默认开启。
- 到期移除标记，默认关闭。

这些资料保存到母号的客户席位位置，与 ChatGPT/Codex 远端席位类型相互独立。邮箱只是席位当前占用者；邀请被接受、修改席位类型或客户换号后，备注、到期日期、价格和席位管理地址继续属于原席位位置。

## 待处理邀请

母号详情页右上角菜单进入“查看待处理邀请”。待处理邀请列表支持刷新和撤销。

pending invite 与正式 member 需要区分。子号处于 pending invite 时，仍可能为目标 Team 创建 PAT；但本地 Team 关联状态应保持为 `invited`，直到同步到成员列表后才变为 `member`。

所有待处理邀请都支持编辑客户席位资料。编辑只更新 team-manager 本地数据，不调用 ChatGPT 远端接口。邀请列表与成员列表分别刷新；邀请被接受后，即使先刷新邀请列表暂时找不到该邮箱，也只会把关系标成“待确认”，不会删除客户资料。随后刷新成员列表时，同一席位会原地迁移为正式成员关系。

## 成员席位和移出成员

成员列表支持修改单个成员席位。系统不检查切换后的固定席位数量，由操作员自行判断。

移出成员不是常规腾 ChatGPT 席位手段。为避免破坏该账号在目标 Team 下已有凭证，以及标准席位移除后继续临时计费，腾位应优先把成员从 ChatGPT 席位切到 Codex 席位。

移出成员成功后，页面显示上游返回的最近一次 `billing_notice` 和 `policy_notice` 摘要及原始 JSON。操作员还必须检查 Workspace Billing；上游内部策略字段不构成“可以继续免费邀请”的保证。公开席位页禁止自动移除已接受的标准 ChatGPT 成员，Codex 成员、空位和待处理邀请仍可按现有流程换号。

ChatGPT 和 Codex 席位成员都支持编辑客户席位资料。`到期移除` 只是运营标记，不会自动执行远端移出；移出成员仍需显式操作。修改远端席位类型只更新同一客户席位的 `seat` 和关系状态，不清空资料。

## 全局通知设置

页面顶栏的“通知设置”用于配置到期提醒：

- 提前提醒天数，默认 `3` 天。
- 每日触发时间，默认 `08:00`。
- 通用 Webhook、飞书、Telegram、企业微信等通知渠道。

通知任务每天按本地时间最多运行一次，同时计算“Team 续费”和“客户席位到期”两类数量。任一分类数量大于 `0` 时发送通知；两类都为 `0` 时不发送。已发送的消息始终展示两个分类及各自数量，数量为 `0` 的分类显示“无”。

两类明细行统一显示“备注、邮箱、到期时间（剩余天数）”。Team 续费使用母号备注和母号邮箱，客户席位到期使用席位备注和当前绑定邮箱。

客户席位到期只扫描 `seatSlots` 中 `expireReminder=true` 且到期日在提醒窗口内的席位，不扫描所有远端成员。

## Team 改名、本地备注与分组

Team 改名修改远端 workspace 名称。GPT 账号显示名统一来自 `email`，备注使用 `remark`，两者都不修改 ChatGPT 远端 Team 名称。

编辑母号本地资料可修改备注 `remark`、母号分组 `groupName`、限额类型 `limitType`、下次续费时间 `nextRenewalOn` 和独立代理地址 `proxy`，也可同时替换 session。替换 session 只支持 chatgpt.com session JSON；session JSON 中的 `sessionToken` 会被保存，用于后续换取 workspace Web access token。系统会优先保留当前母号绑定的 Workspace：新 session 仍可访问该空间时，只更新该空间的 Web access token；否则按可管理 Workspace 规则重新识别目标。系统会用新 session 的 `user.email` 更新 `email`。本地资料弹窗会回填已保存的 session JSON 和代理地址。

分组用于区分自用、已出租车位等运营集合。分组只是本地展示和筛选字段，不影响远端 Team workspace。

母号代理只影响该母号发起的 ChatGPT Web backend-api 请求，以及使用该母号 `sessionToken` 换取 workspace Web access token 的请求。账号未配置代理时，curl_cffi worker 才回退到运行环境全局代理。
