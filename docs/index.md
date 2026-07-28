# team-manager 使用文档

team-manager 用于管理 ChatGPT Team workspace 的母号、成员、邀请、默认席位、子号、Codex 凭证和额度缓存。

## 阅读入口

- [业务流程总览](./guide/)：操作员日常使用流程。
- [母号与 Team 管理](./guide/mother-accounts)：母号录入、成员、邀请、默认席位和 Team 名称。
- [Team 升级订单维护](./guide/team-order-maintenance)：将 Codex Workspace 母号加入维护池并管理支付链接。
- [子号与 PAT 凭证](./guide/subaccounts)：子号注册或录入、Team 关联、PAT 创建和额度刷新。
- [额度与席位轮转](./guide/quota-and-seats)：如何腾 ChatGPT 席位并保留同 Team 凭证。
- [新号填充凭证号池](./guide/fill-credential-pool)：使用新子号加入多个 Team、生成 PAT 凭证并填充号池。
- [状态与排错](./guide/status-and-errors)：常见状态、错误和运行能力检查。

## 规则参考

- [Team 账号、席位与凭证基本规则](./core/seat-and-credential-model)
- [数据模型与本地缓存规则](./dev-spec/data-model)
- [AT 凭证权限范围和账单信息提取](./dev-spec/at-credential-billing)
- [Team 升级订单维护实现](./dev-spec/team-order-maintenance)
- [子号管理实现边界](./dev-spec/subaccount-management)
