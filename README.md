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
- GPT Account Registrar 和 curl_cffi worker 连接信息属于运行环境配置；源码不保存真实连接参数。
- 管理后台普通 view 可返回账号本地保存的 Web session JSON 和代理地址，供本地资料编辑回填；只有显式凭证导出接口才返回 Codex credential JSON。
- 不要通过编辑 `data/*.json` 执行业务操作。业务变更走 API、UI 或 service/store 方法。

## 功能范围

- **母号管理**：录入、删除、刷新 Team 母号，查看 workspace 状态与本地缓存。
- **本地资料编辑**：GPT 账号名称统一使用 `email`，本地备注统一写入 `remark`。母号和子号都可按各自顶层 `groupName` 分组；母号另用 `limitType` 记录本地限额类型，并用 `nextRenewalOn` 记录 Team 下次续费日期。母号和子号都可配置独立代理地址并替换 chatgpt.com session JSON；不会修改远端 Team 名称。子号顶层分组与 `codexCredentials[].groupName` 的 CPA 凭证号池分组彼此独立。
- **成员管理**：列成员、移除成员、调整单个成员席位。
- **邀请管理**：发送 Team 邀请、列 pending invite、撤销邀请。
- **席位位置**：用 `seatSlots` 记录母号下售出的 ChatGPT 固定席位位置，`seatKey` 可打开免登录页面查看备注、到期时间、价格、当前邮箱、换号历史并自助换号。
- **Team 设置**：读取与修改新成员默认席位类型、允许成员发送 Codex 邀请、允许用户创建个人访问令牌等开关。
- **Team 改名**：调用远端接口修改 ChatGPT workspace 名称。
- **子号池**：录入子号 session，或通过独立 GPT Account Registrar 自动注册并接收账号交付。
- **PAT 与额度**：按子号和 Team workspace 创建 PAT，查询并缓存对应 workspace 的 Codex 额度。
- **子号加入母号**：用子号邮箱邀请加入指定 Team，并同步本地 Team 关系状态。

## 技术栈

- **monorepo**：pnpm workspace。
- **共享类型**：`packages/shared`。
- **后端**：Hono、`@hono/node-server`、TypeScript ESM。
- **前端**：React、Vite。
- **持久化**：文件持久化，无数据库。
- **鉴权**：HS256 JWT、scrypt 口令、可选固定 API token。
- **ChatGPT 调用**：`apps/server/src/chatgptApi.ts` 负责 backend-api 请求口径，`apps/server/src/transport.ts` 负责传输抽象。
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

账单红线：Team 套餐包含的 ChatGPT 固定席位数量有限。邀请或切换到 `default` 可能增加账单，service 层会返回 HTTP 409，调用方必须显式传 `confirmBillingRisk:true` 后才继续。

数据模型原则：

- 母号成员数、ChatGPT 席位数、pending invite 数不作为独立字段持久化，应从 `membersCache` 和 `pendingInvitesCache` 派生。
- 母号下售出的 ChatGPT 固定席位保存为 `seatSlots`。slot 绑定的是席位位置，不是当前邮箱；换号后备注、到期时间、价格、换号历史和 `seatKey` 留在同一个 slot。`usage_based` / Codex 席位不创建 slot。
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

录入或替换母号 session 时，系统不会直接信任输入中的 `account.id`。后端会先调用 `accounts/check`，只把当前 session 可访问且角色为 owner/admin 的 Team workspace 保存为母号 `accountId`；如果输入是个人 session 但包含 `sessionToken`，系统会再通过 `/api/auth/session` 换取目标 Team workspace 的 Web access token。后续母号 backend-api 请求遇到 `token_invalidated` 时，也会用已保存的 `sessionToken` 换取新 Web access token 并重试一次。

多 workspace GPT 账号只需录入一次带 `sessionToken` 的 session JSON，不需要为每个 workspace 分别录入 session。若当前 ChatGPT session 可见多个可管理 Team workspace 且无法从当前/已有 workspace 判断目标，系统会拒绝自动选择，避免把母号绑定到错误 Team。

GPT 账号邮箱只写入 `email`；本地备注写入 `remark`。母号 Team 运营字段包括 `groupName`、`limitType` 和 `nextRenewalOn`，子号也使用独立的顶层 `groupName` 进行本地分组。母号和子号都可保存 `proxy`，ChatGPT Web 请求、workspace token 换取、子号 PAT 创建和额度刷新会优先使用对应账号的代理；未配置账号代理时才使用运行环境全局代理。本地资料弹窗会回填已保存的分组、session JSON 和代理地址。

系统的 Codex 凭证模型只有 PAT，由当前子号 Web Session 针对目标 workspace 创建。

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
- [`docs/dev-spec/subaccount-registration-sop.md`](./docs/dev-spec/subaccount-registration-sop.md)：独立注册服务的任务、交付与幂等规则。
- [`docs/dev-spec/chatgpt-backend-api/README.md`](./docs/dev-spec/chatgpt-backend-api/README.md)：ChatGPT Web backend-api 脱敏样本索引。

## 当前边界

- 全新 GPT 账号注册由独立 GPT Account Registrar 执行。Team Manager 只创建任务、展示进度并录入邮箱、密码和 ChatGPT Web Session。
- CloakBrowser、GongXi-Mail、Mihomo、家宽 SID、Cloudflare/CAPTCHA 重试和浏览器 trace 都属于注册服务，不进入 Team Manager 源码或运行配置。
- curl_cffi worker 只保留 ChatGPT Web 请求转发，不执行注册或凭证创建。
- 子号凭证能力只保留 PAT 创建、下载、删除和额度刷新。
- 系统不对接外部 credential-status 服务，Codex 额度直接由目标 workspace 对应凭证查询。
