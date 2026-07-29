import { describe, expect, test } from 'vitest';
import {
  hasManagedAccountReference,
  hasPro5xFromLocalState,
  openedPro5xButtonLabel
} from './accountManagerLocalState.js';

describe('accountManagerLocalState', () => {
  test('uses the persisted GAM association as the operation capability', () => {
    expect(hasManagedAccountReference('child@example.com')).toBe(true);
    expect(hasManagedAccountReference('  ')).toBe(false);
    expect(hasManagedAccountReference()).toBe(false);
  });

  test('keeps a persisted Pro 5x state when no live status was loaded', () => {
    expect(hasPro5xFromLocalState(true)).toBe(true);
    expect(hasPro5xFromLocalState(true, false)).toBe(true);
    expect(hasPro5xFromLocalState(false, true)).toBe(true);
    expect(hasPro5xFromLocalState(false, false)).toBe(false);
  });

  test('adds a validated payment card tail to the opened button label', () => {
    expect(openedPro5xButtonLabel('4242')).toBe('已开 Pro 5x · 4242');
    expect(openedPro5xButtonLabel(' 4444 ')).toBe('已开 Pro 5x · 4444');
    expect(openedPro5xButtonLabel('42')).toBe('已开 Pro 5x');
    expect(openedPro5xButtonLabel()).toBe('已开 Pro 5x');
  });
});
