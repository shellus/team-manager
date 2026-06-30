# Team 账号、席位与凭证基本规则

本文件记录 team-manager 开发和运营中必须先理解的基础规则。涉及母号、子号、Team workspace、席位类型、Codex 凭证、额度或 Team 关联的任务，应先阅读本文件。

## 一、ChatGPT 账号注册、登录与授权

1. **Team 邀请发给邮箱，不要求邮箱已注册 ChatGPT 账号。**
   Team 母号邀请成员时，目标是邮箱地址。该邮箱是否已经注册 ChatGPT 账号，不影响母号发出邀请。

2. **新 ChatGPT 账号注册和首次登录有独立流程。**
   新邮箱注册时需要完成 OpenAI 账号创建流程；首次进入 ChatGPT 时可能需要补充姓名、年龄等账号资料。该流程与 Team 邀请本身是两件事。

3. **子号无需点击邀请邮件里的 Accept 才能进入授权流程。**
   Team invite 发出后，该邮箱已经处于目标 Team 的关联成员/邀请状态。Codex 授权时只要能在授权流程中选择目标 Team workspace，即可生成绑定该 Team 的凭证。

4. **pending invite 和正式 member 需要区分。**
   母号邀请邮箱后，该邮箱通常先出现在 pending invites；后续才进入 members。pending invite 已足够让 Codex 授权时看到目标 Team，但本地关系状态仍应区分 `invited` 和 `member`。

5. **Codex 授权登录时需要选择 workspace。**
   同一个 ChatGPT 账号如果属于一个或多个 Team workspace，Codex 授权阶段需要选择本次授权绑定到哪个 workspace。系统自动授权时用目标 `chatgptAccountId` 选择 workspace。

6. **一个 ChatGPT 账号可以加入多个 Team workspace。**
   同一个账号可以在不同 Team 中作为 owner 或 member 存在。每个 Team workspace 是独立上下文，有自己的 workspace `account_id`。

## 二、Team workspace、母号子号与席位类型

1. **Team workspace 是独立空间。**
   每个 Team 有自己的 workspace `account_id`。母号 owner 在该 Team 下是 `account-owner`，被邀请的子号通常是 `standard-user`。

2. **邀请成员时可以选择席位类型。**
   母号邀请成员加入 Team 时，可以指定 `seat_type`。默认席位只是在未显式指定时使用的兜底值，不会阻止显式邀请 ChatGPT 席位。

3. **席位类型只有两种。**

   | 原始值 | 业务含义 |
   |---|---|
   | `default` | ChatGPT 席位，占 Team 已购买的固定席位数量，有 Team 额度窗口 |
   | `usage_based` | Codex/usage-based 席位，不占固定 ChatGPT 席位，没有 Team 额度窗口 |

   字段名是 `seat_type`，不是 `seat`。`seat` 只是 team-manager 内部模型字段名。
   OpenAI 自 2026-06-24 起限制新 ChatGPT Business/Team workspace 获得首个 Codex 席位；此前已存在 Codex 席位或 pending invite 的 workspace 仍可继续管理 `usage_based` 席位。

4. **ChatGPT 席位超出已购数量会产生账单风险。**
   `default` 席位需要预先购买固定数量。邀请或切换成员到 `default` 时，如果同一 Team 内 `default` 成员数超过已购数量，超出的席位会进入后续账单。team-manager service 层会对这类操作做账单风险确认。

5. **默认加入席位可设置为 Codex 席位来降低误邀风险。**
   Team owner 可以把新成员默认席位设为 `usage_based`。这样有邀请权限的成员或未显式指定席位的邀请更不容易占用 ChatGPT 固定席位。该设置不能替代账单风险确认，因为显式 `default` 邀请仍可产生额外席位。

6. **普通成员也可能发起邀请。**
   实际使用中，`standard-user` 也可以邀请别人加入 Team。已确认远端存在 `workspace_referrals_enabled` 设置，页面含义为“允许成员发送 Codex 邀请”；该设置按已观测命名记录，不替代默认席位和账单风险确认。防范手段仍应包含把默认新成员席位设为 `usage_based`，使未显式指定席位的邀请默认不占 ChatGPT 固定席位。

7. **同一 Team 内腾 ChatGPT 席位时优先切席位，不要移除成员。**
   为避免超出已购席位数，应先确认当前 `default` 成员数；需要腾位时，优先把暂时不用额度的成员从 `default` 切到 `usage_based`，再邀请或切换新的成员到 `default`。同一时间 `default` 成员数不超过已购席位数，就不会产生额外席位账单风险。

8. **移除成员不是常规腾席位手段。**
   移除成员会破坏该账号与该 Team 的 membership，可能导致该 Team 下的凭证不可用。移除只适合跨 Team 搬迁等明确需要离开原 Team 的场景。仅为腾出 ChatGPT 席位时，不应使用移除。

## 三、凭证、Team 位置与额度

1. **Codex 凭证绑定到“ChatGPT 账号 × Team workspace”。**
   一个 ChatGPT 账号在一个 Team workspace 下生成一份对应凭证。该凭证绑定授权时选择的 Team workspace。

2. **凭证不能靠改字段或改请求头跨 Team 使用。**
   同一 Codex access token 即使更换 `Chatgpt-Account-Id` 请求头，也只认它授权时绑定的 Team。要让同一账号使用另一个 Team 的额度，需要在目标 Team 下重新授权生成另一份凭证。

3. **一个账号加入多个 Team 时，可以保留多份凭证。**
   如果一个 ChatGPT 账号要在多个 Team 下使用额度，需要分别保留对应 Team 的凭证。多份凭证可以同时使用，互不影响；每份凭证对应一份独立的 Team workspace 位置和用量状态。

4. **凭证是否可用取决于该账号在对应 Team 下的席位类型。**

   | 账号在该 Team 的席位 | 凭证状态 | 用量表现 |
   |---|---|---|
   | `default` | 可使用 Team 额度 | `wham/usage` 返回 `rate_limit` 窗口 |
   | `usage_based` | 没有 Team 额度 | `wham/usage` 能体现 usage-based/Codex 席位状态；无 Codex 余额时调用表现为积分或余额不足 |

5. **席位额度按 Team workspace 独立计算。**
   同一个 ChatGPT 账号在 Team A 的额度用完，不代表它在 Team B 的额度也用完。每个 Team workspace 下的凭证和额度状态独立。

6. **这里讨论的额度不是 Codex 积分。**
   team-manager 关注的是 ChatGPT 席位在 Codex 使用中的 Team 额度窗口，不是 usage-based/Codex 余额积分。`usage_based` 席位不提供 Team 席位额度；没有 Codex 余额时，即使账号在 Team 中，也不能使用 Team 额度。

7. **ChatGPT 席位额度窗口以实时返回为准。**
   运营上可能存在传统周限和灰度月限等不同窗口；系统判断应以 `wham/usage` 实时返回的 `rate_limit` 为准，不应把固定金额或周期写死为业务逻辑。

8. **切回 ChatGPT 席位即可复用同 Team 凭证。**
   为了腾出席位，可以暂时把账号从 `default` 切到 `usage_based`。后续额度恢复或需要重新使用该 Team 额度时，把它切回 `default` 即可复用原来绑定该 Team 的凭证，不需要重新生成凭证。

9. **跨 Team 搬迁需要重新授权。**
   如果账号从原 Team 移除并加入另一个 Team，要使用目标 Team 的额度，必须在目标 Team 下重新走 Codex OAuth 授权，生成绑定目标 Team 的新凭证。原 Team 凭证不能通过改字段或改请求头转成目标 Team 凭证。

10. **移除后再加回同一 Team 的凭证复用状态未确认。**
    尚未专门观察“移除成员后再邀请回同一 Team”时，原 Team 凭证是否一定能复用。因此文档和系统操作应按风险处理：只要目标是同 Team 腾席位，就优先切席位，不用移除。

## 相关文档

- 数据模型与本地缓存规则：[`../dev-spec/data-model.md`](../dev-spec/data-model.md)
- 子号注册/授权 SOP 与现状：[`../dev-spec/subaccount-registration-sop.md`](../dev-spec/subaccount-registration-sop.md)
- 子号管理实现边界：[`../dev-spec/subaccount-management.md`](../dev-spec/subaccount-management.md)
- 凭证与 workspace 绑定实验：[`../dev-spec/codex-workspace-credential-experiment.md`](../dev-spec/codex-workspace-credential-experiment.md)
