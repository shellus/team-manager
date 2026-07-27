# 测试后续事项

- `apps/server/src/teamOrderService.test.ts` 偶发在测试临时目录已经清理后继续执行异步 `chmod`，产生 `ENOENT .../team-orders.json` 的 test runner 异步活动告警并导致整套 Server 测试失败。Pro 5x 相关测试和单独的 `parentAccountManagerService.test.ts` 均通过；后续应让 TeamOrderService 测试显式等待所有持久化异步工作结束后再删除临时目录。
