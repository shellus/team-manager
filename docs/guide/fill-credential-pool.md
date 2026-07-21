# 新号填充凭证号池 SOP

本流程用于用全新子号填充 Codex 凭证号池。目标是让每个可用 ChatGPT 席位对应一份有效的“子号 × Team workspace”凭证，同时避免误动已出租母号和已出租席位。

## 核心规则

- Codex 凭证绑定到“子号 × Team workspace”。同一子号在多个 Team 下需要分别生成凭证。
- 额度同样按“子号 × Team workspace”计算。同一子号在 Team A 的额度用尽，不代表 Team B 下的凭证也用尽。
- 一个子号可以同时加入多个 Team。若每个 Team 只需要两个可用 ChatGPT 席位，则理论上两个新子号可加入任意数量的 Team，并为每个 Team 各生成两份凭证。
- 实际运营仍应准备备用子号。注册风控、账号锁定、Team 邀请异常、PAT 权限关闭或上游限流都可能让单个子号无法覆盖所有目标 Team。
- 生成或替换凭证必须通过页面、API 或 service/store 方法完成，不通过编辑 `data/*.json` 或凭证文件生效。

## 选择母号和席位

先确定本轮允许使用的母号和席位位置：

1. 在母号页按分组筛选候选母号。
2. 排除已出租母号、已出租固定席位和仍需保留额度的成员。
3. 刷新候选母号的成员、待处理邀请和设置缓存。
4. 确认每个候选 Team 的 ChatGPT 席位上限。本系统中需要遵守的常见红线是同一 Team 同时不超过两个 `default` 成员。
5. 确认目标 Team 已允许成员创建个人访问令牌。PAT 生成依赖该 Team 的个人访问令牌权限。

已出租固定席位以 `seatSlots` 和成员本地资料为准。`usage_based` 成员不占固定 ChatGPT 席位，但如果该账号仍需要保留 Team membership 或凭证，不应移除。

## 查询 CPA 状态和账单额度

开始替换前，先通过 `../newapi` 的号池状态服务确认 CPA 实例和凭证状态。状态页后端接口是 `credential-status`：

1. 对目标 CPA 实例执行实例级刷新：`POST /credential-status/api/refresh`，body 为 `{"scope":"instance","instanceId":"cpa-vip"}` 这类实例 ID。
2. 刷新响应中的 `snapshot.instances[]` 是当前号池快照；按 `instance.id` 找到目标实例。
3. 先看 `summary.active`、`summary.error`、`summary.unavailable`，确认需要替换的凭证数量。
4. 再看 `credentials[]` 的 `displayName`、`accountId`、`status`、`statusMessage`、`quota.status`、`quota.planType` 和 `quota.windows[]`。
5. `status=active` 且 `quota.status=success` 才算该凭证可用；`quota.windows[].usedPercent` 和 `resetAt` 用于判断该凭证对应 Team workspace 的上游额度窗口。

账单面板查询的是 NewAPI 网关消费和本地预算，不等同于 ChatGPT 上游 quota。按 pool 查询：

- `GET /carpool-cost/api/<pool>/daily`
- `GET /carpool-cost/api/<pool>/weekly`
- `GET /carpool-cost/api/<pool>/monthly`

其中 `<pool>` 是 `../newapi/config/carpool-cost/pools.yaml` 里的 pool id，例如 `vip`。响应中的 `totalUsd` 是当前窗口已消费金额，`poolBudget` 是本地预算线，`poolBudget - totalUsd` 可作为账单面板口径的剩余额度。上游 Team 凭证剩余额度仍以 `credential-status` 返回的 `quota.windows[]` 为准。

## 创建新子号

新子号优先使用子号页“自动注册”入口：

1. Team Manager 向独立 GPT Account Manager 创建注册操作。
2. 注册服务从 GongXi-Mail 获取邮箱，使用独立 Cloak profile 完成注册。
3. 注册成功后，Team Manager 录入邮箱、私有密码和 Web Session。
4. 若注册阶段遇到人机校验、账号锁定或邮箱异常，按子号状态处理，不把该账号计入可用候选。

凭证生成阶段只创建 PAT。若 OpenAI 在账号注册或首次登录阶段要求手机验证，那属于独立注册服务，不属于 PAT 生成步骤。

## 腾出目标 Team 席位

填充新凭证前，先处理已用尽额度的旧成员：

1. 刷新目标母号成员列表。
2. 确认要替换的旧成员是本轮号池轮转对象，不是已出租席位成员。
3. 对已经确定不再复用该 Team 凭证的旧成员，执行“移出成员”。
4. 如果旧成员只是暂时不用额度、后续还要复用同 Team 凭证，应优先切到 `usage_based`，不要移除。
5. 每次移出或改席位后，重新刷新成员列表并确认 `default` 数量没有超过上限。

移除成员会破坏该账号在该 Team 下的 membership，可能使原 Team 凭证不可用。只有在明确进行新号替换、跨 Team 搬迁或清理无用 Codex 成员时才使用移除。

## 加入新号

对每个目标 Team 执行：

1. 使用母号邀请新子号邮箱加入 Team。
2. 席位选择 `default`，让该子号获得 ChatGPT Team 额度窗口。
3. 邀请或切换到 `default` 前，人工确认当前 `default` 成员数量和席位归属；系统不会额外检查或提示。
4. 邀请完成后刷新母号成员和 pending invite。
5. 到子号页刷新 Team 关联，确认该子号在目标 Team 下是 `member` 或至少处于可创建 PAT 的 `invited` 状态。

子号不需要点击邀请邮件里的 Accept 才能创建 PAT。pending invite 通常已足够让 Web Session 看到目标 Team workspace，但正式成员状态仍应通过刷新确认。

## 生成 PAT 凭证

对每个“新子号 × 目标 Team”执行：

1. 在子号页选择目标 Team 的凭证操作行。
2. 使用“创建令牌”生成个人访问令牌凭证。
3. 系统会按目标 workspace 换取 Web access token，并调用 ChatGPT Web 的 `wham/auth-credentials`。
4. 远端返回的 workspace 必须和目标 Team 一致；不一致时应拒绝保存。
5. 生成后刷新该凭证额度，确认 `wham/usage` 返回 Team 额度窗口。
6. 对 CPA 热重载文件号池，将导出的凭证 JSON 按目标号池文件名原子替换到 `auths/<实例名>/`；不调用 CPA 管理 API，不重启实例。
7. 通过号池状态 API 刷新目标实例，确认凭证状态为可用且额度窗口未用尽。

不要通过修改凭证 JSON 的 `account_id`、请求头或文件名来复用其他 Team 的凭证。跨 Team 使用必须为目标 workspace 重新创建 PAT。

替换 CPA 文件前应把旧文件备份到活动 `auths/<实例名>/` 之外，避免 CPA 把备份 JSON 当成新凭证加载。替换后如果 `status` 仍显示 `auth_unavailable`，但 `quota.status=success`，通常表示 CPA 实例中仍有旧运行态标记；再次确认文件已热重载后，以 `credential-status` 刷新结果为准。

如果创建 PAT 返回“目标 workspace Web session 与目标不一致”，说明子号当前 Web session 无法换取目标 Team workspace 的 Web access token。处理顺序是重新录入该子号的当前 ChatGPT session、改用仍可登录的子号，或重新创建新子号；不要降低 workspace 校验，也不要用改 JSON 字段的方式跨 Team 复用凭证。若 `credential-status` 中只有 CPA 运行态报错而 `quota.status=success`，可先用 team-manager 保存的同 workspace 规范凭证文件覆盖 CPA auth 文件，清除 CPA 热重载前遗留的错误态；这不等同于生成新凭证。

## 子号数量估算

子号数量取决于单个 Team 需要同时占用的 ChatGPT 席位数，而不是 Team 数量。

| 场景 | 最少新子号数量 | 原因 |
|---|---:|---|
| 1 个 Team，2 个可用席位 | 2 | 同一 Team 内一个子号只能占一个成员席位 |
| 2 个 Team，每个 2 个可用席位 | 2 | 两个子号都加入两个 Team，可生成 4 份凭证 |
| N 个 Team，每个 2 个可用席位 | 2 | 两个子号分别加入所有目标 Team，可生成 `2 × N` 份凭证 |
| 任一 Team 需要 3 个可用席位 | 3 | 单个 Team 内需要 3 个不同成员 |

因此，在“每个 Team 最多两个可用 ChatGPT 席位”的运营规则下，理论上无论多少 Team，只需要两个新子号即可填满每个 Team 的两个席位。实际执行时应保留备用子号，以应对单号注册失败、锁号、权限异常或额度接口异常。

## 验收标准

完成后需要同时满足：

- 每个目标 Team 的 `default` 成员数量不超过上限。
- 已出租母号和已出租席位未被修改。
- 旧的无用 Codex 成员已从目标母号移除，母号 owner 保留。
- 新子号在每个目标 Team 下的 Team 关联已同步。
- 每个目标 Team 都有目标数量的 PAT 凭证。
- 号池状态 API 显示目标凭证可用，额度窗口未用尽。
- 账单面板 API 能返回目标 pool 的 daily、weekly 和 monthly 消费窗口；需要看本地预算剩余时，按 `poolBudget - totalUsd` 计算。
- 运行时数据变更来自页面、API 或 service/store 方法，不来自手工编辑 JSON。

## 相关文档

- [Team 账号、席位与凭证基本规则](../core/seat-and-credential-model)
- [母号与 Team 管理](./mother-accounts)
- [子号与 Codex 凭证](./subaccounts)
- [额度与席位轮转](./quota-and-seats)
- [子号注册服务对接 SOP](../dev-spec/subaccount-registration-sop)
