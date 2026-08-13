# 额度与席位轮转

team-manager 关注的是 ChatGPT Team 席位在 Codex 使用中的 Team 额度窗口，不是 usage-based/Codex 余额积分。额度判断以目标 workspace 凭证实时返回为准。

## 额度维度

Codex 凭证绑定到“ChatGPT 账号 × Team workspace”。同一个账号在 Team A 的额度用完，不代表它在 Team B 的额度也用完。

刷新额度时，系统使用该 workspace 对应的 Codex credential：

- `access_token` 用于鉴权。
- `account_id` 作为 `Chatgpt-Account-Id` 上下文。
- 返回结果缓存到该凭证的 `lastQuota` 和 `lastQuotaAt`。

## 席位与额度关系

| 账号在 Workspace 中的席位 | 凭证可用性 | 额度表现 |
|---|---|---|
| ChatGPT 席位 | 可使用 Team 额度 | `wham/usage` 返回额度窗口 |
| Codex 席位 | 没有 ChatGPT Team 席位额度 | 无 Codex 余额时会表现为余额或积分不足 |

ChatGPT 席位额度窗口可能存在不同灰度策略。系统不写死固定金额或周期，展示以实时 `wham/usage` 返回为准。

## 腾 ChatGPT 席位

常规腾位流程：

1. 在账号详情的 Workspace 标签选择目标空间并刷新成员与邀请列表。
2. 查看 ChatGPT 席位已用数量。
3. 将暂时不用 ChatGPT 额度的成员切到 Codex 席位。
4. 邀请或切换新的成员到 ChatGPT 席位。
5. 到 Workspace Billing 确认计费席位和预计金额；不要只看当前成员数。

仅为腾出 ChatGPT 席位时，不应移除成员。移除会破坏该账号与该 Team 的 membership，可能导致该 Team 下凭证不可用；对应标准席位在部分情况下仍会临时计费，新成员也可能形成独立付费席位。

成员移除结果中的 `billing_notice` 和 `policy_notice` 只是上游风险信号，不能替代 Billing，也不能把临时阈值或释放时间解释成稳定免费规则。公开换号不会自动移除已接受的标准 ChatGPT 成员。

## 额度恢复后的复用

同一账号仍在同一 Team 下时，把成员从 Codex 席位切回 ChatGPT 席位即可继续复用原 Team 凭证，不需要重新生成凭证。

跨 Team 搬迁不同。账号从原 Team 移除并加入另一个 Team 后，需要为目标 Team workspace 重新创建 PAT。

## 推荐操作策略

- 默认新成员席位设置为 Codex 席位。
- 需要 ChatGPT Team 额度时，再把目标成员切到 ChatGPT 席位。
- 额度用尽或暂时不用额度时，优先切回 Codex 席位。
- 保留同一 Team 下已有 PAT，避免重复创建。
- 移除成员只用于明确离开 Team 或跨 Team 搬迁，不用于常规腾位。
- 不进行高频“移除后重新邀请”轮转；席位分配滥用可能导致 Workspace 停用或账号暂停。
