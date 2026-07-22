import { describe, expect, test } from 'vitest';
import { canManageParentWorkspace, hasParentCodexSpace } from './parentWorkspaceCapability.js';

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

describe('hasParentCodexSpace', () => {
  test('accepts a locally synchronized usage-based Workspace when GAM is stale', () => {
    expect(hasParentCodexSpace(
      { planType: 'self_serve_business_usage_based' },
      {
        configured: true,
        reachable: true,
        managed: true,
        hasCodexSpace: false,
        hasTeamSubscription: false
      }
    )).toBe(true);
  });
});
