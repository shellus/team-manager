# Team Manager 独占当前 Web Session

**Status:** Accepted

Team Manager 是业务 Web Session 的唯一持久化事实源。保存新 Session 时，在同一事务中设为当前值、删除该账号的旧 Session，并使所有旧 Access Context 失效；Session 的 `account.id` 命中已知 Workspace 时，其 Access Token 直接归入该 Workspace 上下文。

GAM 不保存账号级 Session，也不提供账号 Session 读取接口。注册成功属于唯一例外：GAM 暂存一次性交付，Team Manager 保存成功后发送确认，GAM 随即清除交付内容。普通刷新、套餐和 Workspace 操作都不得把 GAM 浏览器现场反向覆盖 Team Manager Session。

这样消除两个系统各持一份且新旧不确定的问题；代价是 Session 历史不可恢复，更新前必须由调用方确认输入正确。
