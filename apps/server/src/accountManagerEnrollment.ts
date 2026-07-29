import type { AccountManagerOperationView } from '@team-manager/shared';

export function isAccountEnrollmentOperation(operation: AccountManagerOperationView): boolean {
  return operation.type === 'import';
}

export function accountEnrollmentOperationEmail(
  operation: AccountManagerOperationView
): string | undefined {
  const requestEmail = operation.requestSummary?.email;
  const email = typeof requestEmail === 'string'
    ? requestEmail
    : operation.accountId || operation.email;
  return email?.trim().toLowerCase() || undefined;
}

export function findLatestAccountEnrollmentOperation(
  operations: AccountManagerOperationView[],
  email: string
): AccountManagerOperationView | undefined {
  const target = email.trim().toLowerCase();
  return operations
    .filter((operation) => isAccountEnrollmentOperation(operation)
      && accountEnrollmentOperationEmail(operation) === target)
    .sort((left, right) => right.createdAt - left.createdAt)[0];
}

export function isTerminalAccountEnrollmentOperation(
  operation: AccountManagerOperationView
): boolean {
  return operation.status === 'succeeded'
    || operation.status === 'failed'
    || operation.status === 'interrupted';
}
