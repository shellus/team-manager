# team-manager

ChatGPT **Team 母号管理后台**。录入 Team 母号的 session，通过 ChatGPT 官方网页后端 API（`chatgpt.com/backend-api`）集中管理多个 Team 母号的成员：状态查看、邀请、踢人、改席位类型、改默认新成员席位类型。

> **范围说明**：本项目管理的是标准 **ChatGPT Team** workspace，**不是 K12（ChatGPT for Teachers）**。两者底层都是多席位 workspace、backend-api 端点路径一致（`/backend-api/accounts/{account_id}/...`），因此本工具对 K12 workspace 大概率同样适用，但**设计目标与默认假设以 Team 为准**（席位类型、计费、风控行为按 Team 处理）。

> **安全边界**：源码可以公开；运行时持有的 access_token / refresh_token / cookie 等高敏凭证必须只存本机或部署环境挂载的 `data/`，**绝不入 git**。

## 背景

Team workspace 渠道（含 48 月半价 Team、bug Team、子号席位套利等）长期活跃，核心玩法是"母号管理"——母号邀请子号、踢人、调席位类型做席位运营。现有的 `openai-auth-interceptor-v3-integrated` 只能跑"邀请→拦 token→踢人"单条流水，缺一个面向**多 Team 母号的统一管理后台**。本项目补这个空缺，不依赖浏览器扩展，纯后端调官方网页 API。

## 功能

- **多母号管理**：母号列表 + 状态显示（plan_type / 角色 / 席位用量）
- **邀请**：向指定邮箱发 Team 邀请
- **待处理邀请**：查看 pending invite，撤销未接受的邀请
- **踢人**：从 workspace 移除成员
- **改子号席位类型**：调整单个成员的 seat_type
- **改默认席位类型**：修改 workspace 新加入成员的默认席位类型
- **子号池**：录入子号 session JSON，按 Team workspace 生成 Codex 凭证 JSON，直接查询对应 workspace 的 Codex 凭证额度
- **子号加入母号**：把指定子号邀请到指定母号，并在本地记录每个 Team workspace 的席位关系

## 技术栈

对齐本环境 `newchat` 的工程约定：

- **monorepo**：pnpm workspace（`apps/server` + `apps/web` + `packages/shared`）
- **后端**：Hono + `@hono/node-server`（TypeScript / ESM），生产用 `serveStatic` 同进程出前端
- **前端**：React + Vite + Radix UI 管理后台
- **持久化**：文件持久化（无 DB），母号 session、子号 session、Codex 凭证与验证日志均存运行时 `data/`
- **鉴权**：手写 HS256 JWT + scrypt 口令（复用 newchat `auth/`）
- **核心调用**：`apps/server/src/chatgptApi.ts` —— 组装 backend-api 请求头直连，配 token 自动刷新与 Cloudflare 兜底策略
- **部署**：多阶段 Dockerfile（`node:22-bookworm-slim`），运行入口由部署目录 `.env` 与 nginx vhost 管理

### 调用方式（双通道）

1. **生产直连**：录入的 session JSON → 组装请求头（`Authorization: Bearer` + `chatgpt-account-id` + `oai-device-id/session-id` + `x-openai-target-path/route`）→ 打 `chatgpt.com/backend-api`。
2. **历史调试通道**：阶段一用 `remote-browser` 的已登录 chatgpt.com 上下文摸接口结构；运行时不依赖 Playwright。

## backend-api 端点（阶段一已实地摸清，2026-06-17）

用真实 Team workspace 的 playwright 登录态实测确认（2026-06-17 阶段一~四联调）。

**两条硬约束（实测）**：
1. **所有 backend-api 请求必须带 `Authorization: Bearer <access_token>`**——纯 cookie 一律 `401 Unauthorized`。workspace 操作还需带 `chatgpt-account-id: <account_id>`。
2. **Node 直连过不了 Cloudflare**：本机直连 chatgpt.com 被墙（超时），经普通代理通但会被 CF `403`（TLS 指纹）。当前生产传输走 **curl_cffi sidecar**（见下「传输架构」），认证仍用录入的 Bearer token。

| 操作 | 方法 / 路径 | 关键字段 | 状态 |
|---|---|---|---|
| 母号状态 | `GET /backend-api/accounts/check/v4-2023-04-27?timezone_offset_min=-480` | 返回所有 account 字典；workspace 那条 `account.structure="workspace"`、`plan_type="self_serve_business_usage_based"`、`account_id`、`account_user_role` | ✅ 实证 |
| 列成员 | `GET /backend-api/accounts/{account_id}/users?offset=0&limit=25` | `{total, items:[{id, email, name, role, seat_type, credit_limits, ...}]}`，分页 ≤25 | ✅ 实证 |
| 改成员席位 | `PATCH /backend-api/accounts/{account_id}/users/{user_id}` | body `{"seat_type":"default"}` 或 `{"seat_type":"usage_based"}`，随后刷新成员列表确认 `seat_type` | ✅ 升降实证生效 |
| 邀请 | `POST /backend-api/accounts/{account_id}/invites` | body `{email_addresses, role:"standard-user", seat_type, resend_emails:true}` | ✅ Codex 席位实发 |
| 待处理邀请 | `GET /backend-api/accounts/{account_id}/invites?offset=0&limit=25&query=` | 返回 `{items,total,limit,offset}`，`items[].seat_type/status/email_address` | ✅ 实证 |
| 撤销邀请 | `DELETE /backend-api/accounts/{account_id}/invites` | body `{email_address}` | ✅ 实证 |
| 踢人 | `DELETE /backend-api/accounts/{account_id}/users/{user_id}` | body 为空；删除后刷新 users/invites/accounts/check | ✅ 实操 |
| 改 Team 名称 | `PATCH /backend-api/accounts/{account_id}` | body 至少 `{name}`；网页请求还会带当前头像 `profile_picture_id/profile_picture_url` | ✅ 抓包确认 |
| 改默认席位 | `POST /backend-api/accounts/{account_id}/settings/default_seat_type` | body `{value:"default"}` 或 `{value:"usage_based"}`；`GET .../settings` 读取 **`default_seat_type`** | ✅ 实证 |

### 关键字段与口径（实测，含纠错）

- **席位字段名是 `seat_type`（不是 `seat`！）**：列成员返回 `users[].seat_type`，改席位 PATCH body 也是 `seat_type`。调用前必须先读成员确认当前席位与目标席位，避免重复切换或意外增加账单。
- **取值**：`default` = **ChatGPT 席位**（固定席位、付费）；`usage_based` = **Codex 席位**（owner 默认此类，不占 ChatGPT 固定席位）。
- **`seat_type` body 升降均生效**：`usage_based` 与 `default` 已通过网页请求实证可往返切换；升为 `default` 前必须做账单风险确认。
- **account_id 来源**：`accounts/check` 的 workspace 条目，或页面 localStorage `_account`。
- 只读旁证端点：`/settings`、`/workspace_policy`、`/remaining_balance`、`/accounts/optimized/check`。

### 账单风险确认

当前套餐包含 2 个 ChatGPT 固定席位。母号 owner 通常是 `usage_based`，不占 ChatGPT 固定席位。team-manager 在 service 层内置账单风险确认：邀请/改席位为 `default` 前先统计当前 default 数，达到套餐包含数量时先返回 HTTP 409 和确认文案；调用方带 `confirmBillingRisk:true` 后才继续执行，避免自动化流程无感增加账单。

### 传输架构（过 Cloudflare）

`apps/server/src/transport.ts` 抽象 `Transport`：
- **CurlCffiTransport（默认部署）**：Node 后端通过 `TEAMMGR_CURL_CFFI_URL` 调用 `apps/curl-cffi-worker` sidecar。sidecar 使用 `curl_cffi` 的浏览器 TLS impersonation，按 `TEAMMGR_CHATGPT_PROXY` 走代理访问 `chatgpt.com/backend-api`，支持 GET / POST / PATCH / DELETE 和自定义 headers。
- **DirectTransport（本地兜底）**：未配置 `TEAMMGR_CURL_CFFI_URL` 时用 Node 原生 fetch 直连。当前网络环境下直连和普通 HTTP 代理会被 Cloudflare challenge 拦截，不作为生产主路径。

已排除 Playwright 和 FlareSolverr 作为 ChatGPT backend-api 主链路：自建 Playwright 仍需要人工过 CF；FlareSolverr 官方只支持 `request.get` / `request.post`，且不能完整透传 ChatGPT backend-api 所需的 PATCH / DELETE / JSON body / 自定义 headers。Codex 自动授权只把 FlareSolverr 用作 auth.openai.com 初始 Cloudflare clearance，后续状态机由 curl_cffi worker 直接请求。

token 刷新：`POST https://auth.openai.com/oauth/token`，`grant_type=refresh_token` + `client_id=app_2SKx67EdpoN0G6j64rFvigXD`。

## 子号管理

> **必读核心概念**：Team 母号 / 子号 / 席位类型 / 凭证维度的规则与操作法则，见 [`docs/dev-spec/seat-and-credential-model.md`](docs/dev-spec/seat-and-credential-model.md)（含账单红线、"改席位即复活凭证"等实证结论）。子号从空邮箱注册到加入 Team 的全链路现状、SOP 与 sentinel 卡点，见 [`docs/dev-spec/subaccount-registration-sop.md`](docs/dev-spec/subaccount-registration-sop.md)。

子号管理不使用 Playwright 作为主链路。当前支持五类入口：

1. **录入子号 session JSON**：只接受 `user.email`、`account.id`、`accessToken` 这一种格式。
2. **Codex 自动授权**：后端把 OAuth + PKCE 会话交给 curl_cffi worker，worker 通过 auth.openai.com passwordless email OTP 流程、GongXi-Mail 取码、按目标 workspace consent、OAuth callback 和 token exchange 自动生成 CPA/Codex 兼容 JSON。
3. **Codex 手动授权兜底**：后端按目标 Team 生成登录 URL，用户也可以自行授权后把 `http://localhost:1455/auth/callback?...` 粘贴回系统换 token；若 callback 生成的 `chatgpt_account_id` 和目标 Team 不一致，后端拒绝保存。
4. **Team 关联管理**：页面先显示本地缓存的子号 Team 关系；点击关联区的“刷新”后，系统按子号邮箱逐个查询已录入母号的成员列表和待处理邀请，写回 `member` / `invited` / `removed` / `unknown` 状态。
5. **加入母号**：后端保留选择母号与席位类型的邀请接口；前端不在子号详情里常驻展示该表单，避免把子号凭证管理和母号成员操作混在一起。

Codex 凭证是子号 + workspace 维度，不是单纯邮箱账号维度。实测同一 Codex access token 即使更换 `Chatgpt-Account-Id` 请求头，`GET /backend-api/wham/usage` 仍返回 token 绑定的 `account_id`，不能切换到另一个 Team。系统因此在 `codexCredentials[]` 中按 `chatgptAccountId` 保存多份凭证。实验记录见 `docs/dev-spec/codex-workspace-credential-experiment.md`。

凭证额度查询直接参考 CPA 的做法：使用目标 Team 对应的子号 Codex 凭证里的 `access_token` 和 `account_id` 请求 `GET /backend-api/wham/usage`，带 `Chatgpt-Account-Id` 账户上下文，解析 `rate_limit` 窗口，并把结果缓存到该 workspace 凭证记录；不对接外部 credential-status 服务。

Codex 自动授权当前已实测 passwordless email OTP 分支。若 auth.openai.com 返回 `add_phone`、`phone_otp_verification` 或其他验证页，系统会把子号标记为 `verification_required` 并记录 worker 返回的脱敏阶段日志，便于后续补齐首次绑手机和二次手机验证。系统仍不对接外部 credential-status；OpenAI 全新注册子号仍是后续候选。

## 录入格式

前端录入只支持 chatgpt.com session JSON，不支持扁平字段或兼容字段。备注名与 owner 邮箱均只取 `user.email`，workspace account_id 只取 `account.id`，Bearer token 只取 `accessToken`。

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

## 目录布局

- 源码仓库：本仓库（构建镜像 `team-manager:local`）
- 部署目录：由部署环境自行维护，放置 `.env`、`docker-compose.yml` 与运行时 `data/` 挂载卷
- 反代入口：由部署环境自行维护，不写入仓库

## 进度规划

### 阶段一：摸接口（前置，阻塞后续）

- [x] 用真实 Team workspace 的 playwright 登录态，实测确认：母号状态、列成员、改子号席位、邀请、撤销邀请、移除成员；定位 `settings.default_seat_type`（2026-06-17）
- [x] 把确认的请求结构、字段口径、账单风险确认、传输架构回填本 README 端点表
- [x] 纠错：席位字段是 `seat_type` 非 `seat`；成员席位升降都使用 `seat_type` body

### 阶段二：脚手架

- [x] 建 pnpm monorepo（apps/server + apps/web + packages/shared）
- [x] 复用 newchat 的 jwt / password；config / 部署模板用 `TEAMMGR_*` 前缀
- [x] 跑通空壳 + 登录门禁 + `/health`（curl 全绿）

### 阶段三：client + 只读功能

- [x] 写 `chatgptApi.ts`（请求头组装 + token 刷新）+ `transport.ts`（curl_cffi sidecar 过 CF）
- [x] 母号录入 / 删除
- [x] 母号状态显示（聚合 accounts/check，实测真实母号 active）
- [x] 列成员（实测 3 成员，席位区分正确）

### 阶段四：写操作

- [x] 改子号席位类型（网页 `seat_type` PATCH 升降实测生效；service 层要求显式确认可能增加账单的 ChatGPT 席位操作）
- [x] 前端成员表格 + 操作列（席位下拉 / 踢出 / 邀请 / 待处理邀请 / 撤销邀请 / 默认席位修改）
- [x] 邀请 / 待处理邀请 / 撤销邀请 / 踢人（已对真实号实操，原始接口样本已脱敏保存）
- [x] 改默认席位（`POST /settings/default_seat_type` 实测生效，原始接口样本已脱敏保存）

### 阶段五：部署

- [x] 建部署目录 + nginx vhost（部署路径由环境变量和本机配置维护，不写入仓库）
- [x] 国内源构建镜像 `team-manager:local`，容器 healthy
- [x] 部署入口的 /health、首页、登录、鉴权拦截全部验证通过（2026-06-17）

### 阶段六：子号池与验证日志

- [x] 建立子号池：记录子号邮箱、web session、Codex 凭证状态与验证日志
- [x] 支持子号 session JSON 录入：只取 `user.email`、`account.id`、`accessToken`
- [x] 支持 Codex Auth 登录 URL + callback URL 回填，按目标 Team workspace 生成 CPA/Codex 兼容凭证 JSON
- [x] 支持 Codex Auth 自动授权：curl_cffi worker 直接跑 auth.openai.com OAuth + passwordless email OTP + 目标 workspace consent + token exchange
- [x] 支持直接查询并缓存子号 Codex 凭证额度：`GET /backend-api/wham/usage`，缓存维度为子号 + Team workspace
- [x] 支持把指定子号加入指定母号，并手动同步子号在各母号里的成员/邀请状态，避免把同一子号在不同 Team workspace 的额度混为一谈

### 后续候选：子号自动注册与验证协议

当前尚未把 GongXi-Mail 新邮箱申请、OpenAI 全新账号注册、手机号接码、二次手机验证做成完整注册执行器。若后续要做，需要继续留存 OpenAI 注册起始、手机号输入、短信验证码、二次验证、验证码错误、人机校验和账号锁定等脱敏原始接口样本，再实现请求协议执行器。

## 部署运维

- **源码仓库**：改源码后构建主镜像与 curl_cffi worker：`docker build -t team-manager:local .`，`docker build -t team-manager-curl-cffi-worker:local apps/curl-cffi-worker`。
- **部署目录**：由部署环境自行维护；`docker-compose.yml` 引用 `team-manager:local` + `team-manager-curl-cffi-worker:local`，挂载 `./data`，env 在 `.env`。更新命令在部署目录执行：`docker-compose up -d`。
- **nginx**：vhost 由部署环境管理，反代入口与端口不写入仓库；改后在 nginx compose 目录执行 reload。
- **入口**：由部署环境的 nginx vhost 决定；管理员口令见部署 `.env` 的 `TEAMMGR_ADMIN_PASSWORD`。
- **传输**：默认走 curl_cffi sidecar 过 CF，依赖 `.env` 的 `TEAMMGR_CURL_CFFI_URL` / `TEAMMGR_CHATGPT_PROXY`。
- **Codex 自动授权配置**：worker 需配置 `TEAMMGR_FLARESOLVERR_URL`、`TEAMMGR_GONGXI_MAIL_BASE_URL`、`TEAMMGR_GONGXI_MAIL_API_KEY`；`TEAMMGR_AUTH_PROXY` 可单独覆盖 auth.openai.com 代理，否则沿用 `TEAMMGR_CHATGPT_PROXY`。

## 安全

- 母号 session / token / cookie 仅存 `data/` 挂载卷，绝不入 git（见 `.gitignore`）
- JWT secret 走环境变量 `TEAMMGR_JWT_SECRET`，不入仓
- 后端响应绝不回传母号的 bearer / cookie
