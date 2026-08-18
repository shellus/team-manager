# 使用本地 Session 同步账号与 Workspace 关系

## 状态

已接受，2026-08-17。

账号与 Workspace 关系由 Team Manager 保存的 ChatGPT Session 直接向 ChatGPT 校准，不依赖账号是否纳入 GAM。GAM 继续负责 Profile、代理、注册和浏览器 Checkout；普通支付方式绑定由 Team Manager 直连上游。关系同步更新 Workspace 与 Membership 事实，并停用已退出关系对应的活动凭证，但不根据关系变化推断或主动失效 Workspace Token，从而让 Token 状态以实际上游请求结果为准。
