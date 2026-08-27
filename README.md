# Team Manager

Team Manager 是以“账号 + Workspace”为核心的 ChatGPT 运营后台。所有受管登录身份都是 `Account`；账号能否管理 Workspace，由活动的 owner/admin `WorkspaceMembership` 实时派生，不再存在账号类型。

## 开发前必读

1. [`AGENTS.md`](./AGENTS.md)：协作、Git、安全和运行数据边界。
2. [`CONTEXT.md`](./CONTEXT.md)：统一领域术语。
3. [`docs/core/seat-and-credential-model.md`](./docs/core/seat-and-credential-model.md)：账号、Workspace、席位和凭证规则。
4. [`docs/plans/unified-account-postgresql-refactor.md`](./docs/plans/unified-account-postgresql-refactor.md)：本次重构实施与验收台账。
5. [`docs/plans/account-operational-primary-plan-and-actions.md`](./docs/plans/account-operational-primary-plan-and-actions.md)：账号运营主套餐和共享操作实施计划。
6. [`docs/plans/operational-visibility-restoration.md`](./docs/plans/operational-visibility-restoration.md)：旧版运营可见性恢复和最终 UI 验收台账。
7. [`docs/guide/account-cleanup-and-refresh-sop.md`](./docs/guide/account-cleanup-and-refresh-sop.md)：账号、Workspace 刷新、封号清理和备用 owner 操作 SOP。

开始和结束任务时检查 `git status --short --branch`。

## 产品模型

- `AccountGroup`：稳定 ID 的结构化账号分组；账号恰好属于一个分组，重命名不改账号记录。
- `Account`：唯一受管 ChatGPT 登录身份，承载邮箱、备注、封号标记、GAM 引用、代理和当前 Session。
- `PersonalSpace`：账号一对一的个人空间，承载 Free、Go、Plus、Pro 5x、Pro 20x、个人支付摘要和个人设置。
- `Workspace`：独立 Team/Business 空间，承载成员、邀请、设置、订阅、账单、客户席位和 Team 订单；管理入口统一位于账号详情中。
- `WorkspaceMembership`：账号或远端成员在 Workspace 中的角色和席位事实。活动 owner/admin 关系产生“拥有可管理空间”能力。
- `WorkspaceCredential`：绑定 `Account × Workspace` 的 OAuth/PAT 凭证。JSON 正文是文件制品，PostgreSQL 只保存索引、哈希和状态。

一个账号可以管理多个 Workspace，也可以作为普通成员加入其他 Workspace。Workspace 不永久属于某个账号；进入账号详情后，以当前账号作为 Workspace 操作上下文，只有活动 owner/admin 关系可以执行空间级写操作。

## 功能

- 账号列表、单一分组、主套餐与运营条件筛选和账号详情；固定席位 Business 动态显示关系占用与订阅权益容量；URL 保存筛选与详情 Tab，账号列表弹窗使用本地状态以免轮询刷新干扰表单。
- GAM 负责注册、纳管、Profile、住宅代理和浏览器 Checkout；账号、个人空间与 Workspace 业务状态及支付方式管理由 Team Manager 直连上游处理。
- Go、Plus、Pro 5x、Pro 20x 首次开通；Plus 可通过 Team Manager 直连升级到 Pro 5x 或 Pro 20x，其他付费套餐转换在对应上游合同验证前安全拒绝。
- 个人空间与 Workspace 都支持绑定、设置默认和移除支付方式，以及取消续费；完整卡号/CVC 只进入当前 Team Manager 请求中的无追踪 Stripe Transport，不写数据库、普通日志或 HTTP trace，支付写操作都在返回前复读上游状态。
- Business 创建新 Workspace，或升级账号当前可管理的既有 Workspace。
- 账号详情内切换 Workspace；成员与邀请合并显示，账单集中呈现订阅、续费、金额、计费席位、支付方式和发票，并可校验和应用现有 Workspace 优惠码；凭证严格按 `Account × Workspace` 显示。
- 客户联系方式、备注、价格、到期日和显式到期提醒开关合并显示在账号 Workspace 的成员与邀请列表；提醒默认开启，只有同时设置到期日的席位才进入提醒调度。
- Team 升级订单维护、逐渠道幂等的有限重试通知、包含明细与管理入口的客户席位到期任务，以及独立的席位概览和母号概览页面。
- OAuth/PAT 创建、替换、重新授权、号池排序与 CPA 原子投放。
- HTTP trace、rrweb、凭证与隔离制品的文件索引、结构化日志、rrweb 回放、哈希复核和保留生命周期；Web UI 不展示或下载正文。

个人 Memory 的 PATCH 写入协议已经验证；当前值读取在上游实测返回 405，因此界面保持三态未知，不把未知伪装为关闭。只有账号 Session 在专用编辑弹窗中完整显示和保存；其他 JSON 正文不进入 Web UI。已登录管理界面右下角常驻 rrweb 调试按钮，由管理员手动开始和结束录制；录制按本项目的私有管理边界保留完整输入原文，只通过可视化回放使用。

## 数据与安全边界

PostgreSQL 是结构化业务数据的唯一事实源。应用启动只检查 migration，存在未应用 migration 时拒绝启动。

以下正文保持文件存储，数据库只保存相对 `storageKey`、SHA-256、大小和元数据：

- 完整 HTTP trace；
- rrweb `json.gz` 录制；
- OAuth/PAT JSON 凭证。

运行目录中的旧 JSON/JSONL 只保留为迁移备份证据，不在新版运行路径读取。Session、Access Token 和秘密设置在写入 PostgreSQL 前使用应用密钥加密。源码仓库不得保存真实域名、IP、端口、账号、密钥、token、代理或部署路径。

## 技术栈

- pnpm workspace、TypeScript ESM；
- Hono / Node.js 后端；
- React、Ant Design、Vite 前端；
- PostgreSQL、Kysely、`pg`；
- HS256 JWT、bcrypt 管理员密码；
- curl_cffi sidecar 作为 ChatGPT Web 传输实现；
- GAM 负责密码、浏览器身份、代理租约和浏览器 Checkout；Team Manager 负责普通 ChatGPT/Stripe HTTP 业务请求。

## 目录

| 路径 | 作用 |
|---|---|
| `apps/server` | 统一 API、领域服务、Repository、migration 与文件制品 |
| `apps/web` | 账号内 Workspace 管理、订单、设置和公开席位页面 |
| `apps/curl-cffi-worker` | ChatGPT Web 请求转发 sidecar |
| `packages/shared` | 新版前后端共享合同与 Session 解析 |
| `docs` | 领域规则、操作手册、协议样本和实施计划 |

## 开发与验证

运行配置的唯一事实源是部署目录的 `config.yaml`，结构参考 [`config.example.yaml`](./config.example.yaml)。管理员密码可以在首次迁移时填写明文，配置加载器会在跨进程锁内将其原子改写为 bcrypt cost 12；源码目录不读取 `.env`。本机完整开发实例通过部署目录的 `./tmux-dev-manager.sh` 管理。

前端的产品级组件行为集中维护：`theme/uiPolicy.ts` 负责弹层容器、视口边界、虚拟滚动和分页数量选择器，`theme/popupPolicy.css` 只保存全局弹层定位兜底；声明式弹窗/抽屉使用 `ProductModal`、`ProductDrawer`，业务日期输入使用支持整段粘贴和快捷项的 `ProductDatePicker`，非 Table 分页使用 `ProductPagination`，所有分页状态使用 `useUrlPagination`。页面可以直接使用 Ant Design `Select` 传递业务选项，但不得自行设置弹层容器、定位、动画、虚拟滚动或分页数量选择器策略。`theme/uiPolicy.test.ts` 会阻止这些旁路重新进入源码。

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm typecheck
corepack pnpm --filter @team-manager/server test
TEAMMGR_TEST_ADMIN_DATABASE_URL=postgresql://... corepack pnpm --filter @team-manager/server test:db
corepack pnpm --filter @team-manager/web test -- --run
corepack pnpm build
corepack pnpm docs:build
```

数据库命令：

```bash
corepack pnpm --filter @team-manager/server db:status
corepack pnpm --filter @team-manager/server db:migrate
```

生产 PostgreSQL、加密密钥和文件制品目录必须按同一恢复点备份并联合验证。业务操作只能经 UI、API 或 service/repository 完成，不直接编辑运行数据。

## 文档

- [使用手册](./docs/guide/)
- [账号、Workspace、席位与凭证模型](./docs/core/seat-and-credential-model.md)
- [PostgreSQL 数据模型](./docs/dev-spec/data-model.md)
- [账号运营主套餐和共享操作计划](./docs/plans/account-operational-primary-plan-and-actions.md)
- [运营可见性恢复实施计划](./docs/plans/operational-visibility-restoration.md)
- [固定 GPT 席位自助管理计划](./docs/plans/fixed-gpt-seat-self-service-management.md)
- [Team 升级订单维护](./docs/guide/team-order-maintenance.md)
- [凭证号池填充](./docs/guide/fill-credential-pool.md)
- [ChatGPT Web 协议样本](./docs/dev-spec/chatgpt-backend-api/README.md)
