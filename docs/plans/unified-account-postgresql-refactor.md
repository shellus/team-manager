# 统一账号与 PostgreSQL 重构实施计划

状态：已确认并启动实施。所有阶段按本文台账推进。

本文是本次重构的单一实施依据。实施期间如果代码现状、上游行为或用户决策与本文冲突，必须先更新本文并重新确认，不得在代码中静默改变领域模型或迁移规则。

## 执行台账

| 阶段 | 状态 | 完成提交 | 验证记录 |
|---|---|---|---|
| 阶段 0：计划确认与上游协议观测 | 进行中 | `9156c23` | 用户已批准正式实施；分组冲突采用历史母号侧分组；现有 Free 测试 Profile 的旧代理不可达，套餐切换矩阵继续观测 |
| 阶段 1：数据库基础设施 | 已完成 | `b1b28c4`、部署仓库 `a55c0b2` | PostgreSQL 18.4 固定摘要；空库/重复/并发 migration、失败回滚、隔离约束、pg_dump 恢复、加密和文件制品测试通过 |
| 阶段 2：统一领域 Schema 与 Repository | 已完成 | `293e3fe` | Account/Group/Session/Workspace/Membership/Credential/SeatSlot/设置/通知/账单/订单/文件索引 Repository 的真实 PostgreSQL 集成测试通过 |
| 阶段 3：一次性迁移器与迁移演练 | 已完成 | `e58a626` | 160 账号、69 Workspace、113 Membership、10 活动凭证、12 隔离凭证、25 席位、52 账单、923 日志、1 trace、3 rrweb；空库重复结果一致；26/26 制品双向哈希通过；pg_dump 恢复后秘密可解密、席位键稳定；阻塞 0 |
| 阶段 4：统一后端服务与 API | 进行中 | 待提交 | 新版 Account/AccountGroup/Workspace 查询与命令 API 已通过真实 PostgreSQL 集成测试；旧入口尚未从运行应用删除 |
| 阶段 5：统一前端 | 未开始 | — | — |
| 阶段 6：个人套餐与 Business 套餐 | 未开始 | — | — |
| 阶段 7：正式迁移与运行切换 | 未开始 | — | — |
| 阶段 8：文档与清理 | 未开始 | — | — |

实施期间每完成一个可独立验证的提交，必须在本表或对应阶段记录提交、验证结果和剩余阻塞。任何阶段如果发生范围、领域模型、迁移裁决或验收标准变化，必须先修改本文，再继续改代码。

## 目标

Team Manager 删除“母号/子号”双模型，将所有受管 ChatGPT 登录身份统一为账号。个人套餐、个人支付和个人设置属于账号的一对一个人空间；Team/Business 设置、订阅、账单、成员和席位属于 Workspace；账号通过 Membership 与一个或多个 Workspace 建立关系。

PostgreSQL 成为结构化业务数据的事实源。完整上游 HTTP trace、rrweb 压缩录制和 Codex JSON 凭证属于文件制品，继续存放在受控运行目录；数据库只保存需要查询和关联的元数据、哈希与相对存储键。旧业务 JSON/JSONL Store 只允许作为一次性迁移输入，完成生产迁移后退出运行路径。旧页面、旧 API、旧领域类型和旧 Store 直接删除，不提供兼容接口、重定向、双写或运行时回退。

## 已确认产品决策

1. 所有历史母号和子号统一为 `Account`，不保存账号类型。
2. 一个账号只能属于一个 `AccountGroup`；分组是可创建、重命名和删除的数据实体，不再是账号上的自由字符串。
3. “拥有可管理空间”是查询时派生的能力，不是账号字段：账号在至少一个活动 Workspace 中存在活动的 owner/admin Membership 时为真。
4. 一个账号可以管理多个 Workspace，也可以同时作为普通成员加入其他 Workspace。
5. Workspace 不永久属于某个账号。需要上游执行身份的操作显式选择具备当前权限的账号；后台策略单独保存执行账号。
6. Codex OAuth/PAT 凭证绑定 `Account × Workspace`，不能通过修改字段跨 Workspace 使用。
7. 个人套餐支持 Go、Plus、Pro 5x 和 Pro 20x，并区分首次开通与变更现有套餐。
8. Team/Business 支持创建新 Workspace 和升级当前账号可管理的既有 Workspace。
9. 不保留 `/parents`、`/subaccounts` 及其 API、类型、组件或旧行为兼容。
10. 重构必须保留真实业务连续性标识，例如 Workspace 外部 ID、GAM 账号引用、上游订阅 ID、凭证绑定和公开席位访问键；删除旧架构不等于重新生成这些标识。
11. HTTP trace、rrweb 和 Codex JSON 凭证使用文件存储，不把正文写入 PostgreSQL。

## 不做的事情

- 不建立 `isParent`、`isSubaccount`、`legacyRole` 或类似字段。
- 不以历史来源决定账号能力、页面或任务分支。
- 不让账号分组承担 Workspace 权限或套餐分类职责。
- 不让 Workspace 保存单一永久 owner 外键。
- 不做 JSON 与 PostgreSQL 双写。
- 不在数据库连接失败时回退旧文件。
- 不保留旧 URL 重定向或旧 API 适配器。
- 不使用 ORM 自动同步 Schema，不在应用启动时猜测或改写表结构。
- 不把完整卡号、CVC 或 GAM 浏览器现场复制进 Team Manager。
- 不合并 GAM 与 Team Manager；GAM 继续负责账号密码、浏览器身份、代理和支付自动化。

## 技术基线

### 数据库与访问层

- PostgreSQL 使用部署时确定的固定主版本、固定镜像摘要和持久化数据卷。
- TypeScript 查询层使用 Kysely，PostgreSQL 驱动使用 `pg` 连接池。
- Schema 通过不可改写的版本化 migration 管理；已应用 migration 不得修改。
- migration 使用数据库锁避免并发执行，并在 PostgreSQL 事务中应用支持事务的 DDL。
- 应用启动时只检查 migration 状态；存在未应用 migration 时拒绝启动，不自动迁移生产库。
- 开发、测试、迁移和生产使用不同数据库或隔离 Schema，测试不得连接当前运行库。

### 配置与秘密

- 数据库连接只从运行环境读取，例如 `TEAMMGR_DATABASE_URL`。
- Session、Cookie、Access Token 及敏感设置在应用层加密后写入数据库。
- 加密密钥和版本只存在于运行环境，不进入 Git；表中保存算法、密钥版本、nonce、认证标签和密文。
- OAuth/PAT 凭证正文只存在于权限为 `0600` 的 JSON 文件，数据库不得保存凭证正文或可还原正文的副本。
- 完整支付卡数据只在当前请求内转交 GAM，不写 Team Manager 数据库、普通日志或任务摘要。
- PostgreSQL、对应加密密钥和文件制品目录必须按同一恢复点备份并完成联合恢复验证。

### 数据库与文件制品的边界

以下结构化内容进入 PostgreSQL：

- 账号、分组、个人空间和个人订阅；
- Session 修订、空间上下文 Access Token 和会话校验状态；
- Workspace、成员、邀请、设置、订阅、账单和席位；
- OAuth/PAT 凭证元数据、文件引用、额度快照和凭证号池分组；
- GAM 绑定、账号自动化操作和安全的付款结果摘要；
- Team 升级订单、维护策略、通知配置和表单偏好；
- 账号操作日志；
- HTTP trace 文件段、rrweb 文件和凭证文件的索引元数据。

以下正文保持文件存储：

- 按容量轮转的完整上游 HTTP trace JSONL；
- rrweb `json.gz` 压缩录制；
- OAuth/PAT 规范 JSON 凭证。

文件制品统一位于环境配置的制品根目录。数据库只保存相对于该根目录的不可变 `storageKey`，禁止保存绝对路径或接受客户端传入路径。不同类别使用独立子目录，目录权限为 `0700`、文件权限为 `0600`，所有读取都必须经过服务端路径校验。

制品与数据库采用以下一致性协议：

1. 正文先写同目录临时文件，完成 `fsync`、哈希和格式校验后原子重命名为不可变目标文件；
2. 再在数据库事务中写入 `storageKey`、SHA-256、字节数、格式版本和状态；
3. 数据库提交失败产生的孤儿文件由定时扫描按宽限期清理；
4. 替换凭证或录制时生成新文件并原子切换数据库引用，不原地覆盖旧文件；
5. 删除时先在数据库标记待删除，再移动到隔离目录，宽限期后物理删除；
6. PostgreSQL 与制品目录必须作为同一恢复点备份，并通过数据库引用与文件哈希双向核对。

HTTP trace 继续按容量轮转并保留压缩历史段；数据库仅在需要按时间、请求来源或操作 ID 检索时记录 trace 段索引，不为每个请求复制正文。rrweb 延续既有保留周期，凭证文件不因业务记录停用而立即物理删除。

## 领域模型

### AccountGroup

账号分组。分组名称唯一；系统始终存在一个不可删除的默认分组。

规则：

- `Account.groupId` 必填且只能指向一个分组。
- 分组拥有稳定 ID；创建、重命名、排序和删除均通过 AccountGroup 服务完成。
- 重命名不改变分组 ID 或账号外键，名称去除首尾空白后按不区分大小写规则唯一。
- 删除非空分组前必须把账号移动到其他分组。
- 注册任务在创建时记录目标分组；账号导入成功后进入该分组。
- 账号分组与凭证号池分组是两个对象，不得复用同一字段或表。

### Account

唯一的受管 ChatGPT 登录身份，以规范化邮箱去重。

账号级字段包括：

- 邮箱、备注、账号分组和人工封号标记；
- GAM 显式引用；
- 账号代理网关引用；
- 远端用户资料缓存；
- 创建、更新时间和最近错误摘要。

账号不保存 Workspace 角色、Workspace 设置、Team 订阅或客户席位。

### PersonalSpace

账号的一对一个人空间。Free、Go、Plus、Pro 5x 和 Pro 20x 均属于个人空间，不属于 Workspace Membership。

个人空间承载：

- 当前及历史个人订阅快照；
- 个人账单与支付方式安全摘要；
- 个人额度；
- 用户名、显示名、通知和 Memory 等个人设置快照。

### AccountSessionRevision

账号完整 ChatGPT Web Session 的不可变修订。新 Session 写入新修订并切换 current 指针，不覆盖历史密文。

每个修订至少保存：

- 原始 JSON 密文及明文 SHA-256；
- 来源、来源更新时间和采集时间；
- Session 中可校验的用户邮箱与个人 account ID；
- 是否为当前修订。

### AccountAccessContext

从账号 Session 换取的 Web Access Token 必须按空间上下文保存，不能让多 Workspace 账号互相覆盖 Token。

上下文只有两种：

- `personal`：指向账号的 PersonalSpace；
- `workspace`：指向一个 Workspace。

数据库约束保证个人上下文与 Workspace 上下文互斥，并保证 `Account × Context` 唯一。

### Workspace

独立 Team/Business 空间，以远端 Workspace account ID 唯一识别。

Workspace 承载：

- 名称、状态和远端套餐信号；
- Team/Business 或 usage-based 订阅；
- Workspace 设置和账单快照；
- 客户 SeatSlot；
- Team 订单维护关系。

### WorkspaceMembership

Workspace 中一个已接受成员的远端事实。Membership 可选关联本地 Account，因为远端成员不一定已经录入 Team Manager。

字段至少包括：

- Workspace；
- 可空的本地 Account；
- 远端用户 ID、规范化邮箱和显示名；
- 原始角色与规范化角色；
- `default` 或 `usage_based` 席位类型；
- 活动、移除或未知状态；
- 加入时间、观测时间和来源。

唯一性由远端用户 ID 和规范化邮箱的部分唯一索引共同保证。owner/admin 管理能力只从活动 Membership 派生。

### WorkspaceInvitation

Workspace 邀请与 Membership 分表。邀请可选关联已录入账号，但不能用空 Membership 代替邀请生命周期。

### WorkspaceCredential

直接绑定账号与 Workspace 的 OAuth 或 PAT 凭证，不以 Membership 作为父记录。规范 JSON 凭证正文保存为文件；数据库保存相对存储键、内容哈希、格式版本、来源、状态和额度快照。

新建凭证时，服务层必须证明账号在该 Workspace 中存在活动 Membership，或存在邮箱匹配的待接受邀请；后者用于已观测到的“接受邀请前生成 PAT”流程。凭证记录保存创建时的关系依据。邀请转为正式成员、成员离开或邀请失效时更新凭证状态，但不通过删除记录伪装上游撤销。

账号分组与凭证号池分组相互独立。凭证停止使用时保留历史证据，不通过删除记录伪装上游撤销。

### SeatSlot

Workspace 下的本地客户席位资源。公开访问键原值迁移并保持可用；客户联系方式、备注、价格、到期日和换号历史属于 SeatSlot，不属于账号。

### AutomationOperation

Team Manager 发起或追踪的注册、Profile、代理、套餐、Workspace 和凭证操作。

注册操作在账号创建前允许 `accountId` 为空，并保存目标账号分组；操作成功收敛后关联唯一账号。其他账号操作必须关联账号，需要 Workspace 上下文时额外关联 Workspace。

操作只保存安全请求摘要、外部 GAM 操作 ID、状态、阶段、错误和时间，不保存 PAN/CVC。

## 关系与数据库约束

```text
AccountGroup 1 ── N Account 1 ── 1 PersonalSpace
                         │
                         ├── N AccountSessionRevision
                         ├── N AccountAccessContext
                         ├── N AutomationOperation
                         ├── N WorkspaceMembership N ── 1 Workspace
                         └── N WorkspaceCredential N ── 1 Workspace
                                                              ├── N WorkspaceInvitation
                                                              ├── N WorkspaceSubscriptionSnapshot
                                                              ├── N WorkspaceSettingSnapshot
                                                              ├── N BillingSnapshot
                                                              └── N SeatSlot
```

必须由数据库表达的约束：

- 规范化账号邮箱唯一；
- GAM 账号引用唯一且可空；
- 每个账号恰有一个个人空间和一个账号分组；
- Workspace 外部 ID 唯一；
- 本地账号与同一 Workspace 的活动 Membership 唯一；
- Membership 的远端用户 ID、邮箱唯一规则使用部分唯一索引；
- Access Context 必须且只能选择个人空间或 Workspace；
- WorkspaceCredential 分别外键关联 Account 和 Workspace，不外键关联 Membership；同一凭证外部 ID 或正文指纹唯一；
- 新建 WorkspaceCredential 的业务资格必须来自活动 Membership 或邮箱匹配的待接受 WorkspaceInvitation，邀请路径不得伪造正式 Membership；
- 一个 Workspace 的公开 `seatKey` 全局唯一；
- 同一 SeatSlot 同时最多存在一个活动换号操作；
- 同一业务幂等键只能产生一个有效自动化操作；
- 所有时间使用 `timestamptz`，业务日期使用 `date`，不再用自由格式字符串保存时间。

## 主要表清单

| 模块 | 表 |
|---|---|
| 账号 | `account_groups`、`accounts`、`account_operational_profiles`、`gam_bindings` |
| Session | `account_session_revisions`、`account_access_contexts` |
| 个人空间 | `personal_spaces`、`personal_subscription_snapshots`、`personal_setting_snapshots`、`personal_quota_snapshots` |
| Workspace | `workspaces`、`workspace_memberships`、`workspace_invitations`、`workspace_subscription_snapshots`、`workspace_setting_snapshots` |
| 凭证 | `credential_pool_groups`、`workspace_credentials`、`credential_quota_snapshots`；凭证正文为文件制品 |
| 席位 | `seat_slots`、`seat_slot_identity_history`、`seat_slot_swap_operations` |
| 财务 | `billing_snapshots`、`billing_invoices`、`payment_method_summaries` |
| 自动化 | `automation_operations`、`automation_operation_events`、`payment_attempt_summaries` |
| Team 订单 | `team_order_configurations`、`team_order_maintenances`、`team_upgrade_orders` |
| 设置通知 | `system_settings`、`notification_policies`、`notification_deliveries` |
| 证据 | `upstream_trace_segments`、`rrweb_recordings`、`account_activity_logs`；trace/rrweb 正文为文件制品 |
| 迁移 | `schema_migrations`；一次性迁移映射和报告不得成为运行时领域表 |

低频且结构易变的业务快照可使用 `jsonb` 保存原文，但稳定的查询字段必须拆成有约束的列，不能把全部新模型重新塞回一个 JSONB 大对象。HTTP trace、rrweb 和凭证正文不得借 `jsonb` 或 `bytea` 绕过文件存储边界。

## “拥有可管理空间”筛选

查询条件：

```text
存在 WorkspaceMembership：
  membership.account_id = 当前账号
  membership.status = active
  membership.normalized_role ∈ {owner, admin}
  workspace.status = active
```

结果只用于列表筛选、能力判断和操作入口。不得写回账号表，也不得据此改变账号分组。

账号列表至少支持以下 URL 可恢复筛选：

- 账号分组；
- 拥有可管理空间：是/否；
- 作为普通成员加入 Workspace：是/否；
- 拥有 Workspace 凭证：是/否；
- GAM 已关联：是/否；
- Profile 运行中：是/否；
- 个人套餐；
- 人工封号状态；
- 关键词。

## 页面信息架构

### 新路由

```text
/accounts
/accounts/:accountId
/accounts/:accountId/workspaces/:workspaceId
/workspaces
/workspaces/:workspaceId
/overview/workspaces
/overview/seats
/team-orders
```

账号详情包含：

- 概览；
- 账号管理：GAM、Profile、代理和 Session；
- 个人空间：套餐、支付方式、账单、额度和个人设置；
- Workspaces：管理和加入的全部空间；
- 凭证与额度；
- 操作记录。

Workspace 详情包含：

- 概览；
- 成员与邀请；
- 客户席位；
- Workspace 设置；
- 账单与订阅；
- Team 订单维护；
- 账号与凭证关系。

### 直接删除的旧路由与页面

- `/parents`、`/parents/*`；
- `/subaccounts`、`/subaccounts/*`；
- 母号概览命名；
- Parent/Subaccount 两套 Route、List、Detail、Settings 和注册任务组件；
- 以历史角色决定可见性的前端 helper 和筛选偏好。

访问删除后的路径直接返回未匹配页面，不重定向。

### 新 API

API 以 `/api/accounts`、`/api/workspaces`、`/api/operations`、`/api/settings` 为主边界。需要两个上下文的操作在路径或请求体中同时携带 `accountId` 和 `workspaceId`。

直接删除所有 `/api/parents`、`/api/subaccounts` 及语义相同的旧 `/api/accounts` 母号接口；新 `/api/accounts` 不复用旧返回结构。

## 套餐模型与操作

### 个人套餐规范化

| UI 名称 | 内部代码 | 已观测上游 Checkout `plan_name` |
|---|---|---|
| Go | `go` | `chatgptgoplan` |
| Plus | `plus` | `chatgptplusplan` |
| Pro 5x | `pro_5x` | `chatgptprolite` |
| Pro 20x | `pro_20x` | `chatgptpro` |

数据库同时保存规范代码和上游原始 plan code。未知新套餐进入 `unknown` 规范状态并保留原值，不能错误归类。

### 个人套餐命令

统一命令：`change_personal_subscription`。

请求至少包含：

```ts
interface ChangePersonalSubscriptionRequest {
  targetPlan: 'go' | 'plus' | 'pro_5x' | 'pro_20x';
  mode: 'start_new' | 'change_existing';
  country: string;
  currency: string;
  promoCode?: string;
  autoPay: boolean;
  card?: PaymentCard;
}
```

执行前必须实时读取个人订阅并校验：

- 无活动付费订阅时只允许 `start_new`；
- 已有活动付费订阅时只允许 `change_existing`；
- 目标与当前相同返回幂等成功；
- 升档、降档和同档判断来自规范套餐顺序；
- UI 必须展示上游确认的生效时间和计费结果，不能用本地推测冒充结果。

取消续费统一为 `cancel_personal_subscription_renewal`，不再使用 Pro5x 专用命名。

### Team/Business 命令

统一命令：`open_business_subscription`，模式为：

- `create_workspace`：创建新的 Business Workspace；
- `upgrade_existing_workspace`：升级当前账号可管理的既有 Workspace。

升级模式必须校验所选账号在目标 Workspace 中存在活动 owner/admin Membership，并向 GAM 传递目标 Workspace 外部 ID。已有有效 Business 订阅时返回幂等成功。

### 上游协议验证门禁

现有样本已经证明四个个人套餐的首次 Checkout plan name，以及 Team 创建和 `existing_workspace_id` 升级入口。它们没有证明所有个人套餐相互切换时都能安全复用同一 Checkout 请求。

正式实现个人套餐变更前，必须通过 GAM 受管浏览器只读观察当前 Pricing/My Plan 页面与网络请求，记录：

- Free 到四个目标套餐；
- Go、Plus、Pro 5x、Pro 20x 之间的升档与降档；
- 立即生效、下周期生效和按比例计费响应；
- 已保存支付方式与新卡路径；
- 取消续费后的恢复或再次变更行为。

未观察到的组合在 UI 中禁用并显示“尚未验证”，不得根据 plan name 猜测实现。

## GAM 合同改造

GAM 当前 Pro 5x 专用合同必须泛化：

- `open-pro-5x` → `change-personal-subscription`；
- `cancel-pro-5x-renewal` → `cancel-personal-subscription-renewal`；
- `hasPro5x` → 当前个人套餐与订阅快照；
- Pro5x 专用任务阶段、错误码和支付统计 → 带 `targetPlan` 的个人套餐任务；
- Pro5x 专用订阅 Store → 通用个人订阅 Store。

Team Manager 与 GAM 分别在各自 Git 边界提交。GAM 保持支付秘密、浏览器现场和代理租约的事实源；Team Manager 只保存命令、外部操作关联、安全摘要和最终订阅投影。

## 一次性迁移规则

一次性导入工具不是兼容层。它只读取操作前冻结的旧数据快照，写入空的新数据库；生产迁移和验收完成后从最终源码树删除，应用运行时不得导入旧格式。

### 迁移输入

- 账号与 Workspace JSON；
- 子号与 Team 关系 JSON；
- 凭证目录；
- 账单快照；
- Team 订单和维护配置；
- 应用设置；
- 账号操作日志；
- 上游 HTTP trace；
- rrweb 录制。

### 账号归并

- 账号以规范化邮箱为唯一身份。
- 同一邮箱的历史母号、子号和多个 Workspace 记录合并为一个新 Account。
- 新数据库使用新的内部 UUID；所有旧内部 ID 仅在私有迁移报告中映射，不进入最终领域表。
- `managedAccountEmail`、Session 身份和记录邮箱不一致时停止该账号迁移并报告冲突，不猜测覆盖。
- 同一账号的非空 Session 不一致时按可验证的新旧时间与上游身份选择 current，同时把其他可验证版本保存为历史修订；无法排序或身份不一致时停止迁移。

### 单分组裁决

- 所有历史非空 `groupName` 先按规范化名称去重并创建 `AccountGroup`，账号迁移后只保存 `account_group_id` 外键，不再保存名称副本。
- `AccountGroup` 至少包含稳定 ID、唯一规范化名称、显示名称、排序、创建时间和更新时间；重命名只修改分组记录，不批量改写账号。
- 空分组进入默认分组。
- 同一账号只有一个非空来源分组时直接采用。
- 当前旧数据中存在一个已知冲突：同一规范化邮箱同时出现在母号表和子号表，两边 `groupName` 均非空但名称不同。统一后只能选择一个 AccountGroup，这就是“分组冲突”；它不代表 Workspace 权限冲突。
- 对所有此类冲突，按本次已确认规则采用历史母号侧首个非空分组，并在脱敏迁移报告中记录 `ACCOUNT_GROUP_CONFLICT_PARENT_SELECTED`；没有母号非空分组时采用子号分组。
- 被舍弃的旧分组只进入私有迁移报告，不进入账号标签或兼容字段。

账号分组与凭证 `groupName` 分别迁移到 AccountGroup 和 CredentialPoolGroup，不得互相覆盖。

### Workspace 与成员

- 每个唯一远端 Workspace ID 生成一个 Workspace。
- 每条历史母号 Workspace 记录为归并后的账号生成 owner/admin Membership。
- 历史角色存在时保留原值；历史角色缺失但旧系统已验证该账号可管理 Workspace 时，写入规范 owner 角色，并把 `roleSource=inferred_legacy_manageable` 保存到迁移报告。
- 子号 `teamLinks` 转换为对应账号与 Workspace 的 Membership 或邀请事实。
- 远端成员缓存全部进入 WorkspaceMembership；未录入账号的成员保持 `account_id = null`，不得为了满足外键创建虚构账号。
- pending invite 进入 WorkspaceInvitation，不转成 Membership。

### 凭证与席位

- 每份凭证解析后校验账号身份、Workspace ID 和文件哈希，再原子写入新版文件制品目录；数据库只写入相对存储键与元数据。
- 无法映射 Workspace 的凭证作为阻塞冲突，不删除、不挂到猜测空间。
- 凭证或账单正文携带唯一明确的远端 Workspace ID、但旧 Workspace 列表缺失时，创建 `status=unknown` 的 Workspace 证据占位；不得据此创建或推断 owner/member Membership。
- 未被当前凭证元数据引用、且凭证邮箱无法归并到本地账号的合法 JSON 文件迁入新版 `credential-quarantine` 制品区；数据库保存脱敏身份哈希、Workspace 证据、内容哈希、大小和隔离原因，默认不可用且不伪造账号。
- SeatSlot 的公开访问键必须原值迁移并做唯一性校验。
- SeatSlot 当前邮箱、客户资料、状态、换号历史和活动换号操作全部迁移到目标 Workspace。

### 设置、账单、订单和证据

- 账单快照以 Workspace 或 PersonalSpace 上下文导入，无法判断上下文时阻塞迁移。
- Team 订单维护从旧账号 ID 重绑到 Workspace，并保存执行账号。
- 通知渠道秘密加密导入；表单偏好进入系统设置。
- 旧账号操作日志 JSONL 按完整行边界导入数据库，保存源文件 SHA-256、行号和原始字节 SHA-256，重复运行不得重复写入。
- 现有凭证 JSON 校验账号、Workspace、格式和 SHA-256 后迁移到新版不可变制品目录，数据库写入相对存储键与元数据，不导入正文。
- rrweb 文件按 UUID、压缩字节哈希和时间迁移到新版制品目录，数据库只导入索引，迁移后继续执行既有保留周期。
- HTTP trace 保持 JSONL 文件格式并纳入新版轮转与压缩策略；数据库只导入或重建文件段索引。
- 迁移演练必须执行数据库引用到文件、文件到数据库引用的双向核对；未被引用的文件不得静默删除。

### 迁移幂等与报告

迁移工具必须支持在空测试数据库上重复运行并得到相同结果。正式迁移报告只保存：

- 输入文件和目录哈希；
- 各来源记录数、目标记录数和映射数；
- 冲突代码和来源引用；
- 凭证、Session、trace 和 rrweb 的逐项哈希校验结果；
- 未迁移、重复、推断和人工裁决数量。

报告不得包含 Session、Token、Cookie、凭证正文、完整 HTTP 交换或真实支付秘密。

## 删除清单

实施完成后最终源码树必须删除或改写：

- `AccountStore` 与 `SubaccountStore` 文件持久化实现；
- `AccountBillingStore`、`TeamOrderStore`、`AppSettingsStore` 的文件实现；
- `privateDataFile` 中服务于旧业务 JSON Store 的 helper；保留或重写文件制品所需的权限、原子写入和路径校验能力；
- `ParentAccountManagerService` 和 `SubaccountService` 的角色专用分支；
- `Parent*`、`Subaccount*` 类型与前端目录；
- `OpenPro5x*`、`Pro5xSubscription*`、Pro5x 专用支付统计命名；
- 旧账号/子号注册 API 和旧页面路由；
- 运行时读取旧账号、设置、账单、订单等业务 JSON/JSONL Store 的代码；
- 旧凭证目录布局及其对 `Subaccount` ID 的依赖；凭证文件读取迁移到统一 Account × Workspace 制品服务；
- 完成生产迁移后的一次性旧格式导入工具。

保留的功能必须迁移到统一模块，不能通过删除旧文件丢失能力。

## 实施阶段与完成条件

### 阶段 0：计划确认与上游协议观测

- 用户确认本文所有决策和待确认项。
- 完成个人套餐切换的只读网络协议矩阵。
- 更新本文中的已验证与未验证组合。

当前观测记录：已有 Free 测试 Profile 的历史代理不可达，浏览器只读观测未取得新的套餐切换请求。首次 Checkout plan name 和 Business `existing_workspace_id` 继续以既有本地证据为已验证范围；个人付费套餐之间的相互切换仍为未验证，UI 实施时保持禁用，直到取得只读网络证据。

完成条件：套餐操作合同不依赖猜测。

### 阶段 1：数据库基础设施

- 增加 PostgreSQL Compose 服务、生产 migration 服务和开发管理命令。
- 增加 Kysely/pg 数据库包、连接池、事务 helper 和版本化 migrations。
- 建立隔离测试数据库工具。
- 增加加密、密钥版本和数据库健康检查。

完成条件：空库 migration、重复检查、事务回滚、并发 migration 锁和隔离测试通过。

### 阶段 2：统一领域 Schema 与 Repository

- 建立本文列出的核心表和数据库约束。
- 建立 Account、PersonalSpace、Workspace、Membership、Credential、SeatSlot Repository。
- 建立数据库版设置、账单、订单和通知 Store，以及带数据库索引的凭证、trace、rrweb 文件制品 Store。

完成条件：所有新 Repository 有数据库集成测试，业务代码尚不需要读取旧文件。

### 阶段 3：一次性迁移器与迁移演练

- 冻结旧数据快照并创建独立备份。
- 实现只读一次性导入工具和私有报告。
- 在隔离数据库重复执行导入、冲突和逐字节校验。
- 完成恢复演练。

完成条件：所有来源记录均已迁移、明确冲突或明确判定为非业务缓存，没有静默丢失。

### 阶段 4：统一后端服务与 API

- 使用统一 AccountService 和 WorkspaceService 替换角色专用 Service。
- 所有操作显式使用 Account、PersonalSpace 或 Account × Workspace 上下文。
- 新 API 一次切换到数据库 Repository。
- 删除旧 API、旧 Store 和运行时文件读取。

完成条件：Server 测试只面向新 API，源码中不存在旧路由合同。

### 阶段 5：统一前端

- 实现统一账号列表、账号详情、Workspace 列表和 Workspace 详情。
- 合并注册、GAM、Profile、代理、Session、个人设置和个人支付组件。
- 凭证和额度统一到 Account × Workspace。
- 删除 Parent/Subaccount 前端目录、路由和本地偏好键。

完成条件：刷新、复制 URL、浏览器前进后退可恢复路径、Tab、筛选和弹窗；旧 URL 不匹配。

### 阶段 6：个人套餐与 Business 套餐

- 在 GAM 实现通用个人套餐合同和状态机。
- 在 Team Manager 接入四种个人套餐、首次开通、变更、取消续费和订阅刷新。
- Team/Business 支持创建新 Workspace 和升级既有 Workspace。
- 支付统计按目标套餐聚合，不再以 Pro5x 命名。

完成条件：已验证套餐组合、幂等、失败恢复、人工付款和取消续费测试通过。

### 阶段 7：正式迁移与运行切换

- 停止所有 Team Manager 写入方。
- 备份旧运行数据、数据库和加密密钥。
- 在生产数据库执行 migration 和一次性导入。
- 运行数量、关系、哈希、公开席位键和凭证校验。
- 启动新版并完成 UI、API、后台任务和外部依赖验证。
- 删除最终源码中的一次性旧格式导入工具。

完成条件：新版结构化业务数据只依赖 PostgreSQL，运行时只打开本文允许的 trace、rrweb 和凭证文件制品，不再打开旧业务 Store，Team Manager 与 GAM 健康且关键真实操作通过。

### 阶段 8：文档与清理

- 重写 README、CONTEXT、核心规则、数据模型和使用手册。
- 删除“母号/子号”作为当前产品实体的说明。
- 更新部署备份、恢复、迁移和数据库维护命令。
- 更新或删除已过期 follow-up 文档。

完成条件：文档只描述新版模型，全文搜索不再出现作为当前类型或路由的 Parent/Subaccount。

## 建议提交边界

1. `docs: 固化统一账号和 PostgreSQL 重构计划`
2. `feat: 增加 PostgreSQL 迁移与隔离测试基础设施`
3. `feat: 建立统一账号和 Workspace 数据模型`
4. `feat: 增加旧运行数据一次性迁移与校验`
5. `feat: 用统一账号和 Workspace API 替换旧接口`
6. `feat: 合并账号和 Workspace 管理页面`
7. `feat: 泛化 GAM 个人套餐操作`
8. `feat: 接入四档个人套餐和 Business 开通模式`
9. `refactor: 删除母号子号和旧业务文件 Store`
10. `docs: 更新新版使用与部署文档`

GAM 的合同和状态机变更在 GAM 仓库使用独立提交，不与 Team Manager 源码提交混合。

## 验证门禁

至少执行：

```bash
corepack pnpm typecheck
corepack pnpm --filter @team-manager/web test
corepack pnpm --filter @team-manager/server test
corepack pnpm build
corepack pnpm docs:build
```

并增加以下专项门禁：

- 空库 migration 到最新版本；
- 已是最新版本时重复 migration 无变化；
- migration 失败后事务回滚；
- 并发 migration 只有一个执行者；
- 隔离数据库全量集成测试；
- 一次性导入重复执行结果一致；
- 所有旧记录有目标映射或显式冲突；
- Session、凭证、trace 和 rrweb 哈希一致；
- 账号只有一个分组；
- 一个账号管理多个 Workspace 的权限正确；
- 同一账号在不同 Workspace 的 Token、凭证和额度隔离；
- 未录入账号的远端成员能够保存和显示；
- 公开 SeatSlot 访问键迁移后原链接仍可使用；
- 旧页面与旧 API 不存在；
- 应用运行期间不打开旧业务 JSON/JSONL Store 或旧凭证目录，只访问数据库引用的新版文件制品；
- 数据库与制品目录在同一恢复点恢复后，秘密可解密、文件哈希一致、公开访问键稳定、后台任务可继续；
- 数据库引用的制品全部存在且哈希一致，制品目录中的孤儿文件均处于允许的临时或隔离状态；

生产验证至少覆盖：

- 账号列表与“拥有可管理空间”筛选；
- 一个可管理 Workspace 的成员、邀请、设置和账单刷新；
- 一个普通成员账号的 Team 关系和凭证额度；
- Profile、代理和 Session 更新；
- 一个不产生扣款的个人套餐只读刷新；
- Team 订单维护状态恢复；
- 通知测试；
- 上游 HTTP 原始证据和 rrweb 录制的文件写入、数据库索引、读取与保留策略。

会产生资金、成员移除或真实套餐变化的验证只使用用户指定样本。

## 回滚方案

正式切换前必须具备：

- 旧运行目录完整只读备份；
- PostgreSQL 切换前备份；
- 数据库加密密钥备份；
- 旧 Team Manager 固定镜像或可重建源码提交；
- 反向代理和运行模式切换记录。

切换失败时：

1. 停止新版写入方；
2. 保存失败数据库用于排查，不在其上继续试错；
3. 恢复旧运行目录快照与旧服务版本；
4. 验证旧服务健康和关键业务读取；
5. 修复后从新的旧数据快照重新迁移，不对失败库做手工补丁冒充成功。

回滚能力只用于正式切换故障，不构成新版运行时兼容层。

## 最终验收标准

- PostgreSQL 是结构化业务数据的事实源；HTTP trace、rrweb 和凭证正文是明确允许的文件制品。
- 最终源码不读取旧业务 JSON/JSONL Store 或旧凭证目录，只通过统一制品服务访问数据库引用的文件。
- 账号只属于一个账号分组。
- 账号能力不由历史母号/子号来源驱动。
- “拥有可管理空间”完全由活动 Workspace Membership 派生。
- 一个账号可同时管理多个 Workspace，并在其他 Workspace 中作为普通成员。
- Workspace 成员允许不关联本地账号。
- Session Access Token、凭证、额度和账单严格按个人空间或 Workspace 隔离。
- Go、Plus、Pro 5x、Pro 20x 和 Business 的已验证开通/变更路径形成闭环。
- 旧路由、旧 API、旧类型和旧 Store 从最终源码删除。
- 所有业务数据、公开访问键和上游绑定经迁移校验，没有静默丢失。
- 文档、测试、构建、数据库备份恢复和生产验证全部通过。

## 最终确认

已确认调整：

1. **文件制品边界**：HTTP trace、rrweb 压缩录制和 Codex JSON 凭证正文保持文件存储；PostgreSQL 只保存索引、状态、哈希、大小、格式版本和相对存储键。
2. **账号分组结构化**：历史 `groupName` 迁移为独立 `AccountGroup` 表与 `Account.group_id` 外键，支持创建、重命名、排序和安全删除。

3. **历史分组冲突裁决**：同一账号在旧母号表和子号表拥有不同非空分组时，优先采用历史母号记录的分组；没有历史母号分组时采用子号分组。本次复核快照只有一个此类账号，正式迁移前仍需重新扫描并在迁移报告中记录裁决。

本文已获得正式实施确认。实施从阶段 0 开始并按本文逐项推进；任何新增范围或模型变更先回写本文。
