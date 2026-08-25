# Product

## Register

product

## Users

Team Manager 面向负责 ChatGPT 账号、Workspace、席位、凭证、订阅和账单的内部运营管理员。用户通常在高密度后台界面中核对远端事实、执行有明确账号与 Workspace 上下文的管理操作，并追踪操作结果。

## Product Purpose

Team Manager 以统一账号和 Workspace 关系模型集中管理 ChatGPT 运营事实。产品需要让管理员快速识别当前操作对象、区分个人空间与 Workspace、通过受控 API 执行业务操作，并以 PostgreSQL 中的结构化快照和关系记录呈现可复核结果。

核心体验从统一账号页管理 GAM、Profile、代理、Session、个人套餐和支付方式，并在账号详情的 Workspace 标签内切换空间、同步账号关系、管理成员与邀请、设置、账单及当前 `Account × Workspace` 凭证。个人空间与 Workspace 都能绑定目标支付方式和直接取消续费，已退出关系保留独立的本地清理入口。Workspace 保持独立领域实体，但不设独立管理页面；账号是否可管理 Workspace 由活动 owner/admin Membership 派生。

完整 HTTP trace、rrweb 与凭证 JSON 保持文件存储并由数据库索引。源码和公开文档不包含真实运行秘密。

## Brand Personality

准确、克制、务实。界面语气直接说明操作对象、结果和风险，不使用营销化修辞，也不以装饰干扰高频管理工作。

## Anti-references

- 不做面向营销展示的 SaaS 落地页式后台，不用大面积渐变、装饰动画或夸张指标卡承载业务操作。
- 不用自制表单、弹窗或非标准控件替代现有 Ant Design 与产品级组件。
- 不隐藏账号、Workspace、席位和凭证之间的上下文边界，不用模糊成功提示掩盖上游失败或未知状态。

## Design Principles

- 操作上下文优先：任何写操作都明确展示并传递目标账号、Workspace 或个人空间。
- 事实不互相覆盖：未知、远端快照、本地关系和运营资料分别呈现，不用默认值伪装缺失事实。
- 熟悉的后台交互：复用统一组件、反馈、分页和 URL 状态约定，让相同动作保持相同用法。
- 高密度但可扫描：关键信息使用表格、标签和紧凑工具栏组织，风险说明紧邻对应动作。
- 操作结果可复核：成功后读取或同步最新状态，错误信息保留可执行的上游语义。

## Accessibility & Inclusion

界面支持亮色与深色主题、键盘可聚焦的标准控件、减少动态效果偏好以及最窄 320px 的响应式布局。文字和状态不能只依赖颜色表达；项目当前未声明特定 WCAG 合规等级。
