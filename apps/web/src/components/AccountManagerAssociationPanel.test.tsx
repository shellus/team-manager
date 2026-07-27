import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { AccountManagerAssociationPanel } from './AccountManagerAssociationPanel.js';

describe('AccountManagerAssociationPanel', () => {
  test('renders the managed account reference and parent capability state', () => {
    const html = renderToStaticMarkup(
      <AccountManagerAssociationPanel
        recordLabel="母号"
        recordId="parent-1"
        managedAccountEmail="owner@example.com"
        status={{
          configured: true,
          reachable: true,
          managed: true,
          hasCodexSpace: true,
          hasTeamSubscription: false
        }}
      />
    );

    expect(html).toContain('GPT Account Manager 关联');
    expect(html).toContain('owner@example.com');
    expect(html).toContain('GAM');
    expect(html).toContain('0.52');
    expect(html).not.toContain('未开双席位');
    expect(html).toContain('启动 Profile');
    expect(html).toContain('关闭 Profile');
  });

  test('explains when a parent account is not associated with GAM', () => {
    const html = renderToStaticMarkup(
      <AccountManagerAssociationPanel
        recordLabel="母号"
        recordId="parent-1"
        status={{
          configured: true,
          reachable: true,
          managed: false,
          hasCodexSpace: false,
          hasTeamSubscription: true
        }}
      />
    );

    expect(html).toContain('该母号独立录入，未关联 GPT Account Manager');
    expect(html).toContain('纳入 GAM 管理');
  });

  test('shows the current GAM enrollment operation and prevents duplicate starts', () => {
    const html = renderToStaticMarkup(
      <AccountManagerAssociationPanel
        recordLabel="母号"
        recordId="parent-1"
        status={{
          configured: true,
          reachable: true,
          managed: false,
          hasCodexSpace: false,
          hasTeamSubscription: true,
          enrollmentOperation: {
            id: 'import-1',
            type: 'import',
            status: 'running',
            phase: 'login_opening',
            message: '正在打开登录页',
            progress: 10,
            createdAt: 1,
            updatedAt: 1
          }
        }}
      />
    );

    expect(html).toContain('正在登录');
    expect(html).toContain('正在打开登录页');
    expect(html).toContain('disabled');
  });

  test('does not show a missing 0.52 state for a Team subscription', () => {
    const html = renderToStaticMarkup(
      <AccountManagerAssociationPanel
        recordLabel="母号"
        managedAccountEmail="owner@example.com"
        status={{
          configured: true,
          reachable: true,
          managed: true,
          hasCodexSpace: false,
          hasTeamSubscription: true
        }}
      />
    );

    expect(html).toContain('双席位');
    expect(html).not.toContain('未开 0.52');
  });
});
