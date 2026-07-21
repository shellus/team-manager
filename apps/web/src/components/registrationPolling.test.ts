import { describe, expect, test } from 'vitest';
import {
  parentRegistrationStageNeedsPolling,
  registrationStatusNeedsPolling
} from './registrationPolling.js';

describe('registration polling', () => {
  test('keeps polling a parent registration while automatic or manual monitoring is active', () => {
    expect(parentRegistrationStageNeedsPolling('registering')).toBe(true);
    expect(parentRegistrationStageNeedsPolling('waiting_manual')).toBe(true);
    expect(parentRegistrationStageNeedsPolling('registration_failed')).toBe(false);
    expect(parentRegistrationStageNeedsPolling('completed')).toBe(false);
  });

  test('keeps polling child registration jobs through waiting_manual', () => {
    expect(registrationStatusNeedsPolling('queued')).toBe(true);
    expect(registrationStatusNeedsPolling('running')).toBe(true);
    expect(registrationStatusNeedsPolling('waiting_manual')).toBe(true);
    expect(registrationStatusNeedsPolling('failed')).toBe(false);
    expect(registrationStatusNeedsPolling('succeeded')).toBe(false);
  });
});
