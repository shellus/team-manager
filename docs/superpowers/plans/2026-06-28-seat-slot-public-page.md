# Seat Slot Public Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace email-bound parent member profiles with seat-bound slots and add a public seat-key page for self-service ChatGPT fixed-seat account changes.

**Architecture:** `Account.seatSlots` becomes the canonical local model for sold ChatGPT fixed seats. Backend public APIs locate exactly one slot by `seatKey`, run a recoverable swap workflow, and never infer another slot from an email. The React public page bypasses admin auth and polls the slot progress endpoint.

**Tech Stack:** TypeScript shared types, Hono server routes, file-backed `AccountStore`, React Router, Ant Design, pnpm tests and builds.

---

### Task 1: Shared Data Model And Store Normalization

**Files:**
- Modify: `packages/shared/src/index.ts`
- Modify: `apps/server/src/accountStore.ts`
- Test: `apps/server/src/teamService.test.ts`

- [ ] Add `AccountSeatSlot`, `SeatSlotSwapState`, `PublicSeatSlotView`, and `PublicSeatSwapRequest` shared types.
- [ ] Add `seatSlots?: AccountSeatSlot[]` to `Account` and `AccountView`.
- [ ] Normalize `seatSlots` in `AccountStore`, keeping only `seat='default'`, valid 16-character `seatKey`, valid dates, and lower-cased emails.
- [ ] Preserve existing `memberProfiles` only long enough for migration inputs; do not expose it as the primary model after migration.
- [ ] Add tests that sanitize malformed slots and preserve a valid slot.

### Task 2: Seat Slot Service Layer

**Files:**
- Create: `apps/server/src/seatSlotService.ts`
- Modify: `apps/server/src/teamService.ts`
- Test: `apps/server/src/seatSlotService.test.ts`

- [ ] Add helper methods to find a slot by key across all accounts.
- [ ] Add `getPublicSeatSlot(seatKey)` returning only slot-safe public fields.
- [ ] Add `swapSeatSlotEmail(seatKey, email)` with a per-process slot lock.
- [ ] Implement workflow steps: refresh members/invites, remove current member or revoke current invite, invite new email as `default`, update slot email while preserving remark/expiresOn/price, refresh final status.
- [ ] Reject swap when the new email is already bound to another slot under the same parent account.
- [ ] Do not block swaps by `expiresOn`.
- [ ] Add tests for member removal, invite revocation, empty slot, missing old email, duplicate new email, and persisted progress.

### Task 3: HTTP APIs

**Files:**
- Modify: `apps/server/src/app.ts`
- Test: `apps/server/src/teamService.test.ts` or `apps/server/src/seatSlotService.test.ts`

- [ ] Add unauthenticated routes before `/api` auth middleware:
  - `GET /public/seat-slots/:seatKey`
  - `POST /public/seat-slots/:seatKey/swap`
- [ ] Ensure public responses never include account tokens, cookies, admin fields, other slots, or other members.
- [ ] Keep admin routes unchanged except replacing member profile updates with slot updates where needed.

### Task 4: Migration And Data Repair

**Files:**
- Create: `scripts/migrate-seat-slots.mjs`
- Test: `scripts/migrate-seat-slots.mjs` through dry-run fixtures or server tests where practical.

- [ ] Load current `accounts.json` and optional backup `accounts.json.bak-*`.
- [ ] Restore lost member remarks by matching `account.id` or `accountId` plus lower-cased email.
- [ ] Convert each `memberProfiles[email]` into a seat slot with a generated 16-character `seatKey`.
- [ ] Fill slot status from `membersCache` and `pendingInvitesCache`.
- [ ] Remove `memberProfiles` from persisted accounts.
- [ ] Backup runtime data before running the migration against the live data directory.

### Task 5: Notifications And Existing Parent UI

**Files:**
- Modify: `apps/server/src/notificationService.ts`
- Modify: `apps/server/src/notificationService.test.ts`
- Modify: `apps/web/src/features/parents/ParentMembersTable.tsx`
- Modify: `apps/web/src/features/parents/ParentInvitesTable.tsx`
- Modify: `apps/web/src/features/parents/MemberProfileModal.tsx` or replace it with slot editing.

- [ ] Update reminder collection to scan `seatSlots` instead of `memberProfiles`.
- [ ] Update parent member/invite rows to display slot-bound local data by current email.
- [ ] Expose and show `seatKey` for each slot so operators can copy the public URL.
- [ ] Keep existing member and invite remote operations unchanged.

### Task 6: Public Seat Page

**Files:**
- Create: `apps/web/src/features/public-seat/PublicSeatPage.tsx`
- Modify: `apps/web/src/api.ts`
- Modify: `apps/web/src/app/AppRoot.tsx`
- Modify: `apps/web/src/styles.css`

- [ ] Add no-auth API calls for public slot lookup and swap.
- [ ] Add `/seat/:seatKey` route outside `AppShell` and login redirect.
- [ ] Display remark, expiresOn, price, current email, and status.
- [ ] Add an email input and swap button.
- [ ] Poll after swap to show progress steps until success or failure.
- [ ] Keep UI compact and operational; no marketing page.

### Task 7: Verification And Runtime Migration

**Files:**
- Runtime data under deployment data directory, after explicit backup.

- [ ] Run `corepack pnpm --filter @team-manager/server test`.
- [ ] Run `corepack pnpm typecheck`.
- [ ] Run `corepack pnpm build`.
- [ ] Backup runtime data.
- [ ] Run the migration against the runtime data directory.
- [ ] Verify remarks, generated `seatKey`, and public slot lookup on the running dev instance.
- [ ] Do not restart tmux unless runtime migration requires stopping writers.
