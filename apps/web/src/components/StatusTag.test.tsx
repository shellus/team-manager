import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { MemberRole } from '@team-manager/shared';
import { MemberRoleTag } from './StatusTag.js';

function renderRole(role?: MemberRole): string {
  return renderToStaticMarkup(createElement(MemberRoleTag, { role }));
}

describe('MemberRoleTag', () => {
  test('uses distinct preset colors for known roles', () => {
    expect(MemberRoleTag).toBeTypeOf('function');
    expect(renderRole('analytics-viewer')).toContain('ant-tag-cyan');
    expect(renderRole('analytics-viewer')).toContain('分析者');
    expect(renderRole('standard-user')).toContain('ant-tag-green');
    expect(renderRole('standard-user')).toContain('成员');
    expect(renderRole('account-admin')).toContain('ant-tag-gold');
    expect(renderRole('account-owner')).toContain('ant-tag-magenta');
  });

  test('uses the default tag for unknown and unassigned roles', () => {
    expect(renderRole('custom-role')).toContain('custom-role');
    expect(renderRole('custom-role')).not.toMatch(/ant-tag-(cyan|green|gold|magenta)/);
    expect(renderRole()).toContain('待分配');
    expect(renderRole()).not.toMatch(/ant-tag-(cyan|green|gold|magenta)/);
  });
});
