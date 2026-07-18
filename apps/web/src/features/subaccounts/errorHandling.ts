import { ApiError } from '../../api.js';

export function cleanSubaccountError(error: string): string {
  return error.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

export function subaccountErrorSummary(error: string): string {
  const cleaned = cleanSubaccountError(error);
  if (/ERR_TUNNEL_CONNECTION_FAILED|ERR_PROXY_CONNECTION_FAILED/i.test(cleaned)) {
    return '浏览器代理连接失败，注册流程没有完成。';
  }
  if (/locator\.waitFor: Timeout[\s\S]*input\[type="email"\]/i.test(cleaned)) {
    return '注册页没有在规定时间内显示邮箱输入框。';
  }
  if (/locator\.waitFor: Timeout[\s\S]*input\[type="password"\]/i.test(cleaned)) {
    return '注册页没有在规定时间内显示密码输入框。';
  }
  if (/Cloudflare|CAPTCHA|人机验证/i.test(cleaned)) {
    return '浏览器连续遇到人机验证，需要人工处理。';
  }
  if (/GET \/backend-api\/me HTTP 401/i.test(cleaned)) {
    return 'Session Cookie 仍可用，但 Web Access Token 未通过远端验证。';
  }
  return cleaned.split(/\r?\n/, 1)[0] || '最近一次操作失败。';
}

export function shouldForwardSubaccountErrorToGlobal(error: unknown): boolean {
  return error instanceof ApiError && error.status === 401;
}
