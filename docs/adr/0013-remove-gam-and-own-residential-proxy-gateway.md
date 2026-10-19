# 移除 GAM 集成，账号住宅代理由 Team Manager 自有网关提供

## 状态

已接受，2026-10-19。取代 [ADR 0005](./0005-sync-workspace-relationships-with-local-session.md) 与 [ADR 0007](./0007-team-manager-owns-current-web-session.md) 中关于 GAM 负责 Profile、代理、注册、Session 交付和浏览器 Checkout 的部分，并结束 [账号代理路由一致性问题](../plans/account-proxy-routing-consistency.md)。

## 决定

Team Manager 不再调用 GPT Account Manager。账号注册、GAM 纳管与重建、Profile 启停、受管 Profile Session 刷新、注册任务代理、操作控制与补卡、个人套餐首次开通（`start_new`）和 Business 浏览器开通全部下线。保留的个人套餐写操作只有已验证的 `Plus → Pro 5x / Pro 20x` 直连升级。

账号出口由 Team Manager 自有的 Mihomo 网关提供。每个账号可以保存一份住宅代理配置（国家、ASN 或州/城市、8 位 SID），存放在 `account_operational_profiles` 的 `residential_proxy_*` 列。Team Manager 按数据库生成网关配置并经控制端热加载：每个账号是一个认证用户，`IN-USER` 规则把它路由到该账号的 `RES-<账号 ID>` 住宅节点；住宅节点经前置 HTTP 代理拨号，静态资源与未匹配流量走前置代理。

账号实际使用的代理只有一个来源：配置了住宅代理时为网关地址，否则为手工代理地址（`proxy_url_*`），两者互斥；都没有时请求进入 worker 的默认代理。原先由 GAM 兜底写入账号代理的逻辑删除。

## 理由

运营中的首选与备用 Owner 由 BAM 管理浏览器身份。2026-10-19 核对时，已纳入 GAM 的 55 个账号被兜底写成 GAM 网关地址，使用 GAM 自行生成的住宅会话，地区与 SID 与 BAM 不一致；未纳入 GAM 的账号共享 worker 默认代理，出口地区不受控。把住宅配置放到 Team Manager 账号上，可以由外部同步工具按 BAM 的地区与 SID 写入，同一账号的浏览器与 HTTP 请求使用同一住宅身份。

GAM 的注册、纳管与浏览器 Checkout 在 PostgreSQL 时代只有 10-17 的一批纳管记录，没有注册或开通记录；保留这些集成使 Team Manager 同时维护两套账号、代理和操作模型。

## 影响

- `gam_bindings`，以及 `account_operational_profiles` 的 `account_manager_plan_code`、`account_manager_synced_at`、`profile_status`、`profile_checked_at` 不再被代码读写，保留到确认无需回滚后再单独迁移删除。`automation_operation_events` 不再写入，只用于展示历史 GAM 操作的事件。`account_operational_summaries` 视图仍引用 `account_manager_plan_code` 与 `profile_status`，删除列前需要同步调整视图。
- `automation_operations` 只记录 Team Manager 本地完成的操作；历史 GAM 操作行保持只读可见，可在操作详情中清理。
- 已保存的 GAM 网关地址（`proxy_url_*` 中指向 GAM 的地址）不会自动迁移；部署后按账号改写为住宅代理配置，或在 GAM 下线前保持可用。
- 部署配置删除 `integrations.accountManager` 与 `integrations.payment.httpProxyHosts`，新增可选的 `integrations.residentialProxy`；配置校验拒绝未知字段，新版本与旧配置不兼容。
