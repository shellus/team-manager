# team-manager

ChatGPT Team 母号与子号管理后台。系统录入 Team 母号和子号的 ChatGPT session，通过 ChatGPT Web backend-api 管理 Team workspace 的成员、邀请、席位类型、默认席位、Team 名称、子号 PAT 和额度查询。

## Agent Quick Start

新 agent 进入仓库后先读：

1. [`AGENTS.md`](./AGENTS.md)：项目协作、git、安全、数据文件操作规则。
2. 本 README：项目定位、架构地图、验证命令和文档索引。
3. [`CONTEXT.md`](./CONTEXT.md)：Team、客户席位、成员、邀请和到期提醒的统一业务术语。
4. [`docs/core/seat-and-credential-model.md`](./docs/core/seat-and-credential-model.md)：母号、子号、Team、席位、Codex 凭证和账单红线的基本规则。
5. `.codex/AGENTS.md`：如果本机存在该文件，读取当前运行实例、nginx 入口、tmux/docker 状态。该文件是本机私有说明，不进入 git。

开始改代码前先执行：

```bash
git status --short --branch
```

常用验证命令：

```bash
corepack pnpm --filter @team-manager/shared build
corepack pnpm --filter @team-manager/server test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm docs:build
```

## 安全边界

- 源码可以公开；运行时持有的 access token、refresh token、sessionToken、Codex credential、管理员口令、代理和部署入口不得进入 git。
- 运行时数据放在部署环境挂载的 `data/`，环境变量放 `.env` 或部署系统配置。
- git 管理文件不得写真实域名、IP、端口、账号、token、代理地址或本机部署路径；本机事实记录到 `.codex/AGENTS.md`。
- GPT Account Manager 和 curl_cffi worker 连接信息属于运行环境配置；源码不保存真实连接参数。
- TeamCode 连接信息由 `TEAMMGR_TEAMCODE_BASE_URL` 和 `TEAMMGR_TEAMCODE_PASSCODE` 提供；口令及真实地址只放运行环境，不进入源码仓库。
- 母号和子号列表只返回摘要，普通详情不返回 Web Session JSON 或代理地址；编辑本地资料时通过独立 `local-profile` 接口按需读取。只有显式凭证导出接口才返回 Codex credential JSON。
- 不要通过编辑 `data/*.json` 执行业务操作。业务变更走 API、UI 或 service/store 方法。

## 功能范围

- **母号管理**：录入已有可管理 Workspace，或通过 GPT Account Manager 自动注册账号并立即录入母号；手工录入且带 `sessionToken` 的既有母号可在账号管理页直接纳入 GAM，由 GAM 用现有 Web Session 建立独立浏览器身份，不要求 Team Manager 保存密码或 Profile。有 GAM 关联的母号可独立启动或关闭账号运行 Profile，并可开通 0.52 Codex Workspace 或双席位 Team。0.52 usage-based Workspace 与 Team Workspace 都支持成员、邀请、设置和账单操作；双席位状态只表示是否购买 Team 套餐。所有母号均可通过“同步 Workspace”发现外部开通的 0.52 或 Team 并校准本地状态。双席位可新建 Team，也可选择该账号下的既有 Workspace 进行升级；自动点击 Pay 默认关闭。母号列表只显示已开通的 0.52、双席位能力标签，周限、月限或未知限额只在双席位母号上显示；关键词搜索下方可按 GAM、0.52、双席位、限额类型、封号和订单维护状态快捷筛选，所有二态维度统一使用“是 / 否”，筛选值会同时保存在 URL 和浏览器本地偏好中。
- **本地资料编辑**：GPT 账号名称统一使用 `email`，本地备注统一写入 `remark`。母号和子号都可按各自顶层 `groupName` 分组，并可人工维护独立的封号标记；母号另用 `limitType` 记录本地限额类型，并用 `nextRenewalOn` 记录 Team 下次续费日期。封号母号的空位不进入概览统计，封号子号不能邀请加入 Team，其他操作不受限制。母号和子号都可配置独立代理地址并替换 chatgpt.com session JSON；不会修改远端 Team 名称。子号顶层分组与 `codexCredentials[].groupName` 的 CPA 凭证号池分组彼此独立。
- **成员管理**：列成员、移除成员、调整单个成员席位。
- **邀请管理**：发送 Team 邀请、列 pending invite、撤销邀请。
- **席位位置**：用 `seatSlots` 记录母号下售出的本地客户席位位置，可关联 ChatGPT 或 Codex 席位；`seatKey` 可打开免登录页面查看备注、到期时间、价格、当前邮箱和换号历史。公开换号不会自动移除已接受的标准 ChatGPT 成员，避免临时计费和 Workspace 风险。
- **Team 设置**：读取与修改新成员默认席位类型、允许成员发送 Codex 邀请、允许用户创建个人访问令牌等开关。
- **Team 改名**：调用远端接口修改 ChatGPT workspace 名称。
- **子号池**：录入子号 Session，或通过独立 GPT Account Manager 自动注册并取得业务所需 Web Session；有 GAM 关联的子号可启动或关闭账号运行 Profile。
- **PAT 与额度**：按子号和 Team workspace 创建 PAT，查询并缓存对应 workspace 的 Codex 额度。
- **子号加入母号**：用子号邮箱邀请加入指定 Team，并同步本地 Team 关系状态。
- **Team 升级订单维护**：把选定的 Codex Workspace 母号显式加入独立维护池，按全局配置和可选逐字段覆盖每 8 小时生成一个普通两席位 Team 升级订单；支持单个立即生成、10 分钟内分散批量触发、支付链接有效期和最近 30 条历史，不轮询付款状态。

## 技术栈

- **monorepo**：pnpm workspace。
- **共享类型**：`packages/shared`。
- **后端**：Hono、`@hono/node-server`、TypeScript ESM。
- **前端**：React、Vite。
- **持久化**：文件持久化，无数据库。
- **鉴权**：HS256 JWT、scrypt 口令、可选固定 API token。
- **ChatGPT 调用**：`apps/server/src/chatgptApi.ts` 负责 backend-api 请求口径，`apps/server/src/transport.ts` 负责传输抽象。
- **上游追踪**：后端所有外部 HTTP 请求通过 `Transport` 或 `fetchWithRawTrace` 发出；运行时另有进程级 `fetch` 兜底。架构测试禁止新增可绕过完整原始追踪的网络出口。
- **Cloudflare 传输**：部署默认通过 `apps/curl-cffi-worker` sidecar 访问 ChatGPT Web backend-api；sidecar 只提供通用请求转发。

## 目录地图

| 路径 | 作用 |
|---|---|
| `apps/server` | 后端 API、service、store、ChatGPT/Codex 调用 |
| `apps/web` | React 管理后台 |
| `apps/curl-cffi-worker` | curl_cffi sidecar，处理 ChatGPT/Auth 请求传输 |
| `packages/shared` | 前后端共享类型、session 输入解析 |
| `docs/dev-spec` | 长期有效的架构、接口、数据模型和协议文档 |
| `docs/dev-spec/chatgpt-backend-api` | 已脱敏的 ChatGPT Web backend-api 抓包样本 |

## 核心模型

席位类型只有两个合法值：

| 原始值 | 业务含义 |
|---|---|
| `default` | ChatGPT 固定席位，计入 Team 套餐名额 |
| `usage_based` | Codex/usage-based 席位，不计入固定 ChatGPT 席位 |

账单边界：Team 套餐包含的 ChatGPT 固定席位数量有限。邀请或切换到 `default` 可能增加账单；移除标准 ChatGPT 成员后，原席位仍可能临时计费，当前成员数不等于计费席位数。普通席位修改不增加额外确认，但移除成员会提示风险并记录上游 `billing_notice` / `policy_notice`；最终费用以 Workspace Billing 和账单为准。

数据模型原则：

- 母号成员数、ChatGPT 席位数、pending invite 数不作为独立字段持久化，应从 `membersCache` 和 `pendingInvitesCache` 派生。
- 母号下售出的本地客户席位保存为 `seatSlots`。slot 绑定的是席位位置，不是当前邮箱或远端成员/邀请记录；ChatGPT 与 Codex 席位都可创建 slot。邀请转成员、修改席位类型或换号后，备注、到期时间、价格、换号历史和 `seatKey` 留在同一个 slot。
- 子号的 Codex 凭证按 workspace 维度保存；同一子号在不同 Team 下需要不同凭证。凭证 JSON 独立保存到运行时凭证文件，普通 view 只返回文件名、CPA 号池和额度缓存等脱敏元数据。
- Team 关联里的母号名称、workspace id 等展示信息从当前母号列表派生，不复制到 `teamLinks`。
- 写操作成功后必须更新本地 canonical cache 或返回最新 view，避免 UI 列表、详情和运行时 JSON 断链。

完整说明见 [`docs/core/seat-and-credential-model.md`](./docs/core/seat-and-credential-model.md) 和 [`docs/dev-spec/data-model.md`](./docs/dev-spec/data-model.md)。

## 录入格式

母号和子号的 Web 登录态只支持 chatgpt.com `/api/auth/session` 输出的 session JSON：

```json
{
  "user": {
    "email": "owner@example.com"
  },
  "account": {
    "id": "<workspace account_id>"
  },
  "accessToken": "<JWT>",
  "sessionToken": "<next-auth session token>"
}
```

必需字段是 `user.email`、`account.id` 和 `accessToken`；建议同时包含 `sessionToken`。系统直接保存 `sessionToken`，后续可按目标 workspace 调用 `/api/auth/session` 换取新的 Web access token。数组输入和浏览器导出状态不再支持。

录入或替换母号 session 时，系统不会直接信任输入中的 `account.id`。后端会先调用 `accounts/check`，只把当前 session 可访问且角色为 owner/admin 的 Workspace 保存为母号 `accountId`；如果输入是个人 session 但包含 `sessionToken`，系统会再通过 `/api/auth/session` 换取目标 Workspace 的 Web access token。后续母号 backend-api 请求遇到 `token_invalidated` 时，也会用已保存的 `sessionToken` 换取新 Web access token 并重试一次。

多 workspace GPT 账号只需录入一次带 `sessionToken` 的 session JSON，不需要为每个 workspace 分别录入 session。若当前 ChatGPT session 可见多个可管理 Workspace 且无法从当前/已有 workspace 判断目标，系统会拒绝自动选择，避免把母号绑定到错误空间。

GPT 账号邮箱只写入 `email`；本地备注写入 `remark`。母号 Team 运营字段包括 `groupName`、`limitType`、`nextRenewalOn` 和人工维护的 `isBanned`，子号也使用独立的顶层 `groupName` 与 `isBanned`。母号和子号都可保存 `proxy`，ChatGPT Web 请求、workspace token 换取、子号 PAT 创建和额度刷新会优先使用对应账号的代理；未配置账号代理时才使用运行环境全局代理。本地资料弹窗会回填已保存的分组、封号标记、session JSON 和代理地址。

通过 GPT Account Manager 创建的子号额外保存 `managedAccountEmail`，其值是规范化邮箱账号引用。Team Manager 不保存注册密码、CloakBrowser profile、浏览器追踪或支付状态。系统的 Codex 凭证模型只有 PAT，由当前子号 Web Session 针对目标 workspace 创建。

## 开发命令

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm docs:dev
corepack pnpm --filter @team-manager/shared build
corepack pnpm --filter @team-manager/server test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm docs:build
```

`corepack pnpm dev` 会读取仓库根目录 `.env`。实际部署入口、nginx vhost、tmux/docker 运行状态属于环境事实，不写入公开仓库；本机可用 `.codex/AGENTS.md` 记录。

`corepack pnpm docs:dev` 启动 VitePress 使用手册，`corepack pnpm docs:build` 构建静态文档站点。

## 部署约束

- 源码仓库只保存构建和运行所需的通用代码。
- 部署目录由运行环境维护，放置 `.env`、`docker-compose.yml` 和挂载的 `data/`。
- nginx vhost 和真实入口由部署环境维护，不写入 git 管理文件。
- 主镜像和 curl_cffi worker 镜像由本仓库 Dockerfile 构建；具体镜像标签、部署命令可由部署环境自行约定。

## 文档索引

- [`docs/guide/`](./docs/guide/)：使用手册，面向日常业务操作，说明母号、子号、席位、凭证、额度和排错流程。
- [`docs/guide/fill-credential-pool.md`](./docs/guide/fill-credential-pool.md)：使用新子号加入多个 Team、生成 PAT 凭证并填充 CPA/Codex 号池的 SOP。
- [`docs/core/seat-and-credential-model.md`](./docs/core/seat-and-credential-model.md)：Team、母号、子号、席位类型、Codex 凭证维度和账单红线。涉及这些对象的任务应先读本文件。
- [`docs/dev-spec/data-model.md`](./docs/dev-spec/data-model.md)：母号、子号、缓存、派生字段和本地资料编辑的数据模型规则。
- [`docs/dev-spec/subaccount-management.md`](./docs/dev-spec/subaccount-management.md)：子号池、PAT、额度查询和 Team 关联同步的实现边界。
- [`docs/dev-spec/subaccount-registration-sop.md`](./docs/dev-spec/subaccount-registration-sop.md)：Account Manager 注册操作、Session 交付与幂等规则。
- [`docs/dev-spec/parent-account-registration.md`](./docs/dev-spec/parent-account-registration.md)：母号自动注册、0.52 开通与 Workspace 导入状态机。
- [`docs/guide/team-order-maintenance.md`](./docs/guide/team-order-maintenance.md)：订单维护池、配置继承和手动触发操作说明。
- [`docs/dev-spec/team-order-maintenance.md`](./docs/dev-spec/team-order-maintenance.md)：TeamCode 对接、调度、重试、持久化和 API 约束。
- [`docs/dev-spec/chatgpt-backend-api/README.md`](./docs/dev-spec/chatgpt-backend-api/README.md)：ChatGPT Web backend-api 脱敏样本索引。

## 当前边界

- 全新 GPT 账号注册由独立 GPT Account Manager 执行。Team Manager 只创建账号操作、展示进度、保存邮箱引用和 ChatGPT Web Session。
- CloakBrowser、GongXi-Mail、Mihomo、家宽 SID、Cloudflare/CAPTCHA 重试和浏览器 trace 都属于注册服务，不进入 Team Manager 源码或运行配置。
- 两个项目可独立运行：Team Manager 只凭 Web Session 即可管理母号、子号、Team 和 PAT；Account Manager 只凭账号凭据和 CloakBrowser profile 即可执行注册、同步和支付操作。
- curl_cffi worker 只保留 ChatGPT Web 请求转发，不执行注册或凭证创建。
- 子号凭证能力只保留 PAT 创建、下载、删除和额度刷新。
- 系统不对接外部 credential-status 服务，Codex 额度直接由目标 workspace 对应凭证查询。
