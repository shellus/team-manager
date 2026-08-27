# 账号清理与状态刷新 SOP

本流程用于批量清理账号、整理账号分组，并刷新个人账单、账号与 Workspace 关系以及 Workspace 成员/邀请列表。所有业务变更通过 Team Manager API 或 UI 完成，不直接编辑运行数据。

## 1. 建立目标集合

先读取账号列表、账号分组和母号概览，记录操作前数量。

- Free 可用账号：`primaryPlan=free` 且 `isBanned=false`。
- 指定分组的额外账号：目标分组中的非封号、非 Free 账号。
- 封号账号：`isBanned=true`，不按套餐或分组再次筛选。
- 母号刷新账号：母号概览中 `managingAccounts` 的非封号账号，按账号 ID 去重。

删除前逐个调用删除预览接口，核对目标邮箱、作为 owner 的本地 Workspace 数量及其关联资源。删除账号会删除该账号作为 owner 的本地 Workspace；其他 Workspace 只删除该账号的本地关系。该操作不调用远端 Workspace 删除接口。

## 2. 清理备注与整理分组

1. 对明确列出的账号调用 `PATCH /api/accounts/:id`，仅提交 `{ "remark": null }` 清空无用备注。
2. 查询目标分组；不存在时通过 `POST /api/account-groups` 创建，避免重复创建同名分组。
3. 使用一次 `PATCH /api/accounts/bulk` 将目标账号移动到新分组。目标集合必须在事务提交前固定，不能按分页循环产生部分迁移。

## 3. 执行账号删除

对每个目标账号按以下顺序执行：

1. `GET /api/accounts/:id/deletion-preview`，确认邮箱和级联资源仍与目标集合一致。
2. `DELETE /api/accounts/:id`，请求体使用 `{ "confirmLocalCascade": true }`。
3. 记录成功、失败和删除的本地 Workspace 数量；失败账号不得静默跳过。

账号删除完成后重新读取账号列表。非默认分组只有在 `accountCount=0` 时才调用 `DELETE /api/account-groups/:id`；默认分组永不删除。

## 4. 刷新母号与 Workspace

对母号概览得到的每个唯一管理账号：

1. `POST /api/accounts/:id/workspaces/sync`，刷新账号可见的 Workspace 关系。
2. 从账号详情读取活动 Workspace，并以该账号作为执行账号调用 `POST /api/workspaces/:workspaceId/refresh`。该接口按现有服务逻辑刷新成员、邀请、设置和账单。

默认采用最多 6 个账号并发、批次间隔 10 秒。单个账号的关系同步成功后再刷新其 Workspace；同一 Workspace 被多个管理账号看到时可以重复调用，但最终核验按 Workspace ID 去重。

## 5. 备用 owner 整理

备用 owner 的分类依据是母号历史订阅，而不是当前列表里的显示套餐：

- 第一类：首次开通 Team 的时间早于 `2026-06-24`，且此前没有 052/Credits 记录。邀请 Free 普号使用 `usage_based`（Codex）席位，子号同步接受邀请，再将其角色改为 `account-owner`，备注写成“作为 `<母号邮箱>` 的备用onwer”，移动到 `备用onwer`。
- 第二类：先有 052/Credits，再升级为双席位 Team，升级后 owner 仍是隐藏的 Codex 席位。临时开启 `auto_accept_requests`，子号使用 Workspace 外部 ID 申请加入并同步，母号将其升为 owner；完成该类别后，对相关 Workspace 将该设置改回 `false`，再写备注并移动到 `备用onwer`。
- 第三类：只有 052 Codex 空间、没有 Team 订阅。流程与第二类相同，备用账号移动到 `052备用onwer`，完成后同样恢复 `auto_accept_requests=false`。

执行前先按 Workspace 的活动 Membership `created_at` 判断加入顺序。若一个 Workspace 已有两个已纳管的 owner，视为备用 owner 已由人工配置：只把后加入的 owner 移动到对应备用分组，不重复邀请、不移除任何 owner。若一个 052 母号拥有两个 052 Workspace，则使用同一个 Free 普号加入两个空间、分别升为 owner，确认两个空间均有新 owner 后再移除原 owner。

MollWorkspace（非盈利组织 Team）不在本流程范围内，除非另行授权。缺少邮箱、Session 无效或上游权限错误时，不得通过更换 SID 规避；应先修复账号授权或 Session。

## 6. 失败重试与最终核验

- 上游 5xx、curl_cffi worker 暂时失败或网络超时，只重试失败账号；每次重试间隔至少 10 秒，最多 3 轮。只有错误证据明确指向出口/IP 或网络链路时，才可按既有代理配置接口更换 SID，并在更换前保存原配置。
- `ChatGPT Session 无效`、`缺少 user.email`、Token/Session 内容不完整等属于 Session 内容错误，禁止通过更换 SID 处理；应停止重试并转入 CloakBrowser 重新登录、GAM 重建或人工修复 Session 的流程。
- 业务 4xx 不转换为成功，也不把未知套餐、缺失账单或权限错误伪装成 Free/空列表。
- 重新读取账号列表，核对删除数量、剩余封号数、目标分组归属和空分组。
- 对每个刷新账号读取个人空间账单详情，核对发票列表；读取账号详情和 Workspace 详情，核对关系、成员和邀请的最终快照时间。
- 输出汇总时区分“请求成功”“数据为空”和“读取失败”，并保留失败邮箱与错误摘要，禁止输出 Session、Access Token、完整支付信息或其他秘密。
