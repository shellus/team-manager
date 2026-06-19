# 席位与凭证模型（核心概念总纲）

本文件锁定 OpenAI Team 子号运营中最容易反复误解的三层概念：**Team 母号 / 子号 / 席位类型 / 凭证维度**。所有结论均经实测验证（2026-06-19，对真实 Team workspace 操作确认）。后续任何关于"凭证用不了""加号""切席位"的讨论，以本文件为准，避免重复踩坑。

## 一、三个层级的对象

1. **Team 母号（owner）**
   一个 OpenAI Team workspace 的拥有者账号。每个 Team 是独立 workspace，有自己的 `account_id`（即 `chatgpt_account_id`）。母号在该 Team 里角色为 `account-owner`。

2. **子号（member）**
   被邀请加入某 Team 的普通成员（`standard-user`）。子号通过邮箱被 invite 进 Team 后，在该 Team 下获得一个 `user_id`。

3. **席位类型（seat_type）**
   每个成员（含母号自己）在 Team 里占一个席位。席位有两种类型，**可随时双向切换**（`PATCH /backend-api/accounts/{account_id}/users/{user_id}` body `{"seat_type": "default"|"usage_based"}`）：
   - `default` = **ChatGPT 席位**：占套餐内固定付费名额，**有 Team 月度额度池**。
   - `usage_based` = **Codex 席位**：不占固定名额，母号 owner 默认即此类，**没有额度池**。

   > 字段名是 `seat_type`，不是 `seat`（`seat` 只是本项目内部模型字段名）。

## 二、账单红线

- 每个 Team 套餐含 **2 个 `default`（ChatGPT）固定席位**。
- **单个 Team 的 `default` 席位数超过 2 → 产生额外账单。这是绝对红线。**
- `usage_based` 席位不占这 2 个名额，数量不限、不额外计费。
- 代码层面：`MAX_CHATGPT_SEATS = 2`（`packages/shared/src/index.ts`）；升 `default` 前 service 层强制账单风险确认（升到第 3 个 default 时返回 HTTP 409，需 `confirmBillingRisk:true`）。

## 三、凭证（codex auth JSON）是什么维度

- 凭证是**衍生物**，维度 = **「子号 × 它授权时绑定的那个 Team workspace」**，两者绑死。
- 同一子号的 codex token，即使改 `Chatgpt-Account-Id` 请求头，也只认它原本绑定的 Team，**不能切到别的 Team**（实测：`wham/usage` 始终返回 token 绑定的 account_id）。因此 `codexCredentials[]` 按 `chatgptAccountId` 保存多份。
- **凭证能不能用，取决于该子号此刻在那个 Team 里的席位类型：**

  | 子号在 Team 的席位 | 凭证 `plan_type` | `wham/usage` | API 调用 |
  |---|---|---|---|
  | `default`（ChatGPT） | `team` | 有 `rate_limit` 月度窗口 | ✅ 可用 |
  | `usage_based`（Codex） | `self_serve_business_usage_based` | `rate_limit: null` | ❌ `usage_limit_reached` |

## 四、由此推出的操作法则

1. **凭证"用不了"≠ 凭证坏了。** 先查该子号在 Team 里的席位类型，而不是删凭证、重新生成。token 有效时（`wham/usage` 返回 200），问题几乎都是席位类型。

2. **改对席位类型，同一个凭证立刻复活——无需删除、无需重新生成、无需重启 cpa。** 凭证文件里的 token 没变，变的只是上游该号的席位属性。（2026-06-19 实证：4 个 `usage_based` 号 PATCH 成 `default` 后，`plan_type` 即从 `self_serve_business_usage_based` 变 `team`、额度窗口恢复，cpa 直连 `/v1/responses` 立即正常。）

3. **绝不"移除成员再重排"来解决席位问题。** 移除成员 = 踢出 workspace = 该 Team 下的凭证作废、要重新走 OAuth 授权。这是把活号弄死，不是修复。

4. **席位类型可逆切换 = 多个号轮换共用 2 个 ChatGPT 席位。** 一个 Team 塞了 N(>2) 个子号时，任意时刻只能让 2 个占 `default` 用额度；额度用完后把它们切回 `usage_based`、把另外的号切成 `default`，即可在零账单下轮换复活，凭证全程不动。

5. **跨 Team 不能靠"改字段/改请求头"救号，但可以靠"重新授权"搬迁。** 区分两件事：
   - ❌ **改字段搬不动**：凭证 token 绑死它授权时的 Team，改 `Chatgpt-Account-Id` 请求头或改凭证文件里的 `account_id` 都没用，`wham/usage` 仍只认原 Team。
   - ✅ **重新授权可搬迁**：把子号从原 Team 退出 → 让目标 Team 母号邀请它 → 该子号在目标 Team 重新走一遍 OAuth 授权 → 生成一份**绑定新 Team** 的全新凭证。原凭证作废，这是预期内的（见下方「六、把多余号搬到有空位的 Team（实操 SOP）」）。

6. **邀请不需要子号"接受"。** invite 即把邮箱写进 Team 成员列表，子号此刻已是该 Team 的关联成员；让子号"加入"某 Team 的唯一实质动作，是它在 OAuth 授权 consent 时选中该 Team workspace（worker 据 `targetChatgptAccountId` 自动选）。邀请邮件里的 "Accept" 只是 UI 引导，邀请保持 pending（`status=2`）也不影响授权。因此搬号/加号流程里**没有"等子号确认邀请"这一步**——发出 invite 后直接对该号触发授权即可。（2026-06-19 实测确认，详见 [`subaccount-registration-sop.md`](./subaccount-registration-sop.md) 二节。）

## 五、什么时候搬号 vs 什么时候切席位

一个 Team 塞了 N(>2) 个子号、有号是 `usage_based` 取不到额度时，两条路按场景选：

- **同 Team 轮换（法则 4）**：N 个号都想留在这个 Team、且能接受"轮流吃额度"。零账单、凭证不动，只 PATCH `seat_type`。适合临时让某个号顶上。
- **搬到别的 Team（法则 5 的 ✅ 路径）**：想让这个号**长期稳定吃额度**，而本 Team 的 2 个 default 已被别的号长期占着。把它搬到一个 default 有空位（<2）的 Team，在那边吃该 Team 的 default 名额。**会作废原凭证、需重新授权**，但换来稳定额度。

> 判断"多出来的号"：用「六」的查席位脚本看该 Team 实时 `seat_type`。占着 `default` 的就是正在吃额度的；`usage_based` 的 standard-user 子号就是"挤不上、取不到额度"的多余号。

## 六、把多余号搬到有空位的 Team（实操 SOP）

适用场景：某 Team 的 2 个 `default` 被别的号长期占着，本 Team 里有个 `usage_based` 的 standard-user 子号取不到额度（"多出来的号"），要把它搬到另一个 default 有空位的 Team 长期吃额度。

> **前置认知**：所有对 chatgpt.com 后端 API 的调用都经 **worker `/fetch`** 转发，由它处理 Cloudflare 绕过。worker 地址、部署路径、母号 access_token 存储位置均由部署环境 `.env` 与运行时 `data/` 管理，不写入仓库。

> **执行纪律**：每段 Python 都**写成 `/tmp/*.py` 文件再 `python3 跑`，不要用 heredoc / `python3 -c` 拼长脚本**——长内联脚本在本环境多次触发工具调用解析失败，是踩过的坑。

### `/fetch` 调用模板（已实测 200）

```python
# /tmp/fetch_tpl.py —— 通用：经 worker 调 chatgpt backend-api
import json, urllib.request
def fetch(tok, method, path, body=None):
    payload = {"method": method, "path": path,
               "headers": {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"},
               "body": (json.dumps(body) if body is not None else None)}
    worker_url = "<curl-cffi-worker-fetch-url>"
    req = urllib.request.Request(worker_url,
        data=json.dumps(payload).encode(), headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        out = json.loads(r.read())
    return out.get("status"), out.get("body")
```

### Team 母号 → workspace account_id 对照

该对照表属于运行时运营数据，包含真实邮箱和 workspace id，不能写入 git。需要时在部署环境的私有台账或 `data/` 外部安全存储中维护。

| 母号标识 | Team account_id | 备注 |
|---|---|---|
| `<parent-label>` | `<workspace-account-id>` | `<seat/status note>` |

> 重新枚举对照表：对每个有 token 的母号调 `GET /backend-api/accounts/check/v4-2023-04-27`，从返回 `accounts.*.account` 里取 `structure==workspace` 的 `account_id`。

### 步骤

**① 查某 Team 实时席位（已实测）**
`GET /backend-api/accounts/{team_acct}/users?offset=0&limit=25` → 返回 `items[]`，每项含 `email` / `seat_type` / `role` / `id`(=user_id)。统计 `seat_type=="default"` 的个数即 default 占用；`usage_based` 的 standard-user 子号 = 可搬迁的多余号。

**② 找有空位的目标 Team**
对上表每个母号跑步骤①，`default<2` 的就是有空位、可接收搬迁的目标 Team。

**③ 把多余号从原 Team 退出**
用**原 Team 母号 token**：`DELETE /backend-api/accounts/{原team_acct}/users/{该号在原team的user_id}`（样例见 `chatgpt-backend-api/remove-member.json`）。退出后该号在原 Team 的凭证即作废——这是预期内的。

**④ 目标 Team 邀请该号**
用**目标 Team 母号 token**：`POST /backend-api/accounts/{目标team_acct}/invites` body `{"email_addresses":[<email>],"role":"standard-user","seat_type":"default","resend_emails":true}`（邀请样例见 `subaccount-registration-sop.md` 二节）。
> 想让它直接吃额度就邀成 `default`；注意目标 Team 升到第 3 个 default 会触发账单红线（HTTP 409），确保目标 Team default<2 再升。
> **邀请发出后保持 pending 即可，无需去子号邮箱点 Accept**（见法则 6）。若返回 `errored_emails`，多为目标 Team 侧个别限制——换一个有空位的 Team 邀请通常即成功（2026-06-19 实测遇到过）。刚 `DELETE` 退出原 Team 后立刻重邀同号也可能 errored，换 Team 即可。

**⑤ 该号在目标 Team 重新授权生成凭证**
走 worker `/codex-auth/auto`（不传 password 用邮箱验证码即可，见 `subaccount-registration-sop.md`），`targetChatgptAccountId` 传**目标 Team 的 account_id**。consent 时选目标 Team workspace。拿到 token 后按 cpa 凭证格式写盘到对应 `authsN/`，文件名前缀用目标 Team 的短 id。

**⑥ 落地与验证**
新凭证写进目标实例的 `authsN/`，cpa 文件监听自动热加载（日志 `auth file changed ... processing incrementally`）；原实例删掉作废的旧凭证文件。确认目标实例日志该号 `auth unavailable=0`、有 200。

> ⚠️ 验证 refresh_token 有效性时**不要在外部做 refresh**——rt 一次性轮换，外部 refresh 会作废刚写盘的 rt。落盘后交给 cpa 独占轮换即可（详见 `subaccount-registration-sop.md` 重授权要点）。

## 相关文档

- 子号注册/授权 SOP 与现状：[`subaccount-registration-sop.md`](./subaccount-registration-sop.md)
- 子号管理实现边界：[`subaccount-management.md`](./subaccount-management.md)
- 凭证与 workspace 绑定实验：[`codex-workspace-credential-experiment.md`](./codex-workspace-credential-experiment.md)
