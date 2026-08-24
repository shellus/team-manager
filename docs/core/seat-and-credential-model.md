# 账号、Workspace、席位与凭证模型

本文件是 Team Manager 的领域红线。涉及账号、Workspace、成员、邀请、席位、凭证、额度和账单时，以本文为准。

> 待认领席位、自助认领和显式授权换号是已接受但尚未实施的目标模型，实施状态以 [`固定 GPT 席位自助管理计划`](../plans/fixed-gpt-seat-self-service-management.md) 为准。当前运行实例在该计划完成前仍按既有数据库和服务行为运行。

## 账号与 Workspace

`Account` 是唯一受管 ChatGPT 登录身份，以规范化邮箱唯一。账号不是某种角色：它可以没有 Workspace、管理多个 Workspace，也可以在其他 Workspace 中只是普通成员。

`AccountGroup` 是结构化运营分组。账号恰好属于一个分组；分组有稳定 ID，可重命名。账号分组与凭证号池分组完全独立。

`Workspace` 是独立 Team/Business 空间，以远端 Workspace account ID 唯一。它不永久属于某个账号。账号与 Workspace 的关系由 `WorkspaceMembership` 表达：

- 活动 owner/admin 关系产生“拥有可管理空间”能力；
- member/analytics_viewer 是普通成员能力；
- 邀请是 `WorkspaceInvitation`，不伪装成空成员；
- 一个账号可以在不同 Workspace 中有不同角色和席位。

所有 Workspace 写操作显式选择当前有活动 owner/admin Membership 的执行账号。

## 个人空间与套餐

每个账号有且只有一个 `PersonalSpace`，承载个人套餐、支付摘要、账单、额度和个人设置。个人空间不是 Workspace。

个人套餐规范代码为：

| 名称 | 内部代码 | Checkout plan name |
|---|---|---|
| Go | `go` | `chatgptgoplan` |
| Plus | `plus` | `chatgptplusplan` |
| Pro 5x | `pro_5x` | `chatgptprolite` |
| Pro 20x | `pro_20x` | `chatgptpro` |

首次开通使用 `start_new` 并由 GAM 执行浏览器 Checkout。`Plus → Pro 5x` 与 `Plus → Pro 20x` 已验证为 Team Manager 可直连的订阅更新：先读取 `/backend-api/subscriptions/update/preview`，管理员确认后调用 `/backend-api/subscriptions/update`，再回读当前套餐。其他付费套餐转换仍必须拒绝，不能用 plan name 猜测。Business 操作分为创建新 Workspace 和升级当前账号可管理的既有 Workspace。

当前个人套餐以 `accounts/check` 中对应 `structure=personal` 的账号条目为准。`subscriptions` 返回的记录只提供续费、有效期和欠费等订阅生命周期事实；套餐取消并到期后该接口仍可能保留历史 `plan_type`，不得据此覆盖 `accounts/check` 已明确返回的 Free 或其他当前套餐。只有 `accounts/check` 未提供个人套餐时，才允许回退到订阅记录。

完整卡号和 CVC 只在当前 Team Manager 请求内交给无原文追踪的 Stripe HTTP Transport；数据库、普通日志、HTTP trace 和自动化操作都不得保存完整卡片。系统只保存品牌、尾号、有效期、默认标记和安全活动摘要。绑定、设置默认和移除支付方式必须显式指定个人空间或 Workspace 作为订阅目标，不能从执行账号或当前页面状态隐式推断。

个人空间和 Workspace 都可以绑定、设置默认和移除支付方式，并取消自动续费。绑定支付方式由 Team Manager 使用目标 Session、账号稳定代理和 HTTP Transport 创建并确认 Stripe SetupIntent；设置默认和移除卡片直接请求 ChatGPT 支付接口。所有支付方式写请求都在同步响应前复读最新列表，不创建自动化操作或浏览器 Profile；绑定遇到 3DS、Radar 或其他交互要求时明确失败，不静默回退浏览器。取消续费由 Team Manager 使用目标访问上下文直接请求 ChatGPT，并实时复读 `will_renew=false`。取消续费不退款，当前权益保留到计费周期结束。

## 账号运营主套餐

账号运营主套餐是列表使用的单一运营称呼，不是 `Account`、`PersonalSpace`、`Workspace` 或 `WorkspaceMembership` 上的新事实字段。它由普通 PostgreSQL View `account_operational_summaries` 查询时投影，不缓存或双写回账号表。

投影只使用各关系的最新有效事实，按以下优先级返回第一个命中值：

1. 个人空间当前付费套餐：Go、Plus、Pro 5x、Pro 20x；
2. 账号以 owner 身份管理的活动固定席位 Business Workspace；
3. 账号以 owner 身份管理的活动 0.52 Workspace；
4. 账号存在活动 Workspace Membership，且所有活动关系都不是 owner：Team 子号；
5. Free。

证据不足时返回 `unknown`，不得把未知伪装成 Free。Workspace Invitation、已移除关系和非活动 Workspace 不参与投影。admin 在授权和“拥有可管理空间”能力中仍属于管理员，但在主套餐称呼中不是 owner，因此满足其他条件时归为 Team 子号；账号同时存在 owner 和非 owner 活动关系时，不归为 Team 子号。

“固定席位 Business”和“0.52”只描述活动 owner Workspace 的运营套餐信号；完整 Workspace 套餐、角色、容量和来源仍由各自事实对象表达。固定席位容量不进入套餐代码，不按 2 席位、4 席位拆成不同套餐。账号列表只展示并筛选主套餐，不额外展开其来源或命中原因，详情页继续展示个人空间和 Workspace 的完整事实。

当主套餐为“固定席位 Business”时，列表附带显示该主套餐 Workspace 的固定席位占用与权益容量。存在多个固定席位 owner Workspace 时，选择规则与主套餐生命周期一致：优先最早的未来续费，其次最近的历史续费，最后以 Workspace ID 稳定排序。占用数只统计该 Workspace 中活动 `default` Membership 与待接受的 `default` Invitation；不跨 Workspace 汇总，也不写回账号字段。权益容量未知时显示未知，不默认写成 2。

## Session 与访问上下文

账号完整 Web Session 只由 Team Manager 持久化并在应用层加密。保存新 Session 时原子替换并删除旧 Session，GAM 不保留副本；注册成功时 GAM 只做一次性交付，Team Manager 保存后确认清除。账号登录状态只由 Refresh Token / Session Token 的真实可用性决定；Access Token 是可重新换取的短期访问凭证，其无效或过期不得改变账号登录状态。Access Token 按以下上下文隔离：

- `Account × PersonalSpace`；
- `Account × Workspace`。

同一账号在多个 Workspace 的 Token 不能互相覆盖。Workspace API 必须使用目标 Workspace 上下文，不能把个人 Token 或其他 Workspace Token 当成通用 Token。

Access Token 请求返回 401 时，存在可用 Session Token 的流程应先换取目标上下文的新 Access Token 并重试。只有长期会话凭据也无法换取新 Token 时，才能判定账号登录无效；不得根据 Access Token 的 `exp`、上下文状态或单次 401 直接推断账号掉登录。

## 席位与账单

远端席位类型只有：

| 原始值 | 含义 |
|---|---|
| `default` | 固定 ChatGPT 席位，可能产生固定/按比例席位费用 |
| `usage_based` | Codex/usage-based 席位，不占固定 ChatGPT 位置 |

席位类型是可缺失的上游事实，不设本地默认值。创建邀请时未显式选择席位，发往上游的请求必须省略席位字段，由上游决定；成员、邀请、Workspace 设置或客户资料的上游响应未返回席位类型时，本地保持未知，界面不显示 ChatGPT 或 Codex 类型。只有明确收到或由管理员明确提交 `default`、`usage_based` 时才记录对应类型。

`SeatSlot` 是 Workspace 下已运营、已售出或已明确预留给客户的本地资源。它可以处于待认领状态，此时没有当前邮箱但已经具有稳定公开 `seatKey`；首次认领、后续换号、邀请转成员或席位类型变化不改变客户备注、价格、到期日、公开 `seatKey` 和历史。普通管理员移除成员、撤销邀请、释放席位或删除失效关系时，本地客户资料和公开 `seatKey` 一并删除；公开认领和公开换号是保留同一 `SeatSlot` 的专用身份转换。

`expireRemove=false` 表示到期后只停用本地客户资料。`expireRemove=true` 表示必须尝试移除对应远端成员或邀请：首次失败后分别等待 1 分钟和 5 分钟，最多尝试 3 次；最终失败时停止自动重试，保留原关系和客户资料，记录显式失败状态并通过 `seat_expiration` 通知策略告警。普通到期扫描不得重新启动已经最终失败的移除；管理员修改到期日或到期处理策略后才清除该失败终态。

Workspace 固定席位空位始终由容量与远端关系实时派生，不能批量物化成无主 `SeatSlot`。管理员只能从已知固定 ChatGPT 空位中显式创建待认领席位；待认领席位减少本地可分配固定席位余量，但在创建上游邀请前不计入 `fixedSeatOccupied`。容量未知或没有可分配余量时不得创建待认领席位。Codex/`usage_based` 不使用待认领席位或固定席位空位模型。

公开 URL 是待认领席位的能力凭据，其存在即允许首次认领，不另设首次认领开关。首次认领提交首个邮箱并创建 `default` 固定 ChatGPT 邀请；成功后立即开始换号冷却期。未绑定邮箱时不能导出数据。

后续公开换号默认关闭，只有管理员为对应 `SeatSlot` 显式允许后才能执行。换号冷却默认 7 天，按最近一次成功的公开认领或公开换号完成时间计算；失败、相同邮箱幂等请求和管理员操作不重置冷却。已到期、已停用、缺少可管理账号或已有活动自助操作的席位拒绝认领、换号和导出。

当前成员数不等于计费席位数。管理员显式允许后续换号时，公开流程可以自动移除已接受的 `default` 固定 ChatGPT 成员并邀请新邮箱；开启配置和公开页面必须提示旧成员立即失去访问、凭证可能失效、旧席位可能继续临时计费以及新成员可能产生新增费用。每次操作必须保存完整步骤、失败状态、上游 `billing_notice`、`policy_notice` 和活动审计，最终费用仍以 Workspace Billing 与账单为准。

“允许导出数据”默认关闭。具体导出目标、管理员上游接口、返回形式和频率限制在接口样本提供后补充；公开页面只能调用 Team Manager 的受控后端，不得接触管理员接口凭证。待认领席位没有当前邮箱和可导出目标，即使配置允许也必须显示为不可导出。

固定席位 Business 同时存在四个不能互相替代的数字：

| 领域字段 | 含义 | 事实来源 | 缺失规则 |
|---|---|---|---|
| `fixedSeatCapacity` | 当前固定 ChatGPT 席位权益容量 | 最新 Workspace 订阅的 `seats_entitled` | 保持未知，不回退到 2、占用数或账单数 |
| `fixedSeatOccupied` | 当前固定席位关系占用 | 活动 `default` Membership + 待接受 `default` Invitation | 无匹配关系时为 0 |
| `subscriptionSeatsInUse` | 订阅接口报告的使用数 | 最新 Workspace 订阅的 `seats_in_use` | 保持未知，只用于核对 |
| `billedSeatQuantity` | 当前账期或下期账单的计费数量 | 对应 Business 周期性发票行的 `quantity` | 保持未知，并保留账单周期语义 |

只有 `fixedSeatCapacity` 可以用于补出固定席位空位和判断关系占用是否超出权益容量。待认领席位数量只从固定席位空位中扣出本地可分配固定席位余量，不得写入或覆盖 `fixedSeatOccupied`。`subscriptionSeatsInUse`、`billedSeatQuantity` 与 `fixedSeatOccupied` 不一致时应并列展示或产生风险提示，不得通过覆盖其中任一事实消除差异。

席位概览只处理固定 ChatGPT 席位 Workspace，使用远端活动 `default` Membership 与待接受的 `default` Invitation 表达固定席位占用，并以已知 `fixedSeatCapacity` 补出空位。容量未知时仍展示已知占用，但不虚构空位。空位只是查询投影；只有管理员显式预留时才转换为具有稳定 `seatKey` 的待认领 `SeatSlot`。`SeatSlot` 为待认领席位或匹配邮箱附加联系方式、价格、备注、到期日和公开自助管理能力；没有 `SeatSlot` 的固定席位成员仍必须出现。Codex/`business_usage_based` Workspace、`usage_based` 关系及其客户资料不进入席位概览。

## 凭证与额度

`WorkspaceCredential` 绑定 `Account × Workspace`。OAuth/PAT 凭证不能通过改 JSON 字段、请求头或文件名跨 Workspace 使用。一个账号加入多个 Workspace 时，应为每个目标 Workspace 分别创建凭证。

凭证是否可用取决于该账号在对应 Workspace 的关系与席位；额度也按 Workspace 独立计算。切换同一 Workspace 的席位类型可以保留凭证记录，跨 Workspace 搬迁必须重新授权或创建 PAT。

凭证 JSON 正文保存在权限受控的不可变文件中，PostgreSQL 只保存账号、Workspace、类型、状态、`storageKey`、SHA-256、大小和额度快照。

## 数据存储边界

PostgreSQL 保存结构化业务事实。以下正文只存文件：

- 完整 HTTP trace；
- rrweb 压缩录制；
- OAuth/PAT JSON 凭证。

数据库只保存相对路径索引和哈希，不能保存绝对路径或把正文塞进 `jsonb`/`bytea`。旧业务 JSON/JSONL 不在运行时读取。

## 操作约束

- 业务变更走 UI、API 或 service/repository，禁止直接编辑运行数据。
- 账号、Workspace、Membership、Invitation、SeatSlot 和 Credential 是不同对象，不能用字符串或缓存互相代替。
- 未录入的远端成员允许 `account_id = null`，不得创建虚构账号满足外键。
- 账号能力从关系派生，不写 `isParent`、`isOwnerAccount` 等类型字段。
