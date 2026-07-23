# Team Manager 只按邮箱引用 Account Manager 并独立持有业务 Session

Team Manager 继续独立保存母号、子号业务所需的 ChatGPT Web Session、Team 关系和 PAT，不依赖 GPT Account Manager 才能运行；仅对由 Account Manager 管理的账号保存规范化邮箱引用。注册密码、CloakBrowser profile、浏览器追踪和支付状态全部由 Account Manager 持有，避免两个系统同时成为浏览器账号凭据的事实源。Team Manager 可以按邮箱引用转发 Profile 启动、状态和关闭请求，但不保存 Profile ID、不直接调用 CloakBrowser，也不提供 VNC 或浏览器查看能力。
