# Team Manager Domain

本上下文统一 team-manager 中 Team workspace、远端关系、客户席位和到期提醒的业务术语。

## Language

**母号**:
作为 Workspace 业务主体管理的 GPT 账号。母号可以尚未拥有可管理 Workspace；0.52 Codex 空间、双席位 Team 套餐和个人账号 Pro 5x 都是该账号上的独立开通结果。
_Avoid_: Team workspace、Team 成员、客户席位

**可管理 Workspace**:
母号当前指向且可执行成员、邀请、设置和账单操作的 GPT workspace。0.52 usage-based Workspace 与双席位 Team Workspace 都属于可管理 Workspace；个人 `free` 账号不属于。
_Avoid_: 双席位 Team、Team 套餐状态

**同步 Workspace**:
母号主动重新确认当前可管理 Workspace 的校准动作。个人态母号可用它发现外部开通的 0.52 或 Team Workspace；未发现 Workspace 表示尚未开通空间，是正常空状态。
_Avoid_: 同步双席位、开通 Team、同步套餐

**固定 ChatGPT 席位容量**:
双席位 Team 套餐提供的两个 ChatGPT 固定位置，可由成员、邀请或空位占用。0.52 usage-based Workspace 没有固定 ChatGPT 席位容量，因此不产生空位。
_Avoid_: Workspace 成员数、Codex 席位、可管理 Workspace

**受管账号引用**:
可选的规范化邮箱，表示当前母号或子号在 GPT Account Manager 中存在对应受管账号。引用不改变 Team Manager 对 Web Session 和 Team 业务关系的独立所有权。
_Avoid_: CloakBrowser Profile ID、Account Manager 数据库 UUID、注册任务 ID

**封号标记**:
由用户人工维护、独立于远端 `status` 和 Web Session 可用性的账号运营标记。封号母号的空位不进入概览统计；封号子号不能再被邀请加入 Team；同步、编辑、退出 Team、订单维护等其他操作不受限制。
_Avoid_: 自动封号检测、账号状态、停用账号、删除账号

**Profile 控制**:
Team Manager 使用受管账号引用请求 GPT Account Manager 启动或关闭该账号的运行 Profile。Team Manager 不拥有 Profile、浏览器身份或租约，也不负责打开浏览器或提供 VNC。
母号和子号列表可从 Account Manager 批量状态派生“Profile 已启动”标签并将 `running` 记录置顶；该状态不写入本地账号数据。
_Avoid_: Profile 管理、打开浏览器、浏览器会话、直接调用 CloakBrowser

**账号住宅代理配置**:
Team Manager 在母号或子号的账号管理页编辑 GPT Account Manager 持有的住宅代理定位条件和上游 SID。定位条件包含必填国家，以及互斥的 ASN 模式或州/省与城市模式；注册操作尚未交付正式账号时，任务列表项仍代表同一待交付账号配置。
_Avoid_: 本地资料中的 ChatGPT 请求代理、Profile 控制、开通任务状态按钮、临时 Checkout 国家

**0.52 开通**:
母号通过 GPT Account Manager 创建 13 Credits usage-based workspace 的独立支付动作。它不是母号注册完成或双席位开通的前置条件。
_Avoid_: 母号注册第二阶段、Team 套餐

**双席位开通**:
母号购买两个固定席位的 Team 月付套餐，并新建 Team workspace 或升级指定既有 Workspace 的独立支付动作。
_Avoid_: 0.52 开通、增加两个成员

**Pro 5x 开通**:
带有受管账号引用的母号或子号，通过 GPT Account Manager 为个人 Account 创建 Prolite 5x custom Checkout 的独立支付动作。它只使用 ChatGPT 站内 Checkout，固定采用运行环境配置的新加坡 ASN 和账单地址，不创建或升级 Workspace。母号和子号任务使用各自的请求标签隔离，但支付与状态判定规则相同。
_Avoid_: 双席位 Team、等待优惠弹窗、站外 Stripe Checkout、永久修改账号代理

**Pro 5x 状态**:
受管 GPT 个人 Account 当前是否已经返回 `pro` 或 `prolite` 套餐。该能力可由母号或子号详情派生展示，独立于 0.52 Workspace、双席位订阅和子号 Team 关联。
_Avoid_: Team 套餐、Workspace 类型、付款任务状态

**Pro 5x 补充卡片**:
旧任务缺少加密付款资料时，通过母号或子号详情的快捷输入把 PAN/CVC 重新交给原任务。正常未完成任务的付款资料由 GPT Account Manager 加密持久化，服务热重载后自动恢复；Team Manager 不保存完整卡片。
_Avoid_: 新建 Pro 5x 任务、从 last4 还原卡片、人工提交开关

**双席位订阅状态**:
Workspace 当前是否存在有效的 Team 月付订阅。该状态独立于 Workspace 种类和当前成员数量，以当前有效的月付关系为准。
_Avoid_: Workspace 类型、两个默认席位成员、0.52 状态

**双席位开通目标**:
一次双席位开通作用的 GPT workspace。未选择目标表示创建新 Team workspace；选择目标表示升级该 GAM 母号下的指定既有空间。
_Avoid_: 母号记录、任意 Team workspace

**Team 升级订单**:
以母号当前 Codex Workspace ID 为目标生成的普通两席位 Team Checkout。它只升级指定既有 Workspace，不创建新 Workspace；订单支付后是否生效由后续 Workspace 同步确认。
_Avoid_: 新建 Team Workspace、普通验码任务、付款状态

**订单维护池**:
需要周期性维护 Team 升级订单的母号集合。加入维护池会创建独立维护记录，不修改母号自身状态；母号列表中的“订单维护中”是由有效维护记录派生的展示标签。
_Avoid_: 母号状态、Team 订阅状态、自动支付队列

**订单维护配置**:
生成 Team 升级订单使用的优惠码、国家和货币。系统先读取全局配置，再逐字段应用母号非空覆盖，并把最终配置快照保存到当次订单记录。
_Avoid_: 母号独立必填配置、运行环境配置

**有效升级订单**:
TeamCode 已成功返回支付 URL，且 Stripe `expires_at` 尚未到达的 Team 升级订单。“有效”只描述支付链接仍在有效期内，不表示已付款或订阅已开通。
_Avoid_: 已支付订单、有效 Team 订阅

**自动支付**:
双席位开通在 Stripe 页面准备完成后是否自动点击 Pay 的显式选项。默认关闭；关闭时进入人工处理并继续监听付款结果。
_Avoid_: 自动填卡、自动创建订单

**Automatic reload**:
Workspace 的 Credits 余额低于远端阈值时，自动使用默认支付方式补充 Credits 的开关。它不表示 Team 套餐续费，也不等同于开通流程的自动支付。
_Avoid_: Team 自动续费、自动支付

**Team 续费**:
Team workspace 套餐在 `nextRenewalOn` 对应日期发生的续费事件。
_Avoid_: 母号到期、成员到期

**客户席位**:
母号下已运营或售出的本地席位位置，由 `seatSlots` 表示，可关联 ChatGPT 固定席位或 Codex/usage-based 席位。邮箱只是当前位置的占用者，远端邀请转成员、修改席位类型或换号都不会改变席位本身，也不得清空备注、到期时间、价格和历史。
_Avoid_: 成员资料、邮箱资料、member profile

**远端席位关系**:
客户席位当前邮箱在 Workspace 中的邀请或成员关系。邀请被接受后，同一邮箱从 `invited` 迁移为 `member`；成员和邀请列表是可分别刷新的远端快照，不是客户席位资料的事实源。单个快照暂时找不到邮箱时只把关系标记为 `unknown`，不得删除客户席位。
_Avoid_: 客户席位、客户资料所有权

**临时计费席位**:
标准 ChatGPT 成员被移除后，上游在部分情况下继续计费的席位。它不再对应可访问 Workspace 的成员，也不能从当前成员数或客户席位数推导；最终状态必须以 Billing 和账单为准。
_Avoid_: 当前成员、空位、已释放席位

**成员移除策略结果**:
成员移除成功响应中的 `billing_notice` 和 `policy_notice`。Team Manager 保留完整原始 JSON，并抽取已知字段用于风险展示；字段语义和阈值不是稳定公开契约，不能作为自动邀请的安全许可。
_Avoid_: Billing 事实、免费替换保证、固定七天规则

**公开换号**:
客户使用 `seatKey` 把客户席位的当前邮箱换成新邮箱的自助流程。它可以处理空位、待处理邀请和 Codex 席位关系；不得自动移除已接受的标准 ChatGPT 成员，因为移除与重新邀请之间没有可靠的免费计费前置判断。
_Avoid_: 管理员移除成员、标准席位自动轮转

**踢拉**:
通过反复移除成员再邀请新成员来轮转标准 ChatGPT 席位的运营俗称。该动作会破坏 membership，并可能产生临时计费席位、额外分摊费用或 Workspace 停用风险；代码、接口和正式文档使用“移除后重新邀请”描述具体动作，不把“踢拉”建模为正常能力。
_Avoid_: 席位类型切换、普通换号、安全腾位

**成员**:
已经加入 Team workspace 的远端账号关系。成员本身没有 team-manager 本地到期日期。
_Avoid_: 客户席位

**待处理邀请**:
已经发出但尚未转为正式成员的远端邀请关系。面向用户的状态文案使用“邀请待接受”。
_Avoid_: 待邀请

**客户席位到期**:
客户席位的 `expiresOn` 进入提醒窗口。只有开启 `expireReminder` 的客户席位参与提醒。
_Avoid_: 成员到期、邮箱到期

**到期提醒**:
同时包含 Team 续费和客户席位到期的统一通知。任一分类非零时发送，消息始终展示两个分类及各自数量。
_Avoid_: Team 成员到期提醒
