# team-manager

ChatGPT Team 母号与子号管理后台。系统录入 Team 母号和子号的 ChatGPT session，通过 ChatGPT Web backend-api 管理 Team workspace 的成员、邀请、席位类型、默认席位、Team 名称、Codex 子号授权和额度查询。

本项目管理标准 ChatGPT Team workspace，不以 K12（ChatGPT for Teachers）为默认设计目标。两者底层端点接近，但席位类型、账单和风控判断以 Team 为准。

## Agent Quick Start

新 agent 进入仓库后先读：

1. [`AGENTS.md`](./AGENTS.md)：项目协作、git、安全、数据文件操作规则。
2. 本 README：项目定位、架构地图、验证命令和文档索引。
3. [`docs/core/seat-and-credential-model.md`](./docs/core/seat-and-credential-model.md)：母号、子号、Team、席位、Codex 凭证和账单红线的基本规则。
4. `README.local.md`：如果本机存在该文件，读取当前运行实例、nginx 入口、tmux/docker 状态。该文件是本机私有说明，不进入 git。

开始改代码前先执行：

```bash
git status --short --branch
```

常用验证命令：

```bash
corepack pnpm --filter @team-manager/server test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm docs:build
```

## 安全边界

- 源码可以公开；运行时持有的 access token、refresh token、cookie、Codex credential、管理员口令、代理和部署入口不得进入 git。
- 运行时数据放在部署环境挂载的 `data/`，环境变量放 `.env` 或部署系统配置。
- git 管理文件不得写真实域名、IP、端口、账号、token、代理地址或本机部署路径；本机事实记录到 `README.local.md`。
- GongXi-Mail、短信接码、Flaresolverr/curl_cffi worker 连接信息属于运行环境配置；业务代码只检查脱敏可用状态，不在源码或公开文档中保存真实连接参数。
- 后端普通视图接口只返回脱敏 view；只有显式凭证导出接口才返回 Codex credential JSON。
- 不要通过编辑 `data/*.json` 执行业务操作。业务变更走 API、UI 或 service/store 方法。

## 功能范围

- **母号管理**：录入、删除、刷新 Team 母号，查看 workspace 状态与本地缓存。
- **本地资料编辑**：编辑母号或子号本地备注名 `label`，可选择替换 session JSON；不会修改远端 Team 名称。
- **成员管理**：列成员、移除成员、调整单个成员席位。
- **邀请管理**：发送 Team 邀请、列 pending invite、撤销邀请。
- **Team 设置**：读取与修改新成员默认席位类型、允许成员发送 Codex 邀请、允许用户创建个人访问令牌等开关。
- **Team 改名**：调用远端接口修改 ChatGPT workspace 名称。
- **子号池**：录入子号 session 或导入已有 Codex credential，保存子号状态、Team 关联、Codex 凭证状态和授权日志。
- **Codex 授权与额度**：按子号和 Team workspace 生成 Codex 凭证，查询并缓存对应 workspace 的 Codex 额度。
- **子号加入母号**：用子号邮箱邀请加入指定 Team，并同步本地 Team 关系状态。

## 技术栈

- **monorepo**：pnpm workspace。
- **共享类型**：`packages/shared`。
- **后端**：Hono、`@hono/node-server`、TypeScript ESM。
- **前端**：React、Vite。
- **持久化**：文件持久化，无数据库。
- **鉴权**：HS256 JWT、scrypt 口令、可选固定 API token。
- **ChatGPT 调用**：`apps/server/src/chatgptApi.ts` 负责 backend-api 请求口径，`apps/server/src/transport.ts` 负责传输抽象。
- **Cloudflare 传输**：部署默认通过 `apps/curl-cffi-worker` sidecar 访问 ChatGPT Web backend-api。

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
- 子号的 Codex 凭证按 workspace 维度保存；同一子号在不同 Team 下需要不同凭证。
- Team 关联里的母号名称、workspace id 等展示信息从当前母号列表派生，不复制到 `teamLinks`。
- 写操作成功后必须更新本地 canonical cache 或返回最新 view，避免 UI 列表、详情和运行时 JSON 断链。

完整说明见 [`docs/core/seat-and-credential-model.md`](./docs/core/seat-and-credential-model.md) 和 [`docs/dev-spec/data-model.md`](./docs/dev-spec/data-model.md)。

## 录入格式

母号和子号 session 录入只支持 chatgpt.com session JSON，不支持扁平字段或兼容字段：

```json
{
  "user": {
    "email": "owner@example.com"
  },
  "account": {
    "id": "<workspace account_id>"
  },
  "accessToken": "<JWT>"
}
```

备注名 `label` 默认使用邮箱，可通过本地资料编辑单独修改。替换 session 时，旧 session 明文不会回填到前端。

已有 CPA/Codex auth JSON 可以作为 credential-only 子号导入。导入后该子号没有 Web session，但会进入子号池并按 workspace 保存 Codex 凭证；后续可通过 Team 关联同步和额度刷新确认状态。

## 开发命令

```bash
corepack pnpm install
corepack pnpm dev
corepack pnpm docs:dev
corepack pnpm --filter @team-manager/server test
corepack pnpm typecheck
corepack pnpm build
corepack pnpm docs:build
```

`corepack pnpm dev` 会读取仓库根目录 `.env`。实际部署入口、nginx vhost、tmux/docker 运行状态属于环境事实，不写入公开仓库；本机可用 `README.local.md` 记录。

`corepack pnpm docs:dev` 启动 VitePress 使用手册，`corepack pnpm docs:build` 构建静态文档站点。

## 部署约束

- 源码仓库只保存构建和运行所需的通用代码。
- 部署目录由运行环境维护，放置 `.env`、`docker-compose.yml` 和挂载的 `data/`。
- nginx vhost 和真实入口由部署环境维护，不写入 git 管理文件。
- 主镜像和 curl_cffi worker 镜像由本仓库 Dockerfile 构建；具体镜像标签、部署命令可由部署环境自行约定。

## 文档索引

- [`docs/guide/`](./docs/guide/)：使用手册，面向日常业务操作，说明母号、子号、席位、凭证、额度和排错流程。
- [`docs/core/seat-and-credential-model.md`](./docs/core/seat-and-credential-model.md)：Team、母号、子号、席位类型、Codex 凭证维度和账单红线。涉及这些对象的任务应先读本文件。
- [`docs/dev-spec/data-model.md`](./docs/dev-spec/data-model.md)：母号、子号、缓存、派生字段和本地资料编辑的数据模型规则。
- [`docs/dev-spec/subaccount-management.md`](./docs/dev-spec/subaccount-management.md)：子号池、Codex 授权、额度查询、Team 关联同步的实现边界。
- [`docs/dev-spec/subaccount-registration-sop.md`](./docs/dev-spec/subaccount-registration-sop.md)：子号注册与自动授权协议现状。
- [`docs/dev-spec/codex-workspace-credential-experiment.md`](./docs/dev-spec/codex-workspace-credential-experiment.md)：Codex 凭证绑定 workspace 的实验结论。
- [`docs/dev-spec/codex-auth-direct-http-capture.md`](./docs/dev-spec/codex-auth-direct-http-capture.md)：Codex OAuth 直接 HTTP 抓包记录。
- [`docs/dev-spec/chatgpt-backend-api/README.md`](./docs/dev-spec/chatgpt-backend-api/README.md)：ChatGPT Web backend-api 脱敏样本索引。

## 当前边界

- 自动 Codex 授权支持已录入子号或可由运行环境能力完成验证的账号；页面会只读展示 worker、GongXi-Mail、自动注册、短信 OTP、可用/用尽号码数量和授权页面 clearance 是否可用。
- 全新 OpenAI 子号注册可通过 curl_cffi worker 申请 GongXi-Mail 邮箱、生成随机密码、执行 signup/register、邮箱 OTP、手机号验证和 Codex 授权。若分配到已存在或被占用邮箱，worker 会重新取邮箱重试；邮箱 OTP 错误时会重新取候选码重试。生成密码只保存在后端运行时数据，不下发前端；已落库账号后续重试自动授权时会复用该私有密码。
- 短信 OTP 能力由 curl_cffi worker 使用运行环境 YAML 手机号池完成。worker 可自动处理首次手机号绑定、已绑定手机号短信二次验证、验证码错误后的候选码重试、号码达到绑定上限后的用尽标记和后续跳过；真实手机号、短信 inbox URL 和 YAML 文件不进入 git。
- 遇到 auth.openai.com 人机校验时，worker 会先尝试使用运行环境 FlareSolverr 继续流程；账号锁定会标记为独立的 `account_locked` 子号状态。注册阶段 sentinel 稳定通过、无法自动继续的人机校验、账号锁定恢复和短信接码渠道 UI 管理仍是后续候选能力，这些分支会进入明确状态并保留脱敏日志。
- 系统不对接外部 credential-status 服务，Codex 额度直接由目标 workspace 对应凭证查询。
