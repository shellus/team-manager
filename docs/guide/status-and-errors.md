# 状态与排错

## 账号

- 无 Session 或长期会话凭据失效：账号登录状态只由 Refresh Token / Session Token 的真实可用性决定；可以使用账号编辑弹窗粘贴 Session JSON，已绑定 GAM 的账号也可显式通过受管 Profile 刷新。Access Token 无效或过期只需从可用 Session Token 换取，不代表账号登录失效。
- GAM 未关联：注册、Profile、代理和浏览器 Checkout 会返回 409；通过 GAM 纳管或注册流程建立自动关联，界面不手工填写 GAM 引用。纯 HTTP 绑卡只在账号缺少可用代理时依赖 GAM 提供代理事实。
- Profile/代理不可用：检查 GAM 健康、账号引用和运行环境 Token。
- Session 邮箱不一致：系统拒绝导入，不能覆盖账号身份。

## Workspace

- 执行账号无权限：所选账号必须在目标 Workspace 有活动 owner/admin Membership。
- Workspace Access Token 无效：先用账号的 Session Token 自动换取目标 Workspace Token；只有长期会话凭据也无法使用时才刷新账号 Session。
- 成员/邀请与页面不一致：使用 Workspace 刷新入口，不直接编辑数据库或旧 JSON。

## 套餐与支付

- `change_existing` 被拒绝：当前只验证并开放 Plus 到 Pro 5x/20x 的即时升级；Go、Pro 降级或其他付费转换仍由安全门禁拒绝。
- Plus 升级预览失败：Team Manager 不会提交订阅更新；检查当前默认支付方式、Session、账号代理和上游预览响应。
- Plus 升级提交后未收敛：上游写请求已返回成功但套餐回读未确认目标值，不能自动重复提交；刷新个人订阅与账单后再判断。
- 支付方式写入失败：绑定、设置默认和移除卡片都同步返回 ChatGPT 或 Stripe 的安全错误，并在成功后刷新账单。Stripe confirm 不写 HTTP trace，完整卡号和 CVC 不写数据库或普通日志。遇到 3DS、Radar 或结果未确认时停止提交，刷新账单后再判断，不通过操作面板恢复。
- Business Checkout 长时间未完成：查看账号“操作记录”和 GAM 对应操作。支付方式管理和取消续费是 Team Manager 直连请求，失败时查看活动日志；只有不含完整卡片的 ChatGPT 请求进入 HTTP trace。

## 个人设置

- Profile 404：该账号没有可读取的 Profile 资源；个人设置刷新仍会成功，完整上游错误保留在后端排查证据中，页面显示结构化错误摘要。
- Memory 当前值未知：上游 GET 实测返回 405；管理员仍可显式写入开启或关闭，界面不会把未知状态伪装为关闭。

## 凭证

- Workspace 不一致：凭证不能跨 Workspace，重新为目标 `Account × Workspace` 创建。
- 额度 401：确认账号仍是目标 Workspace 成员，再重新授权或创建 PAT。
- 文件哈希不一致：停止使用该凭证，检查 PostgreSQL 与制品目录是否来自同一恢复点。

## 数据库与制品

- 启动提示 migration 未应用：先备份，再显式执行 `db:migrate`。
- PostgreSQL 不可用时应用不会回退旧 JSON。
- trace、rrweb 或凭证文件丢失：用联合备份恢复，并核对数据库索引 SHA-256。
