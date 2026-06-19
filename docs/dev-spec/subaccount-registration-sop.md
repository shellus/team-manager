# 子号注册与授权 SOP（现状与操作手册）

记录"从空邮箱 → 注册 OpenAI 子号 → 加入 Team → 生成可用 codex 凭证"全链路的实测现状、操作步骤与已知卡点。配合 [`seat-and-credential-model.md`](./seat-and-credential-model.md) 使用。基线日期 2026-06-19。

## 一、关键事实（实测，2026-06-19）

1. **OpenAI 已禁用验证码注册。** 新邮箱走 passwordless 注册时，`/api/accounts/passwordless/send-otp` 返回 `passwordless_signup_disabled`：*"Passwordless signup is unavailable. Please continue with a password instead."* —— **新号注册必须设密码**，无法纯 OTP。（历史上可纯验证码注册，OpenAI 后改了策略。）

2. **注册 = 登录的统一入口是 `screen_hint`。** 合法值：`login` / `signup` / `login_or_signup`。worker 旧代码写死 `login`，会把全新邮箱也推到密码登录页导致失败。全新号应使用 `signup`（或 `login_or_signup`）。

3. **真实注册请求序列**（浏览器抓包，全部 HTTP 200 验证）：
   1. `POST /api/accounts/authorize/continue`　body `{"username":{"value":<email>,"kind":"email"},"screen_hint":"signup"}` → 返回 `page.type=create_account_password`
   2. `POST /api/accounts/user/register`　body `{"password":<pwd>,"username":<email>}` → 返回 `page.type=email_otp_send`
   3. `GET /api/accounts/email-otp/send` → 触发验证码邮件
   4. `POST /api/accounts/email-otp/validate`　body `{"code":<6位>}`
   5. 若 `add_phone` → 绑手机（接码池）；若 `phone_otp_verification` → 二次验证
   6. `sign_in_with_chatgpt_codex_consent` → `workspace/select` → callback → token exchange

   > `user/register` 的 body **只需 `password` + `username`**，不需要 name/birthdate（`/api/accounts/create_account` 是另一个端点，需 name+birthdate 且不接受 password，非本流程使用）。

4. **密码策略：每号随机生成强密码并记录。** 注册既然强制设密码，密码须落库（连同 email / account_id 记入台账，如 ai-accounts 项目），以便后续手动登录。

5. **邮箱与接码号不是消耗品。** 邮箱可重复用、账号能用即可；一个账号绑一个手机号、该号在此账号上可无限次接码。不存在"浪费邮箱/接码"的约束。

6. **邮箱来源与质量。** GongXi-Mail `/api/get-email?group=<分组>` 分配。池内邮箱带状态分组，注册前选**干净分组**（如"确认好的outlook"）。注意"已封号""需要人机的outlook""二验废号"等分组不可用于注册。

## 二、加入 Team 的顺序

**先邀请进 Team，再注册授权。** 母号 invite 只认邮箱、不要求账号已存在，可先把空邮箱占位为成员；之后该号注册并走 codex consent 时即可选到目标 Team workspace。

- 邀请：`POST /backend-api/accounts/{account_id}/invites`　body `{"email_addresses":[<email>],"role":"standard-user","seat_type":"usage_based","resend_emails":true}`（用对应 Team owner 的 access_token，经 curl_cffi worker `/fetch`）。
- 注册授权完成后，按需把该成员席位从 `usage_based` 切 `default` 取额度（受每 Team 2 个 default 红线约束，见总纲）。

> **子号无需"接受"邀请。** 母号 invite 后该邀请在后端处于 pending（`status=2`）即可，子号此刻已是该 Team 的关联成员；邀请邮件里的 "Accept" 仅是 UI 引导，**不是成为成员或授权的前置条件**。子号直接走 OAuth 授权，worker 在 `sign_in_with_chatgpt_codex_consent` 阶段会把目标 Team 列入授权 session 的 `workspaces`，`select_codex_workspace(workspaces, targetChatgptAccountId)`（`worker.py`）即可选中它，token exchange 产出的凭证 `account_id` 就绑定该 Team。
>
> （2026-06-19 实测：某子号在目标 Team 的邀请**全程 pending、从未点 Accept**，直接授权选中该 Team → `oauth_token_exchange 200`，凭证 `account_id` 绑定目标 Team、`plan_type=team`、`wham/usage` 200 有额度窗口。因此搬号/加号流程里没有"等子号确认邀请"这一步——发出 invite 后即可直接对该号触发授权。真实邮箱与 workspace id 属于运行时运营数据，不写入仓库。）

> **踩坑（同次实测）**：`POST /invites` 偶发返回 `errored_emails: "Unable to invite user due to an error."`，与子号无关——同一邮箱换一个有空位的 Team invite 即成功（疑似个别 Team workspace 侧的限制/异常）。换 Team 重试即可，不要误判成号坏了。撤销 pending 邀请用 `DELETE /backend-api/accounts/{account_id}/invites`　body `{"email_address":<email>}`（不是 `DELETE …/invites/{id}`，后者 405）。

## 三、当前实现状态与卡点

- **worker 现状**：`run_codex_auto_auth`（`apps/curl-cffi-worker/worker.py`）的状态机由 OpenAI 返回的 `page_type` 驱动，**注册/登录通吃**——email OTP 取码、add_phone 绑机、二次验证、consent、token exchange 均已实现。
- **缺口**：worker 没有 `create_account_password` → `user/register` 这一步（旧代码 `screen_hint` 写死 `login`，且无 register 调用）。
- **核心卡点（未解决）**：在 worker/脚本中复刻 `user/register` 时返回 `account_creation_failed`（HTTP 400）。根因是 **sentinel pow token**——注册接口的人机校验比登录严，worker 现有 `build_sentinel_token` 对该步算出的 token 不被 OpenAI 接受；浏览器能成功是因为跑了真实 sentinel SDK。**改 worker 加注册分支时必须解决注册步 sentinel。**
- **已修复（2026-06-19）：登录态新增 `phone_otp_select_channel` 分支。** 已绑手机的老号重授权（`screen_hint=login` + 密码）走完 email OTP 后，OpenAI 可能落到 `phone_otp_select_channel` 页（`multi_channel_allowed=true`，要求先选验证渠道再发码），worker 旧状态机未处理、直接 `unexpected_page` 失败。修复：检测到该页时 `POST /api/accounts/phone-otp/send` body `{"channel":"sms"}` 触发 SMS 发码，进入 `phone_otp_verification` 后复用既有 `complete_existing_phone_verification`（号池匹配绑定手机 → 取码 → `phone-otp/validate`）。代码位于 `run_codex_auto_auth` 状态机内 add_phone/phone_otp_verification 分支之后。
  - **重授权（rt 失效复活）操作要点**：① refresh_token 一次性轮换，**任何外部 refresh 都会让磁盘上的 rt 作废**——验证有效性后必须把返回的新 rt 写回，否则下次 cpa 用旧 rt 必报 `refresh_token_invalidated`。② 正确做法是重授权落盘后**不做外部 refresh**，由 cpa 实例独占 15min 周期 refresh；cpa 监听 `auth-dir` 文件变更会自动热加载（日志 `auth file changed ... processing incrementally`），随后 `auth unavailable` 消失即恢复。③ 老号重授权需台账密码 + 绑定手机在接码池，consent 选目标 Team workspace（传 `targetChatgptAccountId`）。④ 同一号短时间反复试 email OTP 会触发 `max_check_attempts` 限流，需冷却数分钟。

## 四、待办

- [ ] worker 增加 signup 注册分支：`screen_hint=signup` → `create_account_password` → `user/register`（含正确 sentinel）→ 复用现有 OTP/绑机/consent 链路。
- [ ] 解决 `user/register` 的 sentinel pow token（对照浏览器真实 sentinel 生成）。
- [ ] 服务端增加"从空邮箱注册子号"入口（现有 `codex-auth/auto` 前置 `requireSubaccount`，只能对已入池子号操作）。
- [ ] 注册成功后密码落库台账。
