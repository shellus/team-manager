# 禁止公开换号自动移除标准 ChatGPT 成员

## 状态

已接受，2026-07-26。

## 背景

公开换号原本会自动移除客户席位当前成员，再邀请新邮箱。OpenAI 当前说明：标准 ChatGPT 成员被移除后，其席位在部分情况下仍会临时计费；新成员有独立使用限制，并可能形成另一个付费席位。被移除成员会立即失去 Workspace 访问权限，因此“成员已移除”不等于“计费席位已释放”。从 2026-08-19 起，新增付费席位还会在添加时立即按比例收费。

成员移除接口可能返回 `billing_notice` 和 `policy_notice`，但这些内部字段没有公开、稳定的完整语义。社区观测到的空缺序号、临时阈值和释放天数只能作为排查信号，不能作为自动继续邀请的安全许可。OpenAI 同时说明，违反服务协议的席位分配滥用可能导致 Workspace 停用或账号暂停。

参考：

- [Managing billing and seats in ChatGPT Business](https://help.openai.com/en/articles/8792536-managing-billing-and-seats-in-chatgpt-business)
- [Managing members, seat types, and roles in ChatGPT Business](https://help.openai.com/en/articles/8542216-managing-members-seat-types-and-roles-in-chatgpt-business)

## 决策

- 公开换号不得自动移除已接受的 `default` 标准 ChatGPT 成员；前后端都明确阻止该操作，并提示联系管理员核对 Billing。
- 空客户席位、待处理邀请和 `usage_based` Codex 成员仍可走公开换号；标准 ChatGPT 邀请仍提示可能新增计费席位。
- 管理后台保留显式成员移除能力，因为跨 Team 搬迁和清理无用成员仍有合法需求；确认文案必须提示访问、凭证和临时计费风险。
- 每次成功移除后，本地保存最近一次 `billing_notice`、`policy_notice` 的完整原始 JSON 和已知字段摘要，供操作员结合 Billing 判断。
- `policy_notice` 的 `kind`、序号、阈值或时间不能驱动自动继续邀请。最终费用和可用席位以 Workspace Billing 与账单为准。

## 后果

标准 ChatGPT 客户席位不能再由客户自助完成“移除旧成员并邀请新成员”的整套流程。管理员需先评估账单和账号风险，再决定修改席位类型、人工移除或停止轮转。系统失去一部分自动化便利，但避免把无法预判的上游计费和 Workspace 风险扩散到公开入口。
