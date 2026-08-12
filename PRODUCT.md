# Product

Team Manager 是管理多个 ChatGPT 账号与 Team/Business Workspace 的私有运营控制台。

核心体验是从统一账号页管理 GAM、Profile、代理、Session、个人套餐、支付方式、Workspace 关系和凭证，再从 Workspace 页管理成员、邀请、席位、设置、账单和订单。账号是否可管理 Workspace 完全由活动 owner/admin Membership 派生。

PostgreSQL 保存结构化业务事实；完整 HTTP trace、rrweb 与凭证 JSON 保持文件存储并由数据库索引。源码和公开文档不包含真实运行秘密。
