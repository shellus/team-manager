# Workspace 席位计价与优惠码上下文实施计划

状态：已实施并完成源码、TeamCode、GAM、前端和文档验证（2026-08-29）。

## 目标

将已验证的 ChatGPT Business Checkout 协议接入 Team Manager 与 GAM：固定席位 Checkout 使用 `default` 与 `prolite` 两类席位明细；`usage_based` 保留在 Workspace/成员事实模型中，但不放入 `chatgptteamplan` 的订单数组；优惠码在生成订单前即可按明确的个人空间或 Workspace 上下文查询；已有订阅的优惠码读取和应用必须保留目标空间边界；返回结算页不再被描述为取消订单。

## 现状

- 上游 `POST /backend-api/payments/checkout` 接受 `team_plan_data.seat_quantities`，`POST /backend-api/payments/checkout/update` 会按席位类型重新计算金额。
- `GET /backend-api/promotions/eligibility/{code}` 和 `metadata/{code}` 不需要先创建订单，但结果依赖当前 `chatgpt-account-id` 上下文。
- `POST /backend-api/subscriptions/cancel` 是已有订阅停止续费，不是未支付 Checkout 的取消。
- Team Manager 当前只接受 `default | usage_based`，订单链路只有总席位数；GAM 当前发送旧的 `hosted`、总量模式请求。
- 数据库既有 `seat_type` 检查约束、席位关联和统计逻辑均需兼容新增类型，并保留无法识别值的安全读取语义。

## 修改范围

| 范围 | 动作 |
|------|------|
| `source/packages/shared` | 扩展席位类型、订单请求/结果、优惠码上下文查询合同；兼容旧的总席位字段。 |
| `source/apps/server` | 增加按个人空间或 Workspace 上下文查询优惠码的 API；升级订单服务、TeamCode 请求、席位校验、统计和审计字段；保留“停止续费”与 Checkout 返回的语义边界。 |
| `source/apps/web` | 固定席位订单页增加 ChatGPT/Premium 两类数量和前置优惠码校验；优惠码弹窗增加个人空间/Workspace 目标选择；席位管理、设置、账单和概览显示 Premium。 |
| `source/apps/server/src/database/migrations` | 新增迁移放宽成员、邀请、席位槽的 `seat_type` 检查约束，升级后回滚时不破坏未知值。 |
| `/data/compose/teamcode` | 让 `/api/order` 保留固定席位明细并转发为 ChatGPT Checkout 的 `seat_quantities`；创建表单只提供 `default`/`prolite`，未传明细时保持旧 Hosted 行为。 |
| `/data/compose/GAM/sources/gam` | Business Checkout 请求支持 `seat_quantities`、`custom` 模式和稳定返回字段；保留 usage-based credits 独立请求体。 |
| `source/docs` | 记录当前协议、上下文选择规则和取消语义，作为后续维护事实源。 |

## 步骤

1. 写入共享类型、标签、请求校验和数据库迁移，保证已有 `default`、`usage_based` 数据和接口继续工作。
2. 在 ChatGptApi、WorkspaceOperationService、WorkspaceOrderLinkService 与 TeamCodeClient 中实现按上下文优惠码预览、订单席位明细和结果解析。
3. 修改 GAM Checkout 生成与校准逻辑，校验分类型席位总量、币种、金额和 Workspace 绑定。
4. 修改 Workspace 订单弹窗、Team Orders 配置、Workspace 优惠码弹窗和席位管理页面，显示实际计价明细并明确停止续费/返回结算的区别。
5. 补充单元测试、数据库集成测试、前端测试和类型检查；检查根部署仓库、source 仓库及 GAM 仓库的边界状态，不提交运行数据和抓包原文。

## 实施结果

- [x] `default`、`usage_based`、`prolite` 已贯穿共享类型、席位关系、数据库约束和概览统计；固定席位 Checkout 请求只发送 `default` 与 `prolite`，历史总席位字段继续兼容。
- [x] 优惠码查询增加 `POST /api/accounts/:id/promotion/lookup`，请求必须指定 `target.kind=personal` 或 `workspace`；Workspace 目标经过可管理关系校验，查询先调用 eligibility，再按目标上下文调用 metadata 和订阅读取。
- [x] Workspace 优惠码弹窗增加个人空间和所有当前可管理 Workspace 的选择；个人空间只读，Workspace 才显示应用按钮，并保留停止续费后的显式确认。
- [x] 新开/升级 Workspace 的订单链接弹窗增加独立“检查优惠码”按钮：新开空间使用个人空间上下文，升级空间使用所选 Workspace 上下文；检查结果展示但不会创建订单。
- [x] 订单弹窗的检查结果展开为结构化字段，包含适用套餐、优惠席位数、优惠期限、优惠类型、计价周期、处理方、优惠结束续费规则和当前订阅摘要。
- [x] 订单席位数不再在本地强制至少 2 或设置业务上限；仅校验非负安全整数与明细总数一致，具体可用数量交给上游判断。
- [x] Checkout 返回按钮只保留 `cancel_url` 页面跳转语义；没有新增或伪造未支付订单取消接口。已有订阅停止续费仍独立使用 `POST /backend-api/subscriptions/cancel`。
- [x] TeamCode `/api/order` 和 GAM Business Checkout 均支持 `seat_quantities`；GAM 的 Custom Checkout 为显式 opt-in，默认 Hosted 路径不变。

## 验证

```bash
corepack pnpm typecheck
corepack pnpm --filter @team-manager/server test
corepack pnpm --filter @team-manager/web test -- --run
corepack pnpm build
corepack pnpm docs:build
git -C /data/compose/GAM/sources/gam diff --check
git -C /data/compose/teamcode diff --check
```

实际结果：Team Manager typecheck、73 个服务测试、90 个 Web 测试、源码 build、VitePress build 均通过；GAM typecheck 与 222 个测试通过；TeamCode 100 个测试通过。`git diff --check` 通过。PostgreSQL 集成测试因当前环境未提供 `TEAMMGR_TEST_ADMIN_DATABASE_URL` 而按项目规则跳过；数据库 023/024 迁移会在正常服务启动时应用，未直接修改运行数据。
