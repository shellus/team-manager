import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { AccountManagerAssociationPanel } from './AccountManagerAssociationPanel.js';

describe('AccountManagerAssociationPanel', () => {
  test('renders the managed account reference and parent capability state', () => {
    const html = renderToStaticMarkup(
      <AccountManagerAssociationPanel
        recordLabel="母号"
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
    expect(html).toContain('未开双席位');
  });

  test('explains when a parent account is not associated with GAM', () => {
    const html = renderToStaticMarkup(
      <AccountManagerAssociationPanel recordLabel="母号" />
    );

    expect(html).toContain('该母号独立录入，未关联 GPT Account Manager');
  });
});
