import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { MemberRoleSelect } from './MemberRoleSelect.js';

describe('MemberRoleSelect', () => {
  test('renders the current role with an accessible select', () => {
    const html = renderToStaticMarkup(
      createElement(MemberRoleSelect, {
        userId: 'user-b',
        currentRole: 'standard-user',
        loading: false,
        onConfirm: async () => undefined
      })
    );

    expect(html).toContain('aria-label="成员角色"');
    expect(html).toContain('>成员<');
  });
});
