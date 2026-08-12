# 新账号填充凭证号池 SOP

目标是让每个可用 ChatGPT 席位对应一份有效的“账号 × Workspace”凭证，同时避免改动已出租客户席位。

## 核心规则

- 同一账号在多个 Workspace 下需要分别生成凭证和刷新额度。
- 一个账号可以加入多个 Workspace；准备备用账号应对注册、锁号、邀请、PAT 权限或限流异常。
- 凭证正文始终由文件制品服务写入，不能手工修改 JSON 让业务状态生效。

## 选择 Workspace

1. 在 Workspace 列表确定本轮目标，排除已出租客户席位和仍需保留额度的成员。
2. 刷新成员、邀请和设置。
3. 核对 `default` 固定 ChatGPT 席位与 Billing；当前成员数不是计费席位数。
4. 确认允许成员创建个人访问令牌。

## 创建账号

在账号页启动 GAM 注册，创建时选择目标账号分组。注册成功后，同步 GAM 并导入 Web Session。注册任务异常在账号操作记录和 GAM 中处理。

## 调整席位

需要腾固定席位时，优先把暂时不用额度的成员切到 `usage_based`，不要移除。移除会破坏 Membership，可能使原 Workspace 凭证不可用，并且不保证标准席位立即停止计费。

## 加入 Workspace

1. 由当前有 owner/admin 权限的执行账号邀请新账号邮箱。
2. 需要 Team 额度时选择 `default`；否则选择 `usage_based`。
3. 刷新成员和邀请，确认关系为 `member` 或可用于 PAT 流程的 `invited`。

## 生成凭证

对每个“账号 × 目标 Workspace”执行：

1. 选择目标关系并创建 PAT 或 OAuth 凭证。
2. 系统按目标 Workspace 换取 Web Access Token。
3. 校验远端凭证 Workspace ID 与目标一致；不一致则拒绝保存。
4. 刷新凭证额度，确认 `wham/usage` 返回目标 Workspace 的窗口。
5. 如需投放 CPA，将规范凭证文件原子替换到目标号池，并通过号池状态服务刷新验证。

禁止通过改 `account_id`、请求头或文件名跨 Workspace 使用凭证。跨 Workspace 必须重新授权或创建 PAT。

## 数量估算

账号数量取决于单个 Workspace 需要同时占用的成员席位数，而不是 Workspace 总数。若每个 Workspace 需要两个不同成员，则理论上两个账号可以同时加入多个 Workspace，为每个 Workspace 生成两份独立凭证；实际运营应保留备用账号。

## 验收

- 每个目标 Workspace 的固定席位和 Billing 已人工核对。
- 已出租客户席位未被修改。
- 新账号的 Membership/Invitation 已同步。
- 每个目标 `Account × Workspace` 有独立凭证和额度结果。
- 数据库引用的凭证文件存在且 SHA-256 一致。
- 所有业务变更来自 UI、API 或 service/repository。

相关文档：[领域模型](../core/seat-and-credential-model)、[额度与席位](./quota-and-seats)、[状态与排错](./status-and-errors)。
