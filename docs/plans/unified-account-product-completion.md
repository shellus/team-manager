# 统一账号产品功能补全计划

状态：已实施并通过联合验收。付费个人套餐互切与 Memory 当前值读取仍受已记录的上游协议边界限制。

## 后端实施记录

以下能力已经在 PostgreSQL 服务层、受鉴权 API 和持久后台任务中实现：

- 统一 Operation 查询、阶段事件、支付摘要、完成/生效时间、GAM 控制、补卡、清理和终态账号收敛；
- GAM 同步个人订阅、支付方式、可见 Workspace 和 Membership；个人订阅操作前实时校验；
- 完整 Session 读取/更新，个人订阅、账单、额度、设置、Activity Log 与账号分组排序；
- Workspace 订阅、结构化账单/发票、全部已支持设置的多字段更新，以及成员/邀请变更后的凭证资格重算；
- SeatSlot CRUD、释放、人工/公开换号历史、到期提醒去重、停用和可选移除；
- OAuth/PAT、凭证原文、替换/停用/删除、号池分组、额度刷新和可配置 CPA 原子投放；
- TeamCode 持久订单调度、启动恢复、运行/暂停/重试/删除；通知测试/投递/重试；系统设置；
- trace、rrweb、凭证和隔离制品的文件索引、哈希复核、认领/丢弃、保留周期、宽限期和孤儿清理；正文只保存在受控文件制品中；
- operation、订单、通知、席位到期与制品清理后台任务随服务启动并在关闭时停止。

前端入口、移动布局、401 行为以及 GAM 四套餐状态机由对应并行分支实现；完成状态以所有分支合并后的联合验收为准。

本文是统一账号 PostgreSQL 重构的产品补全台账。旧计划完成了领域模型、数据库、一次性迁移和基础页面，但“存在表、Repository、API 或只读 JSON”不等于功能完成。本计划以用户可以从 Team Manager 完成操作、观察进度、处理失败并看到最终状态为验收标准。

## 产品边界

- 本项目是单管理员个人运营工具，不对业务字段做脱敏，也不因公共网站假设增加调试障碍。
- 只有 Session JSON 提供完整读取和编辑入口。上游账单、HTTP trace、操作请求与响应、凭证和浏览器现场保留为数据库日志或文件证据，但 Web UI 只提供结构化业务字段、日志摘要、元数据和 rrweb 可视化回放，不提供 JSON 原文查看、编辑或下载。
- HTTP trace、rrweb 和 OAuth/PAT JSON 正文继续存文件；PostgreSQL 只保存结构化业务数据和文件索引。
- 所有受管登录身份都是 Account。Workspace owner/admin 是 Membership 能力，不恢复母号、子号或兼容路由。
- 付费个人套餐互切在上游协议未验证前继续返回 409，不把猜测实现计入完成范围；首次开通、同套餐幂等、取消续费和结果刷新必须闭环。

## 共享接口约定

新增 API 保持 `/api/accounts`、`/api/workspaces`、`/api/operations`、`/api/settings` 主边界：

- `POST /accounts/:id/sync`：同步 GAM 账号、个人订阅、支付摘要和可见 Workspace，并收敛 Membership。
- `GET /operations/:id`、`POST /operations/:id/controls/:control`、`PUT /operations/:id/payment-card`、`DELETE /operations/:id`：统一操作查询、重试、换 IP、终止、补卡和清理。
- `POST /accounts/:id/personal-space/refresh`：刷新个人订阅、账单、额度和设置；各子资源允许单独刷新。
- `GET /accounts/:id/session`、`PUT /accounts/:id/session`：管理员读取和更新完整 Session。
- `GET /workspaces/:id/billing`、`GET /workspaces/:id/billing/invoices/:invoiceId`：结构化账单和发票；普通页面合同不透传原始载荷。
- `GET/POST/PATCH/DELETE /workspaces/:id/seat-slots`：客户席位管理；公开换号仍使用 `/public/seat-slots/:seatKey`。
- `GET/POST/PATCH/DELETE /credential-pool-groups` 与凭证停用、重新授权、替换、投放和删除 API；正文不进入 Web UI。
- `GET/POST /artifacts`、`GET /artifacts/:kind/:id`、`DELETE /artifacts/:kind/:id`：trace、rrweb 与隔离制品管理；删除遵守隔离和宽限期。
- `POST /team-orders/run`、维护关系运行/暂停/重试/删除 API。
- `POST /settings/notification-policies/:kind/test` 和投递历史 API。

具体共享类型以 `packages/shared` 为准。前端不得使用 `any` 复制一套接口模型。

## 验收台账

### 阶段 A：套餐、GAM 与操作闭环

- [x] A1. GAM 的 Go、Plus、Pro 5x、Pro 20x 首次开通共用通用命名、状态和测试；只有 Pro 5x 促销策略保留套餐特例。
- [x] A2. Go、Plus、Pro 5x、Pro 20x 取消续费均按实时个人订阅执行，同套餐重复取消幂等成功。
- [x] A3. Team Manager 发起操作前实时同步个人订阅并校验 `start_new`、`change_existing` 和同套餐幂等。
- [x] A4. 套餐、支付和 Business 操作持续同步 GAM 状态，保存阶段事件、支付结果摘要、生效时间和错误。
- [x] A5. 操作支持重试当前步骤、轮换 IP、终止、补卡、清理；注册任务使用同一操作控制面。
- [x] A6. Business 页面支持创建新 Workspace 和升级既有 Workspace，支持保存支付方式、新卡、自动提交及人工接管。
- [x] A7. GAM 同步把新建/升级 Workspace、Membership、个人订阅和支付方式收敛到 PostgreSQL。

### 阶段 B：账号与个人空间

- [x] B1. 账号列表实现展开的分组快捷筛选；每个分组数量基于当前关键词、主套餐、GAM、Profile 运行与封号可见性等其他筛选条件实时计算，切换分组不会改变计数基准。主套餐保持 URL 可恢复选择；GAM 与 Profile 运行各使用“是/否”两枚互斥 Checkbox，均不选表示所有，URL 保存最终三态。可管理空间、普通成员、凭证、Session 及 Workspace/凭证数量不再出现在列表筛选或字段中。“显示封号”默认不勾选并隐藏人工封号账号，勾选后同时显示正常与封号账号，并在账号字段使用错误状态徽标标识。
- [x] B2. 账号设置可编辑分组、备注、显示名、封号、限额类型、GAM 绑定、账号代理和完整 Session。
- [x] B3. 个人订阅显示实时套餐、续费、有效期、生效时间、规范化上游代码和操作结果。
- [x] B4. 个人账单显示摘要、Upcoming invoice、发票、支付方式与账单主体，不用原始 JSON 替代页面。
- [x] B5. 个人额度显示窗口和刷新结果。
- [x] B6. 个人资料与设置支持用户名、显示名、通知和 Memory 写入；Memory GET 实测 405，因此当前值明确显示未知。
- [x] B7. Account Activity Log 可查询；重要本地与上游操作继续追加日志。
- [x] B8. AccountGroup 支持稳定排序。

### 阶段 C：Workspace

- [x] C1. Workspace 订阅实时刷新并保存快照。
- [x] C2. Workspace 账单结构化解析席位、金额、周期、续费、支付方式、Upcoming invoice 和发票；原始证据留在后端快照，不进入 Web UI。
- [x] C3. Workspace 设置提供全部已支持字段的结构化控件，允许一次更新多个字段并支持重命名。
- [x] C4. 成员和邀请均可选择角色与席位；角色、席位、移除和撤销失败可恢复。
- [x] C5. Account 内 Workspace 上下文路由可直接访问，Tab、执行账号和弹窗状态可刷新恢复。
- [x] C6. `/overview/workspaces` 与 `/overview/seats` 提供跨空间运营总览。

### 阶段 D：客户席位

- [x] D1. SeatSlot 可创建、编辑、停用和删除，字段包含邮箱、联系方式、备注、价格、到期日、席位类型和稳定访问键。
- [x] D2. SeatSlot 支持释放失联占用、复制公开链接和管理员人工换号。
- [x] D3. 到期提醒、到期停用和可配置移除策略由持久后台任务执行。
- [x] D4. 公开换号接口返回当前操作步骤和历史；刷新页面后进度与结果不丢失。

### 阶段 E：凭证与号池

- [x] E1. 支持 OAuth 和 PAT 两种凭证创建。
- [x] E2. 凭证支持停用、重新授权、替换、投放和受控删除；JSON 正文仅作文件制品，不提供 Web 原文入口。
- [x] E3. CredentialPoolGroup 支持列表、创建、重命名、排序和安全删除。
- [x] E4. Membership/Invitation 生命周期变化自动重算凭证资格，保留历史而不伪造上游撤销。
- [x] E5. CPA 投放使用可配置文件目标和原子替换，投放结果进入操作记录。

### 阶段 F：订单、通知与文件制品

- [x] F1. Team 订单维护实现持久调度、立即运行、批量生成、暂停、重试、删除、启动恢复和状态收敛。
- [x] F2. 通知策略实现测试、实际投递、有限失败重试和投递历史。
- [x] F3. 系统设置和表单偏好接入 `system_settings`，录制、自动刷新与非敏感表单记忆实际消费偏好。
- [x] F4. rrweb 支持前端原文录制、上传、列表和可视化回放；原始 gzip 不提供 Web 下载。
- [x] F5. trace、rrweb、凭证和隔离制品支持管理员索引、结构化元数据和生命周期查询，不提供原始读取/下载 UI。
- [x] F6. 制品后台任务实现孤儿扫描、待删除隔离、宽限期清理、保留周期和哈希复核。
- [x] F7. 隔离凭证支持按索引认领到 Account × Workspace 或明确丢弃，不在认领页面显示原始 JSON。

### 阶段 G：产品质量与交付

- [x] G1. 401 自动退出登录；所有页面有加载、空状态、错误、重试和操作反馈。
- [x] G2. 桌面与移动布局可用，表格允许横向滚动，表单与弹窗不溢出。
- [x] G3. 共享标签、状态、套餐、角色和错误文案一致，深浅主题均可读。
- [x] G4. 后端服务、数据库集成、Web 关键流程和 GAM 状态机有回归测试，不以类型检查替代行为测试。
- [x] G5. 类型检查、测试、构建、文档构建、数据库 migration、重启恢复和运行实例冒烟全部通过。
- [x] G6. README、领域文档、使用手册和本台账与最终实现一致；不再宣称未完成模块已经交付。

## 联合验收结果

- Team Manager Server 测试 16/16、Web 测试 34/34、随机临时 PostgreSQL 集成测试 1/1；
- GAM 测试 214/214，Business 升级合同覆盖生产浏览器适配器到 `existing_workspace_id` 载荷边界；
- 全仓类型检查、生产构建、VitePress 文档构建、migration 001–008、开发数据库状态检查和开发进程重启通过；
- 运行实例的主要 API、历史账单 envelope、外部发票 ID，以及 Chromium 登录、账号列表/详情、Workspace、运营总览、订单、制品和设置冒烟通过；移动端深色 390px 页面无页面级横向溢出，浏览器无 console error 或 page error；
- 未执行真实付费、真实套餐变更或不可逆上游操作。

## 后续事项

- 浏览器会自动请求当前尚未提供的 `/favicon.ico`，开发控制台因此出现一个不影响页面功能的 404；后续补充正式产品图标时一并消除。

## 实施顺序

1. 先完成共享合同、数据库 migration、GAM 通用合同和统一 Operation 控制面。
2. 完成个人空间、Workspace、凭证、SeatSlot 等后端闭环。
3. 完成订单、通知、制品清理等后台任务，并验证重启恢复。
4. 按新合同重做前端操作面和总览，删除 Session 之外的原始 JSON 入口。
5. 补足自动测试，再在隔离数据和当前开发实例执行冒烟。
6. 更新文档、提交各 Git 边界并重启开发进程。

## 完成定义

勾选项必须同时满足：有稳定入口、有权限与输入校验、有成功状态、有失败恢复、有最终数据收敛、有自动测试或可重复的集成验收。仅创建表、保存 JSON、展示只读列表或转发上游请求不能勾选。
