# 2026-06-18 UI 与母号操作收口

- [x] 母号待处理邀请：页面初始只显示数量；后台用 `limit=1` 读取 `total`，不拉完整列表；点开后才加载列表。
- [x] 新成员默认席位：入口放入母号详情右上角下拉菜单，摘要区只显示当前值。
- [x] 邀请表单：入口放入母号详情右上角下拉菜单，不再默认铺开。
- [x] 母号/子号 tab 布局：已用 playwright-remote 检查桌面和移动端；修复母号移动端表格撑宽页面，子号 item 高度已统一。
- [x] 无数据库架构影响：当前单机文件持久化可继续支撑母号/子号缓存、验证日志和关联关系；额外成本主要是跨实体查询、后台进度、计数缓存需要手写文件级索引/更新。当前已通过 `pendingInviteCount`、`teamLinks`、日志 JSONL 缓存规避页面阻塞；若后续要做批量调度、搜索、并发队列和审计检索，再引入 SQLite/Postgres 会更省维护成本。
- [x] 母号套餐显示：`self_serve_business_usage_based` 显示为 `Codex席位`。
- [x] 成员角色显示：`account-owner/account-admin/standard-user/account-analyst` 显示为 `所有者/管理员/成员/分析者`。
- [x] 新成员默认席位写操作：已确认并实现 `POST /backend-api/accounts/{account_id}/settings/default_seat_type`，接口样本见 `docs/dev-spec/chatgpt-backend-api/default-seat-type.json`。
- [x] 账单风险确认：页面不再常驻显示“席位红线”；API 层在可能超出包含的 ChatGPT 席位数量时返回 409 和确认文案，前端确认后带 `confirmBillingRisk:true` 再执行。
- [x] 成员列表 应该直接显示缓存数据，然后显示一个非阻塞的页面内loading表示正在更新。这样用户进入页面第一时间可以看到和操作，如果要确保是最新数据，才会主动等待更新完成。

- 子号全新自动注册：GongXi-Mail 申请邮箱、OpenAI 注册/登录协议执行器还没做完整闭环
- 手机验证流程：首次绑定手机号、二次手机号验证码、验证码错误、人机校验、账号锁定这些只做了 verification_required 状态和日志记录，还没做自动处理。
