# Local Account Edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local profile editing for parent accounts and subaccounts, covering local `label` edits and optional session JSON replacement without exposing stored tokens to the frontend.

**Architecture:** The backend adds explicit local-profile update methods on the existing services and routes them through PATCH endpoints. The frontend adds one reusable edit dialog and wires it into existing parent and child card menus, keeping the existing remote Team rename flow separate.

**Tech Stack:** Hono, TypeScript, node:test, React, Vite, pnpm workspace.

---

## File Structure

- Modify `apps/server/src/teamService.test.ts`: add failing API tests for parent local-profile editing.
- Modify `apps/server/src/subaccountService.test.ts`: add failing API tests for child local-profile editing.
- Modify `apps/server/src/teamService.ts`: add `updateLocalProfile()` for parent accounts.
- Modify `apps/server/src/subaccountService.ts`: add `updateLocalProfile()` for child accounts and append a safe audit log.
- Modify `apps/server/src/subaccountStore.ts`: add a store method for child local profile/session updates while preserving credentials and links.
- Modify `apps/server/src/app.ts`: add authenticated PATCH routes.
- Modify `apps/web/src/api.ts`: add API client methods.
- Add `apps/web/src/LocalProfileDialog.tsx`: reusable local edit dialog with label and optional session JSON.
- Modify `apps/web/src/App.tsx`: wire parent edit dialog and state merge.
- Modify `apps/web/src/AccountCard.tsx`: add “编辑本地资料” menu action.
- Modify `apps/web/src/SubaccountPanel.tsx`: wire child edit dialog and menu action.
- Modify `apps/web/src/styles.css`: add focused styles only if existing modal/field styles are insufficient.

## Task 1: Parent Local-Profile API

**Files:**
- Modify: `apps/server/src/teamService.test.ts`
- Modify: `apps/server/src/teamService.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Write failing tests**

Add tests in `apps/server/src/teamService.test.ts` that build an authenticated app, create a parent account, call:

```http
PATCH /api/accounts/:id/local-profile
```

Expected behaviors:

- `{ "label": "新备注" }` updates only `label`, does not call ChatGPT transport, and returns `AccountView`.
- `{ "label": "新备注", "session": { "user": { "email": "owner-new@example.com" }, "account": { "id": "workspace-new" }, "accessToken": "new-token" } }` updates `label`, `email`, `accountId`, `accessToken`, clears `lastError`, and response JSON does not include `new-token`.
- Invalid session shape returns HTTP 400 with the parser error.

- [ ] **Step 2: Run parent tests and verify RED**

Run:

```bash
corepack pnpm --filter @team-manager/server test -- src/teamService.test.ts
```

Expected: FAIL because `/api/accounts/:id/local-profile` does not exist or service method is missing.

- [ ] **Step 3: Implement parent service and route**

Add `TeamService.updateLocalProfile(id, input)`:

```ts
type LocalProfileUpdate = {
  label?: unknown;
  session?: unknown;
};
```

Implementation rules:

- Validate `label` as non-empty trimmed string.
- If `session` exists, parse with `parseChatGptSessionInput`.
- Patch `label`, and when session exists patch `email`, `accountId`, `accessToken`.
- Clear `lastError`; preserve cached members, invites, settings, and workspaceName.
- Return `AccountView`; missing account throws `ServiceError(404, ...)`; parser errors throw `ServiceError(400, ...)`.

Add `PATCH /api/accounts/:id/local-profile` in `apps/server/src/app.ts`.

- [ ] **Step 4: Run parent tests and verify GREEN**

Run:

```bash
corepack pnpm --filter @team-manager/server test -- src/teamService.test.ts
```

Expected: PASS for the new parent local-profile tests and existing parent tests.

## Task 2: Child Local-Profile API

**Files:**
- Modify: `apps/server/src/subaccountService.test.ts`
- Modify: `apps/server/src/subaccountService.ts`
- Modify: `apps/server/src/subaccountStore.ts`
- Modify: `apps/server/src/app.ts`

- [ ] **Step 1: Write failing tests**

Add tests in `apps/server/src/subaccountService.test.ts`:

- `{ "label": "子号备注" }` updates only `label`, keeps `codexCredentials` and `teamLinks`, and response does not expose token material.
- `{ "label": "子号备注", "session": { "user": { "email": "child-new@example.com" }, "account": { "id": "child-account-new" }, "accessToken": "child-new-token" } }` updates `label`, `email`, `chatgptAccountId`, `webAccessToken`, clears `lastError`, and response JSON does not include `child-new-token`.
- Invalid session shape returns HTTP 400 with the parser error.

- [ ] **Step 2: Run child tests and verify RED**

Run:

```bash
corepack pnpm --filter @team-manager/server test -- src/subaccountService.test.ts
```

Expected: FAIL because `/api/subaccounts/:id/local-profile` does not exist or service/store methods are missing.

- [ ] **Step 3: Implement child service, store, and route**

Add `SubaccountStore.updateLocalProfile(id, input)` with:

```ts
{
  label: string;
  session?: ChatGptSessionInput;
}
```

Implementation rules:

- Preserve `codexCredentials`, `teamLinks`, `createdAt`, and logs.
- If session exists, patch `email`, `chatgptAccountId`, `webAccessToken`.
- Set status to `codex_ready` when credentials exist, otherwise `session_ready`.
- Clear `lastError` and update `updatedAt`.

Add `SubaccountService.updateLocalProfile(id, input)` to validate `label`, parse optional session, call store, and append a log with only non-sensitive metadata.

Add `PATCH /api/subaccounts/:id/local-profile` in `apps/server/src/app.ts`.

- [ ] **Step 4: Run child tests and verify GREEN**

Run:

```bash
corepack pnpm --filter @team-manager/server test -- src/subaccountService.test.ts
```

Expected: PASS for the new child local-profile tests and existing child tests.

## Task 3: Frontend Local Edit Dialog

**Files:**
- Add: `apps/web/src/LocalProfileDialog.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/AccountCard.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/SubaccountPanel.tsx`
- Modify: `apps/web/src/styles.css` if needed

- [ ] **Step 1: Add API client methods**

Add:

```ts
updateAccountLocalProfile: (id: string, payload: { label: string; session?: Record<string, unknown> }) =>
  call<AccountView>('PATCH', `/accounts/${id}/local-profile`, payload),
updateSubaccountLocalProfile: (id: string, payload: { label: string; session?: Record<string, unknown> }) =>
  call<SubaccountView>('PATCH', `/subaccounts/${id}/local-profile`, payload),
```

- [ ] **Step 2: Add reusable dialog**

Create `LocalProfileDialog.tsx` with props:

```ts
{
  open: boolean;
  title: string;
  description: string;
  initialLabel: string;
  submitLabel: string;
  busyLabel: string;
  onClose: () => void;
  onSubmit: (payload: { label: string; session?: Record<string, unknown> }) => Promise<void>;
}
```

Behavior:

- Reset fields when opened.
- Pre-fill `label`; leave session JSON blank.
- Parse session JSON only when non-empty.
- Show recognized email via `getChatGptSessionUserEmail`.
- Disable save when label is blank or busy.

- [ ] **Step 3: Wire parent edit flow**

In `AccountCard`, add `onEditLocalProfile`.

In `App`, keep `editingAccount` state, render `LocalProfileDialog`, call `apiClient.updateAccountLocalProfile`, merge returned account, and keep selection.

- [ ] **Step 4: Wire child edit flow**

In `SubaccountPanel`, keep `editingSubaccount` state, render `LocalProfileDialog`, call `apiClient.updateSubaccountLocalProfile`, merge returned subaccount, and reload logs for the updated child.

- [ ] **Step 5: Typecheck frontend**

Run:

```bash
corepack pnpm --filter @team-manager/web typecheck
```

Expected: PASS.

## Task 4: Full Verification

**Files:**
- Check all changed files.

- [ ] **Step 1: Run server tests**

Run:

```bash
corepack pnpm --filter @team-manager/server test
```

Expected: PASS.

- [ ] **Step 2: Run repository typecheck**

Run:

```bash
corepack pnpm typecheck
```

Expected: PASS.

- [ ] **Step 3: Run build**

Run:

```bash
corepack pnpm build
```

Expected: PASS.

- [ ] **Step 4: Inspect git diff**

Run:

```bash
git status --short
git diff -- apps/server/src/teamService.test.ts apps/server/src/subaccountService.test.ts apps/server/src/teamService.ts apps/server/src/subaccountService.ts apps/server/src/subaccountStore.ts apps/server/src/app.ts apps/web/src/api.ts apps/web/src/LocalProfileDialog.tsx apps/web/src/AccountCard.tsx apps/web/src/App.tsx apps/web/src/SubaccountPanel.tsx apps/web/src/styles.css docs/superpowers/specs/2026-06-20-local-account-edit-design.md docs/superpowers/plans/2026-06-20-local-account-edit.md
```

Expected: Diff contains only local-profile editing and related docs. No token values, temporary debug output, or unrelated refactors.

## Self-Review

- Spec coverage: parent and child label editing, optional session replacement, token redaction, no remote Team rename, frontend menu entries, and tests are covered.
- Placeholder scan: no TBD/TODO/fill-in placeholders remain.
- Type consistency: API paths use `local-profile`; frontend methods match backend routes; local label field is `label`; session parsing uses existing shared parser.
