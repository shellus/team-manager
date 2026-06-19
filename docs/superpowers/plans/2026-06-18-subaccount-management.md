# Subaccount Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Current status:** Implemented in the current worktree. The final verification commands are documented in Task 6. Historical red-phase test runs are not reproducible from the completed tree without reverting implementation files.

**Goal:** Add first-class child account management: child account pool, session JSON import, Codex Auth OAuth URL/callback credential generation, direct Codex quota querying, child-to-Team invites, Team relation sync, and verification logs.

**Architecture:** Keep child accounts separate from Team mother accounts. Store child records, OAuth sessions, generated Codex credentials, Team links, and auth logs under the existing runtime `data/` directory; expose only redacted views to the frontend. Use request-protocol services for Codex OAuth and quota queries, not Playwright.

**Tech Stack:** TypeScript, Hono, React, pnpm workspace, Node test runner, file-backed JSON stores.

---

### Task 1: Shared Types And Child Store

**Files:**
- Modify: `packages/shared/src/index.ts`
- Create: `apps/server/src/subaccountStore.ts`
- Test: `apps/server/src/subaccountStore.test.ts`

- [x] **Step 1: Write failing store tests**

```ts
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SubaccountStore } from './subaccountStore.js';

describe('SubaccountStore', () => {
  it('imports the single supported ChatGPT session JSON shape', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'teammgr-subaccounts-'));
    try {
      const store = new SubaccountStore(dir);
      await store.init();
      const saved = await store.importSession({
        user: { email: 'child@example.com' },
        account: { id: 'chatgpt-account-id' },
        accessToken: 'web-access-token'
      });

      assert.equal(saved.email, 'child@example.com');
      assert.equal(saved.label, 'child@example.com');
      assert.equal(saved.chatgptAccountId, 'chatgpt-account-id');
      assert.equal(saved.hasWebSession, true);
      assert.equal(saved.status, 'session_ready');
      assert.equal(store.list()[0]?.email, 'child@example.com');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('rejects old flat compatibility fields', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'teammgr-subaccounts-'));
    try {
      const store = new SubaccountStore(dir);
      await store.init();
      await assert.rejects(
        () => store.importSession({ email: 'child@example.com', accessToken: 'web-access-token' }),
        /缺少 user.email/
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
```

- [x] **Step 2: Run failing test**

Run: `corepack pnpm --filter @team-manager/server test -- subaccountStore`

Expected: fail because `subaccountStore.ts` does not exist.

- [x] **Step 3: Implement shared child types and file store**

Add child account view/storage types to `packages/shared/src/index.ts`. Implement `SubaccountStore` with `init`, `list`, `get`, `importSession`, `saveCodexCredential`, and `appendLog`; persist to `data/subaccounts.json` and `data/subaccount-auth-logs.jsonl`.

- [x] **Step 4: Run store test**

Run: `corepack pnpm --filter @team-manager/server test -- subaccountStore`

Expected: pass.

### Task 2: Codex OAuth Service

**Files:**
- Create: `apps/server/src/codexAuth.ts`
- Test: `apps/server/src/codexAuth.test.ts`

- [x] **Step 1: Write failing OAuth tests**

Test URL generation includes the Codex OAuth client parameters, PKCE challenge, fixed loopback redirect URI, `prompt=login`, and `codex_cli_simplified_flow=true`. Test callback exchange with an injected fake fetch returns a CPA-compatible top-level token JSON with `type: "codex"`.

- [x] **Step 2: Run failing test**

Run: `corepack pnpm --filter @team-manager/server test -- codexAuth`

Expected: fail because `codexAuth.ts` does not exist.

- [x] **Step 3: Implement Codex OAuth helpers**

Implement `createCodexAuthSession`, `parseCodexCallbackUrl`, `exchangeCodexCallback`, `decodeJwtPayload`, and `toCodexCredentialJson`. Use the constants from CLIProxyAPI's Codex Auth path: authorize endpoint, token endpoint, client id, redirect URI, scopes, and PKCE S256.

- [x] **Step 4: Run OAuth test**

Run: `corepack pnpm --filter @team-manager/server test -- codexAuth`

Expected: pass.

### Task 3: Direct Codex Quota Query

**Files:**
- Create: `apps/server/src/codexQuota.ts`
- Test: `apps/server/src/codexQuota.test.ts`

- [x] **Step 1: Write failing quota tests**

Cover parsing CPA-style Codex usage payloads from `/backend-api/wham/usage` into quota windows and verify requests use the child Codex `access_token` plus `Chatgpt-Account-Id` from the credential `account_id`.

- [x] **Step 2: Run failing tests**

Run: `corepack pnpm --filter @team-manager/server test -- codexQuota`

Expected: fail because `codexQuota.ts` does not exist.

- [x] **Step 3: Implement direct quota query**

Implement `buildCodexQuotaSnapshot` and `fetchCodexQuota`. Reuse the existing ChatGPT transport so deployed requests go through curl_cffi sidecar when configured. Cache the latest quota snapshot on the child record. Do not call external credential-status services.

- [x] **Step 4: Run quota tests**

Run: `corepack pnpm --filter @team-manager/server test -- codexQuota`

Expected: pass.

### Task 4: Subaccount Service And API

**Files:**
- Modify: `apps/server/src/app.ts`
- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/config.ts`
- Create: `apps/server/src/subaccountService.ts`
- Test: `apps/server/src/subaccountService.test.ts`

- [x] **Step 1: Write failing service/API tests**

Cover listing redacted children, importing session JSON, starting Codex Auth, completing callback, fetching generated credential JSON, and writing verification logs without storing raw response bodies in API output.

- [x] **Step 2: Run failing tests**

Run: `corepack pnpm --filter @team-manager/server test -- subaccount`

Expected: fail because service/routes are missing.

- [x] **Step 3: Implement service and routes**

Add `SubaccountService` wrapping `SubaccountStore` and `codexAuth`. Add authenticated routes:
- `GET /api/subaccounts`
- `POST /api/subaccounts/session`
- `DELETE /api/subaccounts/:id`
- `POST /api/subaccounts/:id/codex-auth/start`
- `POST /api/subaccounts/:id/codex-auth/callback`
- `GET /api/subaccounts/:id/codex-credential`
- `POST /api/subaccounts/:id/quota/refresh`
- `GET /api/subaccounts/:id/logs`
- `POST /api/subaccounts/:id/team-invites`
- `POST /api/subaccounts/:id/team-links/sync`

- [x] **Step 4: Run service/API tests**

Run: `corepack pnpm --filter @team-manager/server test -- subaccount`

Expected: pass.

### Task 5: Frontend Child Account Surface

**Files:**
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/App.tsx`
- Create: `apps/web/src/SubaccountPanel.tsx`
- Modify: `apps/web/src/styles.css`

- [x] **Step 1: Add API client methods**

Expose methods matching the new `/api/subaccounts` routes and shared view types.

- [x] **Step 2: Add child account panel**

Build a compact operations panel with: list, session JSON import textarea, Codex Auth start button, login URL copy/open field, callback URL textarea, child-to-Team invite controls, Team relation sync, credential JSON export textarea, and logs. Avoid modal-first flows.

- [x] **Step 3: Wire top-level navigation**

Add a simple mode switch between mother-account workspace management and child-account management without disturbing the current mother-account workflow.

- [x] **Step 4: Typecheck frontend**

Run: `corepack pnpm typecheck`

Expected: pass.

### Task 6: Verification And Documentation

**Files:**
- Modify: `README.md`
- Create or modify: `docs/dev-spec/subaccount-management.md`

- [x] **Step 1: Document implemented scope**

Document child account store, session JSON import, Codex Auth manual callback flow, generated credential location, child-to-Team invites, Team relation sync, direct quota query with local quota cache, and current out-of-scope registration boundary.

- [x] **Step 2: Full verification**

Run:
- `corepack pnpm test`
- `corepack pnpm typecheck`
- `corepack pnpm build`
- Run a sensitive-string scan over git-managed source/docs/config examples.

Expected: tests/typecheck/build pass. The scan must not expose real secrets or deployment-specific addresses in git-managed files.

### Self-Review

- Spec coverage: The plan covers child pool records, session JSON import, Codex Auth URL/callback credential generation, manual login URL fallback, child-to-Team invites, Team relation sync, direct Codex quota query, and logs.
- Scope note: Fully automated OpenAI registration is not part of the current implementation. Future work requires real request/response capture before adding any executor.
- Type consistency: Child account types live in shared package; server routes return redacted views; credential JSON is only served on an explicit export endpoint.
