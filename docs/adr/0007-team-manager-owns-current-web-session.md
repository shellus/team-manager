# Team Manager 独占当前 Web Session

**Status:** Accepted

Team Manager 是业务 Web Session 的唯一持久化事实源。保存新 Session 时，在同一事务中设为当前值、删除该账号的旧 Session，并使所有旧 Access Context 失效；Session 的 `account.id` 命中已知 Workspace 时，其 Access Token 直接归入该 Workspace 上下文。

Access Context 保存的 Access Token 是可由长期会话凭据重新换取的短期凭证。它的无效、过期或单次 401 只影响对应访问上下文，不改变账号登录状态；只有 Refresh Token / Session Token 也无法继续建立会话时，账号登录才无效。

GAM 不保存账号级 Session。注册成功时，GAM 暂存一次性交付，Team Manager 保存成功后发送确认，GAM 随即清除交付内容。管理员也可以显式触发受管 Profile Session 刷新：GAM 使用浏览器身份归档读取当前登录态，必要时通过邮箱验证码重新登录，并只在本次服务端响应中交付新 Session；Team Manager 校验邮箱后原子替换当前 Session。普通套餐和 Workspace 操作不得隐式把 GAM 浏览器现场反向覆盖 Team Manager Session。

这样既避免两个系统长期各持一份 Session，又允许在本地 Session 失效时从既有浏览器身份恢复。Profile 刷新是管理员显式动作，交付内容不进入 GAM 账号库、操作摘要或日志。
