import { describe, expect, test } from 'vitest';
import { parentListIdentity, parentSeatUsageClass } from './parentListItem.js';

describe('parentListIdentity', () => {
  test('uses remark and email on one line when the parent has a remark', () => {
    expect(parentListIdentity({ remark: 'team3', email: 'owner@example.com' })).toBe('team3 · owner@example.com');
  });

  test('falls back to email without repeating it when remark is missing or already the email', () => {
    expect(parentListIdentity({ remark: '', email: 'owner@example.com' })).toBe('owner@example.com');
    expect(parentListIdentity({ remark: 'Owner@Example.com', email: 'owner@example.com' })).toBe('owner@example.com');
  });
});

describe('parentSeatUsageClass', () => {
  test('uses success only when ChatGPT seats exactly reach the included count', () => {
    expect(parentSeatUsageClass(2, 2)).toBe('text-success');
  });

  test('keeps over-capacity ChatGPT seats as a warning state', () => {
    expect(parentSeatUsageClass(3, 2)).toBe('text-warning');
    expect(parentSeatUsageClass(1, 2)).toBeUndefined();
    expect(parentSeatUsageClass(undefined, 2)).toBeUndefined();
  });
});
