import { describe, expect, test } from 'vitest';
import {
  editableMemberRoleOptions,
  memberRoleConfirmation,
  roleLabel
} from './labels.js';

describe('member role UI metadata', () => {
  test('labels every writable role', () => {
    expect(roleLabel('analytics-viewer')).toBe('分析者');
    expect(roleLabel('standard-user')).toBe('成员');
    expect(roleLabel('account-admin')).toBe('管理员');
    expect(roleLabel('account-owner')).toBe('所有者');
  });

  test('keeps an unknown current role visible as a disabled option', () => {
    expect(editableMemberRoleOptions('custom-remote-role')).toEqual([
      { value: 'custom-remote-role', label: 'custom-remote-role', disabled: true },
      { value: 'analytics-viewer', label: '分析者' },
      { value: 'standard-user', label: '成员' },
      { value: 'account-admin', label: '管理员' },
      { value: 'account-owner', label: '所有者' }
    ]);
  });

  test('marks owner promotion and demotion as dangerous', () => {
    expect(memberRoleConfirmation('standard-user', 'account-owner')).toMatchObject({
      danger: true,
      confirmOwnerRisk: true
    });
    expect(memberRoleConfirmation('account-owner', 'account-admin')).toMatchObject({
      danger: true,
      confirmOwnerRisk: true
    });
    expect(memberRoleConfirmation('standard-user', 'account-admin')).toMatchObject({
      danger: false,
      confirmOwnerRisk: false
    });
  });
});
