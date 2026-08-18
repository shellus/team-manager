import { describe, expect, it } from 'vitest';
import { resolvePersonalSpaceTab, selectPersonalSpaceTabParams } from './accountPersonalModel.js';

describe('个人空间子标签', () => {
  it('缺失或非法标签时进入订阅', () => {
    expect(resolvePersonalSpaceTab()).toBe('subscription');
    expect(resolvePersonalSpaceTab('unknown')).toBe('subscription');
    expect(resolvePersonalSpaceTab('billing')).toBe('billing');
  });

  it('切换标签时写入 URL 并清理不再可见的子状态', () => {
    const input = new URLSearchParams('tab=personal&personalTab=quota&quotaPage=2&modal=payment');
    expect(selectPersonalSpaceTabParams(input, 'settings').toString()).toBe(
      'tab=personal&personalTab=settings',
    );
  });
});
