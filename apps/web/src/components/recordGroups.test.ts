import { describe, expect, test } from 'vitest';
import {
  ALL_LOCAL_GROUP,
  resolvePreferredLocalGroup,
  type LocalGroupCount
} from './recordGroups.js';

const groups: LocalGroupCount[] = [
  { name: '客户 A', count: 2 },
  { name: '客户 B', count: 1 }
];

describe('resolvePreferredLocalGroup', () => {
  test('uses an explicit valid URL group before the remembered preference', () => {
    expect(resolvePreferredLocalGroup('客户 B', '客户 A', groups)).toBe('客户 B');
  });

  test('restores the remembered group when the URL does not specify one', () => {
    expect(resolvePreferredLocalGroup(undefined, '客户 B', groups)).toBe('客户 B');
    expect(resolvePreferredLocalGroup(undefined, ALL_LOCAL_GROUP, groups)).toBe(ALL_LOCAL_GROUP);
  });

  test('selects the first actual group when no usable preference exists', () => {
    expect(resolvePreferredLocalGroup(undefined, undefined, groups)).toBe('客户 A');
    expect(resolvePreferredLocalGroup('已删除分组', '同样已删除', groups)).toBe('客户 A');
  });

  test('falls back to all only when there are no actual groups', () => {
    expect(resolvePreferredLocalGroup(undefined, undefined, [])).toBe(ALL_LOCAL_GROUP);
  });
});
