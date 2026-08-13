# 账号运营主套餐与共享操作实施计划

状态：已实施并通过自动化验收；真实扣费、套餐变更和 Workspace 创建未作为自动验收动作。

## 目标

账号列表使用一个可查询的“主套餐”称呼归纳个人套餐和 Workspace 关系，并把账号高频操作直接平铺在每行。列表与账号详情复用同一套操作组件、弹窗、状态和 API，避免相同行为形成两份实现。

## 已确认规则

### 主套餐

- 主套餐是查询投影，不是账号、个人空间、Workspace 或成员关系事实，也不缓存或双写。
- PostgreSQL 普通 View 命名为 `account_operational_summaries`；列表 API 字段与查询参数统一为 `primaryPlan`。
- 共享代码与界面称呼为：`free`（Free）、`go`（Go）、`plus`（Plus）、`pro_5x`（Pro 5x）、`pro_20x`（Pro 20x）、`business_two_seat`（双席位）、`business_usage_based`（0.52）、`team_member`（Team 子号）、`unknown`（未知）。
- 优先级为：个人付费 Go/Plus/Pro 5x/Pro 20x > 活动 owner 双席位 > 活动 owner 0.52 > Team 子号 > Free。
- Team 子号要求账号存在活动 Workspace Membership 且所有活动关系都不是 owner；admin 也算 Team 子号。账号同时存在 owner 和 member/admin 时不算 Team 子号。
- 已移除关系、待处理邀请和非活动 Workspace 不参与计算。证据不足返回 `unknown`，不伪装成 Free。
- 列表只展示、筛选最终主套餐，不显示来源、Workspace 套餐明细或命中原因。详情继续保留 `personalPlan` 等真实业务字段。

### 列表字段与导航

- 账号列主标题是邮箱，且只有邮箱 `<a>` 链接进入 `/accounts/:accountId`；整行和其他字段不触发详情跳转。
- 账号列二级标题只显示账号备注，空值显示 `—`；不使用 Workspace 名称、显示名或其他字段回退。
- 原“套餐”列改为“主套餐”，原 `personalPlan` 列表筛选改为 `primaryPlan`。
- 分组快捷筛选与动态数量保持不变；分组数量继续结合主套餐、GAM、Profile 运行和封号可见性等其他筛选条件计算。
- 列表“能力”只显示已绑定的 GAM 标签；不再重复展示可管理空间、普通成员、凭证和 Session，也不显示 Workspace 与凭证数量。
- GAM 与 Profile 运行使用勾选筛选：勾选表示只看满足条件的账号，不勾选表示不限。可管理空间、普通成员、凭证和 Session 不再提供列表筛选。
- 人工封号仍默认隐藏；勾选“显示封号”后，在账号字段中用错误状态徽标标识，不占用“能力”字段。

### 共享账号操作

操作列固定平铺以下四项，不使用“更多”下拉：

| 操作 | 行为 |
|---|---|
| 启动/停止 | 根据 Profile 状态只显示当前可执行动作；共享确认与进度弹窗，执行中禁用重复提交 |
| 换 IP | 打开完整代理编辑弹窗，统一编辑 SID、国家、ASN、州/省和城市，不拆分简单与高级模式 |
| 开通 | 打开统一套餐弹窗，支持个人 Go、Plus、Pro 5x、Pro 20x 的全新开通或变更，以及 Business 创建新 Workspace 或升级既有 Workspace |
| 编辑 | 打开完整 Session 编辑弹窗；打开即读取内容，可编辑并保存，不脱敏，不再设置查看或下载入口 |

列表与账号详情必须复用同一组操作按钮、弹窗、忙碌状态、错误处理和成功后刷新逻辑。依赖 GAM 的动作在未绑定时禁用并说明原因。弹窗由 URL 参数表示，刷新后恢复；操作按钮必须阻止账号链接或其他导航事件。

## 修改范围

| 范围 | 动作 |
|---|---|
| `apps/server/src/database/migrations/` | 新增 migration，创建 `account_operational_summaries` 普通 View 及查询所需索引；down migration 删除 View |
| `apps/server/src/database/schema.ts` | 补充 View 查询类型，不在 `accounts` 添加主套餐列 |
| `apps/server/src/repositories/accountRepository.ts` | 账号列表从 View 读取并用 SQL 处理 `primaryPlan`，删除列表查询的 `personalPlan` 语义和内存过滤 |
| `apps/server/src/repositories/unifiedProjectionRepository.ts` | 输出主套餐投影；详情保留个人套餐事实与 Workspace 关系事实 |
| `apps/server/src/unifiedApp.ts` | 列表接受 `primaryPlan` 查询参数，不提供旧参数兼容 |
| `packages/shared/src/unified.ts` | 新增主套餐联合类型和 `primaryPlan` 列表字段；`personalPlan` 只用于个人空间事实 |
| `apps/web/src/features/unified/AccountsPage.tsx` | 账号邮箱链接、备注副标题、主套餐列与筛选、平铺操作列；移除整行跳转和列表个人套餐筛选 |
| `apps/web/src/features/unified/accountListModel.ts` | 主套餐参与 URL 可恢复查询与分组动态计数 |
| `apps/web/src/features/unified/AccountDetailPage.tsx` | 详情入口切换为共享账号操作组件，移除重复的代理和 Session 表单实现 |
| `apps/web/src/features/unified/SubscriptionModal.tsx` | 收敛为个人与 Business 共用的“开通”弹窗或由新的共享弹窗替代 |
| `apps/web/src/features/unified/components/` | 建立列表和详情共用的账号操作栏及 Profile、代理、开通、Session 弹窗 |

## 实施步骤

1. 定义共享 `PrimaryPlan` 契约、中文标签和列表查询参数，明确详情 `personalPlan` 不受影响。
2. 用 migration 建立普通 View；以最新个人订阅、活动 Workspace、活动 Membership 和 Workspace 套餐信号计算主套餐，并建立支持列表筛选的索引。
3. Repository 与 `/api/accounts` 改为直接查询和筛选 `primaryPlan`，删除 JavaScript 结果集二次筛选与旧参数兼容。
4. 为全部优先级、admin、owner 与非 owner 混合关系、移除关系、邀请和未知证据编写 PostgreSQL 集成测试。
5. 提取共享账号操作组件与四个入口；Profile 使用单一状态动作，代理、开通和 Session 统一使用共享弹窗。
6. 账号列表改为邮箱链接、备注副标题、主套餐列/筛选和平铺操作；详情使用相同操作组件，删除重复表单和冗余入口。
7. 为 URL 恢复、操作事件隔离、忙碌状态、GAM 禁用提示、Session 原文编辑和成功刷新编写 Web 行为测试。
8. 运行类型检查、后端测试、数据库集成测试、Web 测试、生产构建和文档构建，再对开发实例做无扣费冒烟。

## 验收清单

### 数据与查询

- [x] `accounts` 表没有主套餐缓存列、触发器或双写服务。
- [x] `account_operational_summaries` 能在 PostgreSQL 中返回并筛选全部主套餐值。
- [x] 个人付费套餐总是覆盖 Workspace 称呼。
- [x] 双席位覆盖 0.52；仅 owner 关系参与这两项判定。
- [x] 只有非 owner 活动关系时返回 Team 子号，admin 包含在内；owner 与非 owner 混合时不返回 Team 子号。
- [x] 已移除关系、Invitation 和非活动 Workspace 不参与判定。
- [x] 明确 Free 与证据不足的 `unknown` 可区分。
- [x] 列表查询不接受旧 `personalPlan` 参数，也不在应用内存中过滤主套餐。

### 列表与详情

- [x] 账号邮箱是唯一详情链接；点击整行、备注、套餐和操作不会跳转。
- [x] 邮箱下只显示账号备注，空备注显示 `—`。
- [x] 主套餐列和筛选仅显示最终称呼，不展示来源或 Workspace 明细。
- [x] 分组数量结合主套餐和其他筛选实时计算，筛选与弹窗状态刷新不丢失。
- [x] 能力列只在已绑定时显示 GAM；账号列用错误状态徽标标识人工封号。
- [x] 列表不显示 Workspace/凭证数量，也不提供可管理空间、普通成员、凭证和 Session 筛选。
- [x] GAM 与 Profile 运行使用勾选筛选，不勾选表示不限。
- [x] 操作列平铺“启动/停止、换 IP、开通、编辑”，没有下拉菜单。
- [x] 列表与详情使用相同组件和 API，不保留第二套代理、开通或 Session 表单。
- [x] 换 IP 弹窗包含 SID、国家、ASN、州/省和城市全部字段。
- [x] 开通弹窗涵盖个人四档套餐及 Business 两种模式。
- [x] 编辑弹窗打开即加载完整 Session，可保存且不脱敏；没有单独查看或下载入口。
- [x] 未绑定 GAM、动作执行中、上游失败和成功刷新均有一致反馈。

## 验证

```bash
corepack pnpm typecheck
corepack pnpm --filter @team-manager/server test
TEAMMGR_TEST_ADMIN_DATABASE_URL=postgresql://... corepack pnpm --filter @team-manager/server test:db
corepack pnpm --filter @team-manager/web test -- --run
corepack pnpm build
corepack pnpm docs:build
```

自动验证不得执行真实扣费、套餐变更或 Workspace 创建。开发实例只验证列表查询、URL 恢复、弹窗打开、只读加载和无副作用状态动作；涉及资金或真实订阅的最终动作使用显式测试账号人工验收。

## 回滚

回滚应用提交并执行对应 migration down，恢复旧列表字段与详情内嵌表单。主套餐没有写入业务表，因此不需要修复账号、个人订阅或 Membership 数据；已有自动化操作和 Session 修订不得删除。
