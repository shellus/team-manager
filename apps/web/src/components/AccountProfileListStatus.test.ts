import { describe, expect, test } from 'vitest';
import { compareRunningProfileFirst } from './AccountProfileListStatus.js';

describe('account Profile list status', () => {
  test('only treats a fully running Profile as started', () => {
    const records = [{ id: 'queued' }, { id: 'running' }, { id: 'stopping' }];
    const profiles = {
      queued: { accountId: 'queued@example.com', status: 'queued' as const, updatedAt: 1 },
      running: { accountId: 'running@example.com', status: 'running' as const, updatedAt: 1 },
      stopping: { accountId: 'stopping@example.com', status: 'stopping' as const, updatedAt: 1 }
    };

    expect([...records].sort((left, right) => compareRunningProfileFirst(
      left,
      right,
      profiles,
      (a, b) => a.id.localeCompare(b.id)
    )).map((record) => record.id)).toEqual(['running', 'queued', 'stopping']);
  });
});
