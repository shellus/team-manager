# Team 升级订单维护

订单维护属于 Workspace，不属于某类账号。打开 `/team-orders` 管理全局 Checkout 配置、维护关系与订单历史。

## 加入维护池

1. 选择目标 Workspace。
2. 选择当前在该 Workspace 有活动 owner/admin Membership 的执行账号。
3. 设置是否启用和可选覆盖配置。
4. 保存维护关系。

执行账号是当前策略选择，不会成为 Workspace 的永久 owner 外键。需要更换执行账号时直接更新维护关系。

## 配置与订单

全局配置包含优惠码、国家和货币；Workspace 可保存覆盖值。每份订单记录保存创建时的配置快照、状态、Checkout URL、有效期、错误和执行账号。

Checkout URL 有效不代表已支付。付款后必须刷新 Workspace 的订阅和账单确认最终状态。Team Manager 不保存完整支付卡，也不根据链接状态推测付款成功。

## 恢复

维护关系和订单都在 PostgreSQL。恢复时必须同时恢复数据库、加密密钥和文件制品；随后检查执行账号仍有 Workspace 管理权限。
