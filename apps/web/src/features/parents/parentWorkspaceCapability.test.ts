import { describe, expect, test } from 'vitest';
import { canManageParentWorkspace } from './parentWorkspaceCapability.js';

describe('canManageParentWorkspace', () => {
  test('accepts locally known usage-based and Team workspaces', () => {
    expect(canManageParentWorkspace({ canManageWorkspace: true })).toBe(true);
  });

  test('accepts a GAM-confirmed Codex Workspace before the local snapshot is synchronized', () => {
    expect(canManageParentWorkspace(
      { canManageWorkspace: false },
      {
        configured: true,
        reachable: true,
        managed: true,
        hasCodexSpace: true,
        hasTeamSubscription: false
      }
    )).toBe(true);
  });

  test('does not invent Workspace management for a personal account', () => {
    expect(canManageParentWorkspace(
      { canManageWorkspace: false },
      {
        configured: true,
        reachable: true,
        managed: true,
        hasCodexSpace: false,
        hasTeamSubscription: false
      }
    )).toBe(false);
  });
});
