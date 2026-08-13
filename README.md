# Team Manager

Team Manager 是以“账号 + Workspace”为核心的 ChatGPT 运营后台。所有受管登录身份都是 `Account`；账号能否管理 Workspace，由活动的 owner/admin `WorkspaceMembership` 实时派生，不再存在账号类型。

## 开发前必读

1. [`AGENTS.md`](./AGENTS.md)：协作、Git、安全和运行数据边界。
2. [`CONTEXT.md`](./CONTEXT.md)：统一领域术语。
3. [`docs/core/seat-and-credential-model.md`](./docs/core/seat-and-credential-model.md)：账号、Workspace、席位和凭证规则。
4. [`docs/plans/unified-account-postgresql-refactor.md`](./docs/plans/unified-account-postgresql-refactor.md)：本次重构实施与验收台账。
5. [`docs/plans/account-operational-primary-plan-and-actions.md`](./docs/plans/account-operational-primary-plan-and-actions.md)：账号运营主套餐和共享操作实施计划。

开始和结束任务时检查 `git status --short --branch`。

## 产品模型

- `AccountGroup`：稳定 ID 的结构化账号分组；账号恰好属于一个分组，重命名不改账号记录。
- `Account`：唯一受管 ChatGPT 登录身份，承载邮箱、备注、封号标记、GAM 引用、代理和 Session 修订。
- `PersonalSpace`：账号一对一的个人空间，承载 Free、Go、Plus、Pro 5x、Pro 20x、个人支付摘要和个人设置。
- `Workspace`：独立 Team/Business 空间，承载成员、邀请、设置、订阅、账单、客户席位和 Team 订单。
- `WorkspaceMembership`：账号或远端成员在 Workspace 中的角色和席位事实。活动 owner/admin 关系产生“拥有可管理空间”能力。
- `WorkspaceCredential`：绑定 `Account × Workspace` 的 OAuth/PAT 凭证。JSON 正文是文件制品，PostgreSQL 只保存索引、哈希和状态。

一个账号可以管理多个 Workspace，也可以作为普通成员加入其他 Workspace。Workspace 不永久属于某个账号；执行写操作时显式选择当前有权限的执行账号。

## 功能

- 账号列表、单一分组、主套餐与运营条件筛选和账号详情；URL 保存筛选、Tab 和弹窗状态。
- GAM 注册、绑定、同步、Profile、住宅代理和 Session 导入。
- Go、Plus、Pro 5x、Pro 20x 首次开通；已付费套餐间切换在上游合同验证完成前安全拒绝。
- 个人支付方式绑定和取消续费；完整卡号/CVC 只转交 GAM，不写数据库或普通日志。
- Business 创建新 Workspace，或升级账号当前可管理的既有 Workspace。
- Workspace 成员、邀请、角色、席位、设置、账单、客户席位、公开换号和凭证关系。
- Team 升级订单维护、有限重试通知、客户席位到期任务和跨空间运营总览。
- OAuth/PAT 创建、替换、重新授权、号池排序与 CPA 原子投放。
- HTTP trace、rrweb、凭证与隔离制品的原文查看、下载、哈希复核和保留生命周期。

个人 Memory 的 PATCH 写入协议已经验证；当前值读取在上游实测返回 405，因此界面保持三态未知，不把未知伪装为关闭。rrweb 由管理员显式开启和启动，按本项目的私有管理边界记录完整输入原文。

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
- HS256 JWT、scrypt 管理员密码；
- curl_cffi sidecar 作为 ChatGPT Web 传输实现；
- GAM 负责密码、浏览器身份、代理租约和支付自动化。

## 目录

| 路径 | 作用 |
|---|---|
| `apps/server` | 统一 API、领域服务、Repository、migration 与文件制品 |
| `apps/web` | 账号、Workspace、订单、设置和公开席位页面 |
| `apps/curl-cffi-worker` | ChatGPT Web 请求转发 sidecar |
| `packages/shared` | 新版前后端共享合同与 Session 解析 |
| `docs` | 领域规则、操作手册、协议样本和实施计划 |

## 开发与验证

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
- [Team 升级订单维护](./docs/guide/team-order-maintenance.md)
- [凭证号池填充](./docs/guide/fill-credential-pool.md)
- [ChatGPT Web 协议样本](./docs/dev-spec/chatgpt-backend-api/README.md)
