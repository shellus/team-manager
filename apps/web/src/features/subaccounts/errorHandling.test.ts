import { describe, expect, test } from 'vitest';
import { ApiError } from '../../api.js';
import { shouldForwardSubaccountErrorToGlobal } from './errorHandling.js';

describe('subaccount error handling', () => {
  test('keeps operation errors local to avoid duplicate alerts', () => {
    expect(shouldForwardSubaccountErrorToGlobal(new ApiError(409, 'workspace mismatch', '/subaccounts/x'))).toBe(false);
    expect(shouldForwardSubaccountErrorToGlobal(new Error('普通错误'))).toBe(false);
  });

  test('still forwards expired login errors to the app shell', () => {
    expect(
      shouldForwardSubaccountErrorToGlobal(new ApiError(401, '登录已失效，请重新登录', '/subaccounts'))
    ).toBe(true);
  });
});
