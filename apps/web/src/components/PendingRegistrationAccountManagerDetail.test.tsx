import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { PendingRegistrationAccountManagerDetail } from './PendingRegistrationAccountManagerDetail.js';

describe('PendingRegistrationAccountManagerDetail', () => {
  test('exposes only account management before a parent registration succeeds', () => {
    const html = renderToStaticMarkup(
      <PendingRegistrationAccountManagerDetail
        recordLabel="母号"
        operationId="registration-1"
        email="pending@example.com"
        message="正在填写账号资料"
        progress={76}
      />
    );

    expect(html).toContain('pending@example.com');
    expect(html).toContain('账号管理');
    expect(html).toContain('住宅代理配置');
    expect(html).not.toContain('成员');
    expect(html).not.toContain('更换IP');
  });

  test('exposes the same proxy configuration before a child registration succeeds', () => {
    const html = renderToStaticMarkup(
      <PendingRegistrationAccountManagerDetail
        recordLabel="子号"
        operationId="registration-child"
        email="pending-child@example.com"
        message="正在注册子号"
        progress={42}
      />
    );

    expect(html).toContain('pending-child@example.com');
    expect(html).toContain('账号管理');
    expect(html).toContain('住宅代理配置');
    expect(html).not.toContain('更换IP');
  });
});
