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
        status="running"
        phase="registration_profile_filled"
        onCancel={() => undefined}
      />
    );

    expect(html).toContain('pending@example.com');
    expect(html).toContain('账号管理');
    expect(html).toContain('住宅代理配置');
    expect(html).toContain('取消任务');
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
        status="running"
        phase="registration_password_filled"
        onCancel={() => undefined}
      />
    );

    expect(html).toContain('pending-child@example.com');
    expect(html).toContain('账号管理');
    expect(html).toContain('住宅代理配置');
    expect(html).not.toContain('更换IP');
  });

  test('shows a user-cancelled registration without an active cancel action', () => {
    const html = renderToStaticMarkup(
      <PendingRegistrationAccountManagerDetail
        recordLabel="子号"
        operationId="registration-cancelled"
        email="cancelled@example.com"
        message="注册任务已取消"
        progress={56}
        status="interrupted"
        phase="registration_cancelled"
        failed
      />
    );

    expect(html).toContain('已取消');
    expect(html).not.toContain('取消任务');
  });
});
