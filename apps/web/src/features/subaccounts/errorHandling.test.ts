import { describe, expect, test } from 'vitest';
import { ApiError } from '../../api.js';
import {
  cleanSubaccountError,
  shouldForwardSubaccountErrorToGlobal,
  subaccountErrorSummary
} from './errorHandling.js';

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

  test('turns raw browser failures into compact operator-facing summaries', () => {
    expect(subaccountErrorSummary('locator.waitFor: Timeout 30000ms exceeded.\n- waiting for input[type="email"]')).toBe(
      '注册页没有在规定时间内显示邮箱输入框。'
    );
    expect(subaccountErrorSummary('page.goto: net::ERR_TUNNEL_CONNECTION_FAILED')).toBe(
      '浏览器代理连接失败，注册流程没有完成。'
    );
    expect(subaccountErrorSummary('个人资料同步失败: GET /backend-api/me HTTP 401: {}')).toBe(
      'Session Cookie 仍可用，但 Web Access Token 未通过远端验证。'
    );
  });

  test('removes terminal formatting codes without changing the stored error', () => {
    expect(cleanSubaccountError('\u001b[2m- waiting for navigation\u001b[22m')).toBe('- waiting for navigation');
  });
});
