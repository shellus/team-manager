import type { AccountManagerOperationView } from '@team-manager/shared';

export async function waitForAccountManagerOperation(
  load: () => Promise<AccountManagerOperationView>,
  timeoutMs = 90_000
): Promise<AccountManagerOperationView> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const operation = await load();
    if (operation.status === 'succeeded') return operation;
    if (operation.status === 'failed' || operation.status === 'interrupted') {
      throw new Error(operation.errorMessage || '个人支付方式绑定失败');
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error('个人支付方式绑定仍在运行，请稍后刷新账号状态');
}
