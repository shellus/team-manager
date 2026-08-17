# 账号、Workspace、席位与凭证模型

本文件是 Team Manager 的领域红线。涉及账号、Workspace、成员、邀请、席位、凭证、额度和账单时，以本文为准。

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

首次开通使用 `start_new`。现有付费套餐间切换只有在 GAM/上游请求矩阵验证后才开放；未验证组合必须拒绝，不能用 plan name 猜测。Business 操作分为创建新 Workspace 和升级当前账号可管理的既有 Workspace。

当前个人套餐以 `accounts/check` 中对应 `structure=personal` 的账号条目为准。`subscriptions` 返回的记录只提供续费、有效期和欠费等订阅生命周期事实；套餐取消并到期后该接口仍可能保留历史 `plan_type`，不得据此覆盖 `accounts/check` 已明确返回的 Free 或其他当前套餐。只有 `accounts/check` 未提供个人套餐时，才允许回退到订阅记录。

完整卡号和 CVC 只在当前请求内交给 GAM；Team Manager 只保存品牌、尾号、有效期、默认标记和安全操作摘要。支付方式绑定必须显式指定个人空间或 Workspace 作为订阅目标，不能从执行账号或当前页面状态隐式推断。

个人空间和 Workspace 都可以绑定默认支付方式、取消自动续费。绑定支付方式依赖 Stripe Elements 与浏览器支付现场，继续由 GAM 执行；取消续费是订阅状态写入，由 Team Manager 使用目标访问上下文直接请求 ChatGPT，并实时复读 `will_renew=false`。取消续费不退款，当前权益保留到计费周期结束。

## 账号运营主套餐

账号运营主套餐是列表使用的单一运营称呼，不是 `Account`、`PersonalSpace`、`Workspace` 或 `WorkspaceMembership` 上的新事实字段。它由普通 PostgreSQL View `account_operational_summaries` 查询时投影，不缓存或双写回账号表。

投影只使用各关系的最新有效事实，按以下优先级返回第一个命中值：

1. 个人空间当前付费套餐：Go、Plus、Pro 5x、Pro 20x；
2. 账号以 owner 身份管理的活动双席位 Workspace；
3. 账号以 owner 身份管理的活动 0.52 Workspace；
4. 账号存在活动 Workspace Membership，且所有活动关系都不是 owner：Team 子号；
5. Free。

证据不足时返回 `unknown`，不得把未知伪装成 Free。Workspace Invitation、已移除关系和非活动 Workspace 不参与投影。admin 在授权和“拥有可管理空间”能力中仍属于管理员，但在主套餐称呼中不是 owner，因此满足其他条件时归为 Team 子号；账号同时存在 owner 和非 owner 活动关系时，不归为 Team 子号。

“双席位”和“0.52”只描述活动 owner Workspace 的运营套餐信号；完整 Workspace 套餐、角色和来源仍由各自事实对象表达。账号列表只展示并筛选主套餐，不额外展开其来源或命中原因，详情页继续展示个人空间和 Workspace 的完整事实。

当主套餐为“双席位”时，列表附带显示该主套餐 Workspace 的 ChatGPT 席位占用。存在多个双席位 owner Workspace 时，选择规则与主套餐生命周期一致：优先最早的未来续费，其次最近的历史续费，最后以 Workspace ID 稳定排序。占用数只统计该 Workspace 中活动 `default` Membership 与待接受的 `default` Invitation；不跨 Workspace 汇总，也不写回账号字段。

## Session 与访问上下文

账号完整 Web Session 使用不可变 `AccountSessionRevision` 保存，并在应用层加密。Access Token 按以下上下文隔离：

- `Account × PersonalSpace`；
- `Account × Workspace`。

同一账号在多个 Workspace 的 Token 不能互相覆盖。Workspace API 必须使用目标 Workspace 上下文，不能把个人 Token 或其他 Workspace Token 当成通用 Token。

## 席位与账单

远端席位类型只有：

| 原始值 | 含义 |
|---|---|
| `default` | 固定 ChatGPT 席位，可能产生固定/按比例席位费用 |
| `usage_based` | Codex/usage-based 席位，不占固定 ChatGPT 位置 |

`SeatSlot` 是 Workspace 下必须关联当前邮箱的本地客户资源。换号、邀请转成员或席位类型变化不改变客户备注、价格、到期日、公开 `seatKey` 和历史；移除成员、撤销邀请或删除失效关系时，本地客户资料和公开 `seatKey` 一并删除。Workspace 空位始终由容量与远端关系实时派生，不保存无邮箱的 `SeatSlot`。

当前成员数不等于计费席位数。移除标准 ChatGPT 成员后仍可能临时计费，因此公开换号不得自动移除已接受的 `default` 成员；管理员操作后必须核对 Billing。

席位概览只处理固定 ChatGPT 席位 Workspace，使用远端活动 `default` Membership 与待接受的 `default` Invitation 表达固定席位占用，并以已知 Business 固定容量补出空位。空位只是查询投影，不写入 `SeatSlot`。`SeatSlot` 只为匹配的邮箱附加联系方式、价格、备注、到期日和公开换号能力；没有 `SeatSlot` 的固定席位成员仍必须出现。Codex/`business_usage_based` Workspace、`usage_based` 关系及其客户资料不进入席位概览。

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
