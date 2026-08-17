# Product

## Register

product

Team Manager 是管理多个 ChatGPT 账号与 Team/Business Workspace 的私有运营控制台。

核心体验是从统一账号页管理 GAM、Profile、代理、Session、个人套餐和支付方式，并在账号详情的 Workspace 标签内切换空间、直连 ChatGPT 校准账号关系、管理合并后的成员/邀请、设置、账单及当前 `Account × Workspace` 凭证。个人空间与 Workspace 都能绑定目标支付方式和直接取消续费。已退出关系保留独立的本地清理入口。Workspace 保持独立领域实体，但不再设独立管理页面；账号是否可管理 Workspace 完全由活动 owner/admin Membership 派生。

PostgreSQL 保存结构化业务事实；完整 HTTP trace、rrweb 与凭证 JSON 保持文件存储并由数据库索引。源码和公开文档不包含真实运行秘密。
