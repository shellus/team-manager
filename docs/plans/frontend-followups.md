# 前端后续项

- `apps/web/src/features/subaccounts/SubaccountRoutes.tsx` 的账单风险确认流程连续调用两次 `actionBusy.start('billing-risk')`。后续应移除重复调用，并补充确认、失败和关闭弹窗的 busy 状态测试。
- 当前 Vite 生产构建的主 JavaScript chunk 约 1.36 MB（gzip 约 421 KB），持续触发 500 KB 警告。后续应按路由或重型依赖拆分 chunk，并在不破坏页面首屏和弹窗状态持久化的前提下验证加载性能。
