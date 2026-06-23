# UI Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current handwritten web UI with an Ant Design and React Router based operations console that persists route, tab, and modal state across refreshes.

**Architecture:** Add URL-state helpers and tests first, then move the app shell to React Router and Ant Design `ConfigProvider`. Migrate parent and subaccount surfaces into feature modules that compose Ant Design primitives instead of handwritten forms, modals, lists, list items, tables, tabs, and switches.

**Tech Stack:** React 18, Vite, TypeScript, Ant Design v5, `@ant-design/icons`, `react-router-dom`, Vitest.

---

## File Structure

- Modify `apps/web/package.json`: add UI, router, and test dependencies plus a `test` script.
- Modify root lockfile through `corepack pnpm install`.
- Create `apps/web/src/app/routeState.ts`: parse and update durable URL state.
- Create `apps/web/src/app/routeState.test.ts`: unit tests for route-state helpers.
- Create `apps/web/src/theme/tokens.ts`: light and dark semantic tokens.
- Create `apps/web/src/theme/ThemeProvider.tsx`: Ant Design `ConfigProvider`, `App`, and theme mode persistence.
- Create `apps/web/src/app/AppRoot.tsx`: top-level auth gate, route tree, account loading, and navigation repair.
- Create `apps/web/src/app/AppShell.tsx`: application layout, navigation, theme toggle, and logout.
- Replace `apps/web/src/main.tsx`: wrap the app in `BrowserRouter` and import Ant Design reset CSS.
- Replace `apps/web/src/Login.tsx`: Ant Design login form.
- Replace `apps/web/src/App.tsx`: compatibility export that delegates to `AppRoot`, or remove it after updating imports.
- Create `apps/web/src/components/JsonImportModal.tsx`: Ant Design JSON import modal for parent sessions, subaccount sessions, and Codex credentials.
- Create `apps/web/src/components/LocalProfileModal.tsx`: Ant Design local profile modal for parent and subaccount metadata.
- Create `apps/web/src/components/BillingRiskModal.tsx`: route-backed billing-risk confirmation modal.
- Create `apps/web/src/components/StatusTag.tsx`: status label mapping with Ant Design `Tag`.
- Create `apps/web/src/features/parents/ParentRoutes.tsx`: parent route controller.
- Create `apps/web/src/features/parents/ParentList.tsx`: parent account list using `List` and `Card`.
- Create `apps/web/src/features/parents/ParentDetail.tsx`: parent detail tabs.
- Create `apps/web/src/features/parents/ParentMembersTable.tsx`: member table and seat changes.
- Create `apps/web/src/features/parents/ParentInvitesTable.tsx`: pending invite table and invite modal integration.
- Create `apps/web/src/features/parents/ParentSettingsPanel.tsx`: Team settings and local profile actions.
- Create `apps/web/src/features/subaccounts/SubaccountRoutes.tsx`: subaccount route controller.
- Create `apps/web/src/features/subaccounts/SubaccountList.tsx`: subaccount list using `List` and `Card`.
- Create `apps/web/src/features/subaccounts/SubaccountDetail.tsx`: subaccount detail tabs.
- Create `apps/web/src/features/subaccounts/SubaccountTeamLinks.tsx`: Team link sync and invite flow.
- Create `apps/web/src/features/subaccounts/SubaccountCredentialPanel.tsx`: credential table, export, delete, quota, and auth entry points.
- Create `apps/web/src/features/subaccounts/SubaccountAuthPanel.tsx`: runtime capability display, manual callback, auto auth progress, and logs.
- Replace `apps/web/src/styles.css`: keep only layout, app token bridges, and targeted overrides that Ant Design does not own.
- Remove obsolete handwritten components after migration: `SessionImportDialog.tsx`, `CredentialImportDialog.tsx`, `LocalProfileDialog.tsx`, `AccountCard.tsx`, `WorkspaceListCard.tsx`, old `MemberPanel.tsx`, and old `SubaccountPanel.tsx`.

## Task 1: Add Dependencies And URL-State Tests

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/app/routeState.test.ts`
- Create: `apps/web/src/app/routeState.ts`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add web dependencies**

```json
{
  "dependencies": {
    "@ant-design/icons": "^5.6.1",
    "@team-manager/shared": "workspace:*",
    "antd": "^5.26.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^7.6.2"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "latest",
    "vite": "^6.0.0",
    "vitest": "^3.2.4"
  }
}
```

Run: `corepack pnpm install`

- [ ] **Step 2: Add failing route-state tests**

Create `apps/web/src/app/routeState.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import {
  clearModalState,
  parseParentSearchState,
  parseSubaccountSearchState,
  setModalState,
  setSearchValue
} from './routeState.js';

describe('routeState', () => {
  test('parses parent group tab modal and target from search params', () => {
    const state = parseParentSearchState(new URLSearchParams('group=A&tab=invites&modal=remove-member&target=user-1'));
    expect(state).toEqual({ group: 'A', tab: 'invites', modal: 'remove-member', target: 'user-1' });
  });

  test('normalizes unsupported parent tab and modal values', () => {
    const state = parseParentSearchState(new URLSearchParams('tab=bad&modal=bad&target=user-1'));
    expect(state).toEqual({ group: '', tab: 'members', modal: '', target: '' });
  });

  test('parses subaccount credential tab modal target and credential workspace', () => {
    const state = parseSubaccountSearchState(
      new URLSearchParams('tab=credential&modal=delete-codex-credential&target=acct-1&credential=acct-2')
    );
    expect(state).toEqual({
      tab: 'credential',
      modal: 'delete-codex-credential',
      target: 'acct-1',
      credential: 'acct-2'
    });
  });

  test('updates a single search value without dropping unrelated params', () => {
    const params = setSearchValue(new URLSearchParams('group=A&tab=members'), 'tab', 'settings');
    expect(params.toString()).toBe('group=A&tab=settings');
  });

  test('sets and clears modal state while preserving route params', () => {
    const opened = setModalState(new URLSearchParams('group=A&tab=members'), 'invite-member', 'team-1');
    expect(opened.toString()).toBe('group=A&tab=members&modal=invite-member&target=team-1');
    expect(clearModalState(opened).toString()).toBe('group=A&tab=members');
  });
});
```

- [ ] **Step 3: Verify tests fail because helper file is missing**

Run: `corepack pnpm --filter @team-manager/web test -- --run apps/web/src/app/routeState.test.ts`

Expected: FAIL with an import error for `./routeState.js`.

- [ ] **Step 4: Implement route-state helpers**

Create `apps/web/src/app/routeState.ts`:

```ts
export type ParentTab = 'members' | 'invites' | 'settings';
export type ParentModal =
  | ''
  | 'import-parent'
  | 'edit-parent-profile'
  | 'delete-parent'
  | 'invite-member'
  | 'remove-member'
  | 'revoke-invite'
  | 'rename-team'
  | 'billing-risk';

export type SubaccountTab = 'teams' | 'credential' | 'auth' | 'quota' | 'logs';
export type SubaccountModal =
  | ''
  | 'import-session'
  | 'import-credential'
  | 'register-subaccount'
  | 'edit-subaccount-profile'
  | 'delete-subaccount'
  | 'invite-to-team'
  | 'manual-codex-callback'
  | 'delete-codex-credential'
  | 'billing-risk';

const parentTabs = new Set<ParentTab>(['members', 'invites', 'settings']);
const parentModals = new Set<ParentModal>([
  '',
  'import-parent',
  'edit-parent-profile',
  'delete-parent',
  'invite-member',
  'remove-member',
  'revoke-invite',
  'rename-team',
  'billing-risk'
]);
const subaccountTabs = new Set<SubaccountTab>(['teams', 'credential', 'auth', 'quota', 'logs']);
const subaccountModals = new Set<SubaccountModal>([
  '',
  'import-session',
  'import-credential',
  'register-subaccount',
  'edit-subaccount-profile',
  'delete-subaccount',
  'invite-to-team',
  'manual-codex-callback',
  'delete-codex-credential',
  'billing-risk'
]);

function readParam(params: URLSearchParams, key: string) {
  return params.get(key)?.trim() ?? '';
}

export function parseParentSearchState(params: URLSearchParams) {
  const rawTab = readParam(params, 'tab');
  const rawModal = readParam(params, 'modal');
  const modal = parentModals.has(rawModal as ParentModal) ? (rawModal as ParentModal) : '';
  return {
    group: readParam(params, 'group'),
    tab: parentTabs.has(rawTab as ParentTab) ? (rawTab as ParentTab) : 'members',
    modal,
    target: modal ? readParam(params, 'target') : ''
  };
}

export function parseSubaccountSearchState(params: URLSearchParams) {
  const rawTab = readParam(params, 'tab');
  const rawModal = readParam(params, 'modal');
  const modal = subaccountModals.has(rawModal as SubaccountModal) ? (rawModal as SubaccountModal) : '';
  return {
    tab: subaccountTabs.has(rawTab as SubaccountTab) ? (rawTab as SubaccountTab) : 'teams',
    modal,
    target: modal ? readParam(params, 'target') : '',
    credential: readParam(params, 'credential')
  };
}

export function setSearchValue(params: URLSearchParams, key: string, value: string) {
  const next = new URLSearchParams(params);
  if (value) next.set(key, value);
  else next.delete(key);
  return next;
}

export function setModalState(params: URLSearchParams, modal: string, target = '') {
  let next = setSearchValue(params, 'modal', modal);
  next = setSearchValue(next, 'target', target);
  return next;
}

export function clearModalState(params: URLSearchParams) {
  const next = new URLSearchParams(params);
  next.delete('modal');
  next.delete('target');
  return next;
}
```

- [ ] **Step 5: Verify tests pass**

Run: `corepack pnpm --filter @team-manager/web test -- --run apps/web/src/app/routeState.test.ts`

Expected: PASS.

## Task 2: Add Theme Provider And App Shell

**Files:**
- Create: `apps/web/src/theme/tokens.ts`
- Create: `apps/web/src/theme/ThemeProvider.tsx`
- Create: `apps/web/src/app/AppShell.tsx`
- Create: `apps/web/src/app/AppRoot.tsx`
- Modify: `apps/web/src/main.tsx`
- Modify: `apps/web/src/App.tsx`
- Replace: `apps/web/src/styles.css`

- [ ] **Step 1: Add semantic theme tokens**

Create `apps/web/src/theme/tokens.ts` with `lightSemanticTokens`, `darkSemanticTokens`, and `buildAntdTheme(mode)`. Use Ant Design `theme.defaultAlgorithm` and `theme.darkAlgorithm`; map semantic colors to Ant Design token fields such as `colorPrimary`, `colorError`, `colorWarning`, `colorSuccess`, `colorInfo`, `colorBgLayout`, `colorBgContainer`, `colorBorder`, `colorText`, and `colorTextSecondary`.

- [ ] **Step 2: Add theme provider**

Create `apps/web/src/theme/ThemeProvider.tsx` exporting `TeamManagerThemeProvider`. It reads `teammgr_theme` from `localStorage`, toggles `light` and `dark`, sets `document.documentElement.dataset.theme`, wraps children in `ConfigProvider`, and wraps Ant Design `App`.

- [ ] **Step 3: Add routed shell skeleton**

Create `apps/web/src/app/AppShell.tsx` with Ant Design `Layout`, `Menu`, `Button`, and `Switch`. The menu navigates to `/parents` and `/subaccounts`; logout clears token and navigates to `/login`.

- [ ] **Step 4: Add top-level route root**

Create `apps/web/src/app/AppRoot.tsx`. It checks `getToken()`, redirects unauthenticated users to `/login`, loads parent accounts once authenticated, and routes `/parents/*` and `/subaccounts/*` into feature route placeholders until the feature tasks replace them.

- [ ] **Step 5: Wire entry point**

Modify `apps/web/src/main.tsx` to import `antd/dist/reset.css`, wrap `AppRoot` in `BrowserRouter`, and wrap the tree in `TeamManagerThemeProvider`.

- [ ] **Step 6: Verify shell build**

Run: `corepack pnpm --filter @team-manager/web typecheck`

Expected: PASS.

## Task 3: Migrate Login And Shared Modals

**Files:**
- Modify: `apps/web/src/Login.tsx`
- Create: `apps/web/src/components/JsonImportModal.tsx`
- Create: `apps/web/src/components/LocalProfileModal.tsx`
- Create: `apps/web/src/components/BillingRiskModal.tsx`
- Create: `apps/web/src/components/StatusTag.tsx`
- Create: `apps/web/src/components/format.ts`

- [ ] **Step 1: Replace login with Ant Design Form**

`Login.tsx` should use `Card`, `Form`, `Input`, `Button`, `Alert`, and no raw `<form>`, `<input>`, or `<label>` elements.

- [ ] **Step 2: Add JSON import modal**

`JsonImportModal.tsx` should use `Modal`, `Form`, `Input`, `Input.TextArea`, `Alert`, and `Descriptions`. It supports session mode and Codex credential mode and parses preview fields without storing sensitive content outside component state.

- [ ] **Step 3: Add local profile modal**

`LocalProfileModal.tsx` should use `Modal`, `Form`, `Input`, `Input.TextArea`, and preview detected session email.

- [ ] **Step 4: Add billing-risk modal**

`BillingRiskModal.tsx` should use `Modal` and `Alert`; confirm button text must be operation-specific.

- [ ] **Step 5: Verify no old modal imports remain after feature migration**

Run after Tasks 4 and 5: `rg -n "SessionImportDialog|CredentialImportDialog|LocalProfileDialog|modal-backdrop|role=\\\"dialog\\\"" apps/web/src`

Expected: no matches.

## Task 4: Migrate Parent Account UI

**Files:**
- Create: `apps/web/src/features/parents/ParentRoutes.tsx`
- Create: `apps/web/src/features/parents/ParentList.tsx`
- Create: `apps/web/src/features/parents/ParentDetail.tsx`
- Create: `apps/web/src/features/parents/ParentMembersTable.tsx`
- Create: `apps/web/src/features/parents/ParentInvitesTable.tsx`
- Create: `apps/web/src/features/parents/ParentSettingsPanel.tsx`
- Remove after replacement: `apps/web/src/AccountCard.tsx`, `apps/web/src/WorkspaceListCard.tsx`, `apps/web/src/MemberPanel.tsx`

- [ ] **Step 1: Build parent route controller**

`ParentRoutes.tsx` reads `accountId` from params, parent state from `useSearchParams`, repairs invalid account/group/tab/modal state with `navigate(..., { replace: true })`, and passes selected account and action callbacks to child components.

- [ ] **Step 2: Build parent list**

`ParentList.tsx` uses Ant Design `List`, `Card`, `Tag`, `Dropdown`, and `Button`. It navigates to `/parents/:accountId?group=...` when a card is selected.

- [ ] **Step 3: Build parent detail tabs**

`ParentDetail.tsx` uses `Tabs` and renders member, invite, and settings panes. Tab changes write `tab` to `useSearchParams`.

- [ ] **Step 4: Build member table**

`ParentMembersTable.tsx` uses `Table`, `Select`, `Button`, `Popconfirm`, and `Alert`. Seat changes call `apiClient.setMemberSeat`; billing-risk errors open the route-backed modal.

- [ ] **Step 5: Build invite table and invite modal**

`ParentInvitesTable.tsx` uses `Table`, `Button`, `Popconfirm`, and Ant Design form modal. It calls `apiClient.invite`, `apiClient.refreshPendingInvites`, and `apiClient.revokePendingInvite`.

- [ ] **Step 6: Build settings panel**

`ParentSettingsPanel.tsx` uses `Card`, `Descriptions`, `Switch`, `Select`, `Button`, and shared local profile modal. It calls existing settings, rename, refresh, and local profile APIs.

- [ ] **Step 7: Verify parent UI**

Run: `corepack pnpm --filter @team-manager/web typecheck`

Expected: PASS.

## Task 5: Migrate Subaccount UI

**Files:**
- Create: `apps/web/src/features/subaccounts/SubaccountRoutes.tsx`
- Create: `apps/web/src/features/subaccounts/SubaccountList.tsx`
- Create: `apps/web/src/features/subaccounts/SubaccountDetail.tsx`
- Create: `apps/web/src/features/subaccounts/SubaccountTeamLinks.tsx`
- Create: `apps/web/src/features/subaccounts/SubaccountCredentialPanel.tsx`
- Create: `apps/web/src/features/subaccounts/SubaccountAuthPanel.tsx`
- Create: `apps/web/src/features/subaccounts/subaccountAuthProgress.ts`
- Remove after replacement: `apps/web/src/SubaccountPanel.tsx`

- [ ] **Step 1: Move pure auth progress helpers**

Move `AUTH_PROGRESS_STEPS`, phase labels, and `buildAuthProgress` into `subaccountAuthProgress.ts` without changing behavior.

- [ ] **Step 2: Build subaccount route controller**

`SubaccountRoutes.tsx` reads `subaccountId` and search params, loads subaccounts, repairs invalid ids/tabs/modals, and owns selected subaccount merge behavior.

- [ ] **Step 3: Build subaccount list**

`SubaccountList.tsx` uses `List`, `Card`, `Tag`, `Dropdown`, and `Button`. Import session, import credential, and register actions open route-backed modals.

- [ ] **Step 4: Build subaccount detail tabs**

`SubaccountDetail.tsx` uses `Tabs`; tab changes write `tab` to `useSearchParams`.

- [ ] **Step 5: Build Team links panel**

`SubaccountTeamLinks.tsx` uses `Table`, `Select`, `Button`, `Tag`, and shared billing-risk modal integration. It calls `apiClient.inviteSubaccountToTeam` and `apiClient.syncSubaccountTeamLinks`.

- [ ] **Step 6: Build credential panel**

`SubaccountCredentialPanel.tsx` uses `Table`, `Card`, `Button`, `Modal`, `Input.TextArea`, `Alert`, and `Descriptions`. It supports export, delete, quota refresh, manual auth start, and auto auth per workspace.

- [ ] **Step 7: Build auth panel**

`SubaccountAuthPanel.tsx` uses `Steps`, `Timeline`, `Tag`, `Alert`, `Progress`, and `Button`. It preserves polling behavior while auto auth is running.

- [ ] **Step 8: Verify subaccount UI**

Run: `corepack pnpm --filter @team-manager/web typecheck`

Expected: PASS.

## Task 6: Remove Old Handwritten Widgets And CSS

**Files:**
- Delete: `apps/web/src/SessionImportDialog.tsx`
- Delete: `apps/web/src/CredentialImportDialog.tsx`
- Delete: `apps/web/src/LocalProfileDialog.tsx`
- Delete: `apps/web/src/AccountCard.tsx`
- Delete: `apps/web/src/WorkspaceListCard.tsx`
- Delete: `apps/web/src/MemberPanel.tsx`
- Delete: `apps/web/src/SubaccountPanel.tsx`
- Replace: `apps/web/src/styles.css`

- [ ] **Step 1: Remove obsolete files**

Delete the old handwritten dialog, card, member, and subaccount panel files after all imports are gone.

- [ ] **Step 2: Scan for forbidden handwritten base widgets**

Run:

```bash
rg -n "<form|<input|<select|<textarea|<table|role=\\\"dialog\\\"|modal-backdrop|account-card|member-table|segmented" apps/web/src
```

Expected: no matches, except matches inside documentation strings are not app code.

- [ ] **Step 3: Keep CSS focused**

`styles.css` should only contain root layout, app-specific shell layout, Ant Design token bridge variables, responsive shell rules, and compact utility classes for code blocks or credential output.

- [ ] **Step 4: Verify CSS and TypeScript**

Run: `corepack pnpm --filter @team-manager/web typecheck`

Expected: PASS.

## Task 7: Full Verification

**Files:**
- No new files unless verification reveals a concrete defect.

- [ ] **Step 1: Run web tests**

Run: `corepack pnpm --filter @team-manager/web test -- --run`

Expected: PASS.

- [ ] **Step 2: Run shared and full typecheck**

Run: `corepack pnpm typecheck`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `corepack pnpm build`

Expected: PASS.

- [ ] **Step 4: Run browser verification**

Start dev server:

```bash
corepack pnpm --filter @team-manager/web dev
```

Use browser checks to confirm:

- `/parents` renders the routed Ant Design shell.
- `/parents/:accountId?group=...&tab=members` restores selected parent, group, and tab.
- A parent route with `modal=invite-member` reopens the invite modal after refresh.
- `/subaccounts/:subaccountId?tab=credential` restores selected subaccount and credential tab.
- A subaccount route with `modal=delete-codex-credential&target=...` reopens the delete credential modal after refresh.
- Light and dark theme toggle changes Ant Design and project CSS colors.
- Tables, modals, drawers, lists, cards, tabs, switches, and forms come from Ant Design.

- [ ] **Step 5: Final diff review**

Run:

```bash
git status --short --branch
git diff --stat
git diff --check
```

Expected: all changes are intentional, no whitespace errors, no local runtime environment details.
