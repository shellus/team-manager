import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('账号状态与访问上下文健康', () => {
  it('账号列表不把 Access Token 异常显示为登录无效', () => {
    const source = readFileSync(new URL('./AccountsPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('访问凭证异常');
    expect(source).not.toContain('登录无效');
  });

  it('账号详情把 Access Token 状态明确归入访问上下文', () => {
    const source = readFileSync(new URL('./AccountDetailPage.tsx', import.meta.url), 'utf8');
    expect(source).toContain('访问凭证健康');
    expect(source).toContain('这不代表账号登录失效');
    expect(source).not.toContain('登录健康');
    expect(source).not.toContain('登录上下文');
  });
});
