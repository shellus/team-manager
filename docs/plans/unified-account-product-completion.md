# 统一账号产品功能补全计划

状态：后端闭环已实施，等待前端合并与运行实例联合验收。

## 后端实施记录

以下能力已经在 PostgreSQL 服务层、受鉴权 API 和持久后台任务中实现：

- 统一 Operation 查询、阶段事件、支付摘要、完成/生效时间、GAM 控制、补卡、清理和终态账号收敛；
- GAM 同步个人订阅、支付方式、可见 Workspace 和 Membership；个人订阅操作前实时校验；
- 完整 Session 读取/更新，个人订阅、账单、额度、设置、Activity Log 与账号分组排序；
- Workspace 订阅、结构化账单/发票、全部已支持设置的多字段更新，以及成员/邀请变更后的凭证资格重算；
- SeatSlot CRUD、释放、人工/公开换号历史、到期提醒去重、停用和可选移除；
- OAuth/PAT、凭证原文、替换/停用/删除、号池分组、额度刷新和可配置 CPA 原子投放；
- TeamCode 持久订单调度、启动恢复、运行/暂停/重试/删除；通知测试/投递/重试；系统设置；
- trace、rrweb、凭证和隔离制品的原文读取、哈希复核、认领/丢弃、保留周期、宽限期和孤儿清理；
- operation、订单、通知、席位到期与制品清理后台任务随服务启动并在关闭时停止。

前端入口、移动布局、401 行为以及 GAM 四套餐状态机由对应并行分支实现；完成状态以所有分支合并后的联合验收为准。

本文是统一账号 PostgreSQL 重构的产品补全台账。旧计划完成了领域模型、数据库、一次性迁移和基础页面，但“存在表、Repository、API 或只读 JSON”不等于功能完成。本计划以用户可以从 Team Manager 完成操作、观察进度、处理失败并看到最终状态为验收标准。

## 产品边界

- 本项目是单管理员个人运营工具，不以公共网站的展示最小化规则限制调试能力。
- 管理员界面和受鉴权 API 可以完整显示或下载 Session、上游账单 JSON、HTTP trace、rrweb、操作请求与响应、代理和浏览器现场。原始证据作为调试入口保留，结构化页面不能被原始 JSON 替代。
- HTTP trace、rrweb 和 OAuth/PAT JSON 正文继续存文件；PostgreSQL 只保存结构化业务数据和文件索引。
- 所有受管登录身份都是 Account。Workspace owner/admin 是 Membership 能力，不恢复母号、子号或兼容路由。
- 付费个人套餐互切在上游协议未验证前继续返回 409，不把猜测实现计入完成范围；首次开通、同套餐幂等、取消续费和结果刷新必须闭环。

## 共享接口约定

新增 API 保持 `/api/accounts`、`/api/workspaces`、`/api/operations`、`/api/settings` 主边界：

- `POST /accounts/:id/sync`：同步 GAM 账号、个人订阅、支付摘要和可见 Workspace，并收敛 Membership。
- `GET /operations/:id`、`POST /operations/:id/controls/:control`、`PUT /operations/:id/payment-card`、`DELETE /operations/:id`：统一操作查询、重试、换 IP、终止、补卡和清理。
- `POST /accounts/:id/personal-space/refresh`：刷新个人订阅、账单、额度和设置；各子资源允许单独刷新。
- `GET /accounts/:id/session`、`PUT /accounts/:id/session`：管理员读取和更新完整 Session。
- `GET /workspaces/:id/billing`、`GET /workspaces/:id/billing/invoices/:invoiceId`：结构化账单、发票和原始载荷。
- `GET/POST/PATCH/DELETE /workspaces/:id/seat-slots`：客户席位管理；公开换号仍使用 `/public/seat-slots/:seatKey`。
- `GET/POST/PATCH/DELETE /credential-pool-groups` 与凭证读取、下载、停用、替换和删除 API。
- `GET/POST /artifacts`、`GET /artifacts/:kind/:id`、`DELETE /artifacts/:kind/:id`：trace、rrweb 与隔离制品管理；删除遵守隔离和宽限期。
- `POST /team-orders/run`、维护关系运行/暂停/重试/删除 API。
- `POST /settings/notification-policies/:kind/test` 和投递历史 API。

具体共享类型以 `packages/shared` 为准。前端不得使用 `any` 复制一套接口模型。

## 验收台账

### 阶段 A：套餐、GAM 与操作闭环

- [ ] A1. GAM 的 Go、Plus、Pro 5x、Pro 20x 首次开通共用通用命名、状态和测试；只有 Pro 5x 促销策略保留套餐特例。
- [ ] A2. Go、Plus、Pro 5x、Pro 20x 取消续费均按实时个人订阅执行，同套餐重复取消幂等成功。
- [ ] A3. Team Manager 发起操作前实时同步个人订阅并校验 `start_new`、`change_existing` 和同套餐幂等。
- [ ] A4. 套餐、支付和 Business 操作持续同步 GAM 状态，保存阶段事件、支付结果摘要、生效时间和错误。
- [ ] A5. 操作支持重试当前步骤、轮换 IP、终止、补卡、清理；注册任务使用同一操作控制面。
- [ ] A6. Business 页面支持创建新 Workspace 和升级既有 Workspace，支持保存支付方式、新卡、自动提交及人工接管。
- [ ] A7. GAM 同步把新建/升级 Workspace、Membership、个人订阅和支付方式收敛到 PostgreSQL。

### 阶段 B：账号与个人空间

- [ ] B1. 账号列表实现分组、可管理空间、普通成员、凭证、GAM、Profile、Session、套餐、封号和关键词的 URL 可恢复三态筛选。
- [ ] B2. 账号设置可编辑分组、备注、显示名、封号、限额类型、GAM 绑定、账号代理和完整 Session。
- [ ] B3. 个人订阅显示实时套餐、续费、有效期、生效时间、原始代码和操作结果。
- [ ] B4. 个人账单显示摘要、发票、支付历史与原始 JSON。
- [ ] B5. 个人额度显示窗口和刷新结果。
- [ ] B6. 个人资料与设置支持用户名、显示名、通知和 Memory 等上游返回字段，同时保留原始 JSON。
- [ ] B7. Account Activity Log 可查询；重要本地与上游操作继续追加日志。
- [ ] B8. AccountGroup 支持稳定排序。

### 阶段 C：Workspace

- [ ] C1. Workspace 订阅实时刷新并保存快照。
- [ ] C2. Workspace 账单解析席位、金额、周期、续费、支付方式、Upcoming invoice 和发票，同时保留原始 JSON。
- [ ] C3. Workspace 设置提供全部已支持字段的结构化控件，允许一次更新多个字段并支持重命名。
- [ ] C4. 成员和邀请均可选择角色与席位；角色、席位、移除和撤销失败可恢复。
- [ ] C5. Account 内 Workspace 上下文路由可直接访问，Tab、执行账号和弹窗状态可刷新恢复。
- [ ] C6. `/overview/workspaces` 与 `/overview/seats` 提供跨空间运营总览。

### 阶段 D：客户席位

- [ ] D1. SeatSlot 可创建、编辑、停用和删除，字段包含邮箱、联系方式、备注、价格、到期日、席位类型和稳定访问键。
- [ ] D2. SeatSlot 支持释放失联占用、复制公开链接和管理员人工换号。
- [ ] D3. 到期提醒、到期停用和可配置移除策略由持久后台任务执行。
- [ ] D4. 公开换号接口返回当前操作步骤和历史；刷新页面后进度与结果不丢失。

### 阶段 E：凭证与号池

- [ ] E1. 支持 OAuth 和 PAT 两种凭证创建。
- [ ] E2. 凭证支持完整 JSON 读取/下载、停用、重新授权、替换和受控删除。
- [ ] E3. CredentialPoolGroup 支持列表、创建、重命名、排序和安全删除。
- [ ] E4. Membership/Invitation 生命周期变化自动重算凭证资格，保留历史而不伪造上游撤销。
- [ ] E5. CPA 投放使用可配置文件目标和原子替换，投放结果进入操作记录。

### 阶段 F：订单、通知与文件制品

- [ ] F1. Team 订单维护实现持久调度、立即运行、批量生成、暂停、重试、删除、启动恢复和状态收敛。
- [ ] F2. 通知策略实现测试、实际投递、失败重试和投递历史。
- [ ] F3. 系统设置和表单偏好接入 `system_settings`。
- [ ] F4. rrweb 支持前端录制、上传、列表、读取和回放；原始 gzip 可下载。
- [ ] F5. trace、rrweb、凭证和隔离制品支持管理员列表、原始读取/下载和元数据查询。
- [ ] F6. 制品后台任务实现孤儿扫描、待删除隔离、宽限期清理、保留周期和哈希复核。
- [ ] F7. 隔离凭证支持查看原始 JSON、认领到 Account × Workspace 或明确丢弃。

### 阶段 G：产品质量与交付

- [ ] G1. 401 自动退出登录；所有页面有加载、空状态、错误、重试和操作反馈。
- [ ] G2. 桌面与移动布局可用，表格允许横向滚动，表单与弹窗不溢出。
- [ ] G3. 共享标签、状态、套餐、角色和错误文案一致，深浅主题均可读。
- [ ] G4. 后端服务、数据库集成、Web 关键流程和 GAM 状态机有回归测试，不以类型检查替代行为测试。
- [ ] G5. 类型检查、测试、构建、文档构建、数据库 migration、重启恢复和运行实例冒烟全部通过。
- [ ] G6. README、领域文档、使用手册和本台账与最终实现一致；不再宣称未完成模块已经交付。

## 实施顺序

1. 先完成共享合同、数据库 migration、GAM 通用合同和统一 Operation 控制面。
2. 完成个人空间、Workspace、凭证、SeatSlot 等后端闭环。
3. 完成订单、通知、制品清理等后台任务，并验证重启恢复。
4. 按新合同重做前端操作面和总览，不删除原始调试入口。
5. 补足自动测试，再在隔离数据和当前开发实例执行冒烟。
6. 更新文档、提交各 Git 边界并重启开发进程。

## 完成定义

勾选项必须同时满足：有稳定入口、有权限与输入校验、有成功状态、有失败恢复、有最终数据收敛、有自动测试或可重复的集成验收。仅创建表、保存 JSON、展示只读列表或转发上游请求不能勾选。
