# Team Manager 只按邮箱引用 Account Manager 并独立持有业务 Session

Team Manager 继续独立保存母号、子号业务所需的 ChatGPT Web Session、Team 关系和 PAT，不依赖 GPT Account Manager 才能运行；仅对由 Account Manager 管理的账号保存规范化邮箱引用。注册密码、CloakBrowser profile、浏览器追踪和支付状态全部由 Account Manager 持有，避免两个系统同时成为浏览器账号凭据的事实源。Team Manager 可以按邮箱引用转发 Profile 启动、状态和关闭请求，但不保存 Profile ID、不直接调用 CloakBrowser，也不提供 VNC 或浏览器查看能力。

既有母号显式纳管时，Team Manager 可把自己已经持有的 ChatGPT Web Session 交给 Account Manager，用于建立 Account Manager 自己的浏览器身份归档。纳管成功只给原母号补写 `managedAccountEmail`；本地 Workspace、备注、分组和席位资料继续由 Team Manager 持有。该传递不改变密码和 Profile 的所有权边界，也不允许 Team Manager 直接操作 CloakBrowser。
