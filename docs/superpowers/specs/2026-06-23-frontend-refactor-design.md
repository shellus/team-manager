# Frontend Refactor Design

## Context

team-manager is a React and Vite admin console for managing ChatGPT Team parent accounts, subaccounts, Team membership, invitations, seat type, workspace settings, Codex credentials, Codex authorization, quota snapshots, and local account metadata.

The current web app is functional but has three structural issues:

- Many base controls are handwritten: forms, inputs, selects, modal dialogs, list items, tables, segmented controls, menus, switches, progress blocks, and confirmation flows.
- Page state is kept mostly in React component state. Refreshing the browser loses the selected section, selected parent account or subaccount, active group, detail tab, and open dialog.
- Styling is concentrated in one large CSS file with light theme variables only. There is no unified theme provider or dark theme.

This refactor keeps the backend API and business data model unchanged. The work is frontend only.

## Goals

- Use a component framework for base UI controls. The app should not handwrite base forms, modals, lists, list items, tables, switches, tabs, segmented controls, dropdowns, or confirmations.
- Use frontend routing and the browser history API to persist page state. Refreshing a URL should restore route, tab, selected record, and modal state whenever the referenced record still exists.
- Introduce a shared theme system with at least light and dark palettes.
- Keep development isolated in the `feat/frontend-refactor` worktree.
- Preserve existing Team business behavior: parent account management, member and invite management, seat changes with billing-risk confirmation, Team settings, local profile editing, subaccount import and registration, Team link sync, Codex credential management, Codex authorization progress, quota refresh, and auth logs.

## Non-Goals

- No backend route or persistence model rewrite.
- No direct edits to runtime JSON data.
- No change to Codex credential storage semantics.
- No change to seat semantics. `default` remains the ChatGPT fixed seat type, and `usage_based` remains the Codex or usage-based seat type.
- No marketing-style redesign. This is an internal operations console.

## Framework Choice

Use Ant Design v5 for UI components and React Router for navigation.

Ant Design covers the required base controls:

- `Form`, `Input`, `Input.TextArea`, `Select`, `Switch`
- `Modal`, `Drawer`, `Popconfirm`, `App`
- `List`, `Table`, `Card`, `Descriptions`
- `Tabs`, `Segmented`, `Menu`, `Dropdown`
- `Tag`, `Alert`, `Progress`, `Steps`, `Skeleton`, `Empty`

React Router provides `BrowserRouter`, route params, navigation, and `useSearchParams`. Search-param updates are treated as navigations, so tab and dialog state become durable history state instead of temporary component state.

Mantine was considered because it also provides broad component coverage. Ant Design is preferred because this project is a dense internal admin console with member tables, form-heavy modals, destructive confirmations, and operational status displays. Radix or shadcn-style copied primitives are not preferred because they would move too much base component ownership into this repository.

## Route Model

Use declarative browser routes:

- `/parents`
- `/parents/:accountId`
- `/subaccounts`
- `/subaccounts/:subaccountId`
- `/login`

The root route redirects authenticated users to `/parents` and unauthenticated users to `/login`.

Primary route params:

- `accountId`: selected parent account.
- `subaccountId`: selected subaccount.

Search params:

- `group`: selected parent account group.
- `tab`: detail tab inside the selected page. Parent values include `members`, `invites`, and `settings`. Subaccount values include `teams`, `credential`, `auth`, `quota`, and `logs`.
- `modal`: currently open modal or drawer.
- `target`: modal target such as member id, pending invite email, Team workspace id, or account id.
- `credential`: optional workspace id for the displayed or exported Codex credential.

Allowed parent modal values:

- `import-parent`
- `edit-parent-profile`
- `delete-parent`
- `invite-member`
- `remove-member`
- `revoke-invite`
- `rename-team`
- `billing-risk`

Allowed subaccount modal values:

- `import-session`
- `import-credential`
- `register-subaccount`
- `edit-subaccount-profile`
- `delete-subaccount`
- `invite-to-team`
- `manual-codex-callback`
- `delete-codex-credential`
- `billing-risk`

Invalid route state is repaired conservatively:

- If the selected route id no longer exists after data load, navigate to the first available record in that section or to the section root.
- If `group` does not exist, use the first available group.
- If `tab` is unsupported for the current route, replace it with the route default.
- If a target-required `modal` lacks a valid `target`, close the modal by removing modal-related search params. Import and registration modals do not require `target`.

## State Ownership

Durable UI state belongs in the URL:

- current section
- selected parent account or subaccount
- selected parent group
- selected detail tab
- open modal or drawer
- target id for an open modal or drawer
- selected credential workspace

Ephemeral state remains local to components:

- form draft values
- text area JSON drafts
- loading flags
- request errors
- in-progress auth event output
- optimistic UI flags that should not survive refresh

This split avoids storing sensitive session or credential JSON in the URL.

## App Structure

Recommended file layout:

```text
apps/web/src/
  app/
    AppRoot.tsx
    AppShell.tsx
    routes.tsx
    routeState.ts
    auth.ts
  theme/
    ThemeProvider.tsx
    tokens.ts
  components/
    JsonImportModal.tsx
    LocalProfileModal.tsx
    BillingRiskModal.tsx
    StatusTag.tsx
    ErrorAlert.tsx
  features/
    parents/
      ParentRoutes.tsx
      ParentList.tsx
      ParentDetail.tsx
      ParentMembersTable.tsx
      ParentInvitesTable.tsx
      ParentSettingsDrawer.tsx
      ParentActions.tsx
    subaccounts/
      SubaccountRoutes.tsx
      SubaccountList.tsx
      SubaccountDetail.tsx
      SubaccountTeamLinks.tsx
      SubaccountCredentialPanel.tsx
      SubaccountAuthPanel.tsx
      SubaccountQuotaPanel.tsx
      SubaccountLogsPanel.tsx
```

The exact file names may shift during implementation, but the boundaries should remain:

- `app` owns routing, auth gate, shell layout, URL-state helpers, and data refresh orchestration.
- `theme` owns Ant Design theme configuration and project semantic tokens.
- `components` contains reusable business composition components built from Ant Design primitives.
- `features/parents` owns parent account workflows.
- `features/subaccounts` owns subaccount workflows.

## UI Composition Rules

Use Ant Design base components instead of handwritten equivalents:

- Import, edit, invite, settings, callback, billing-risk, delete, and credential dialogs use `Modal`, `Drawer`, and `Form`.
- Parent and subaccount side lists use `List` and `Card`, not custom clickable article items.
- Member and pending invite grids use `Table`.
- Detail sections use `Tabs`, `Descriptions`, `Card`, `Alert`, `Tag`, `Progress`, and `Steps`.
- Destructive row actions use `Popconfirm` or a route-backed `Modal` when the action must survive refresh.
- Global messages and confirmation helpers use Ant Design `App.useApp()`.

Custom components may wrap Ant Design for business semantics, but they should not reimplement base widget behavior.

## Theme Design

Use Ant Design `ConfigProvider` with `theme.defaultAlgorithm` and `theme.darkAlgorithm`.

Project semantic tokens:

- `colorBgApp`
- `colorBgShell`
- `colorSurface`
- `colorSurfaceElevated`
- `colorBorderSubtle`
- `colorText`
- `colorTextSecondary`
- `colorPrimary`
- `colorDanger`
- `colorWarning`
- `colorSuccess`
- `colorInfo`

Theme mode:

- `light`
- `dark`

Persist the selected theme mode in `localStorage`. The theme toggle lives in the app header. The app should also set a root `data-theme` attribute so the small amount of remaining project CSS can use the same mode.

The visual tone should stay practical and restrained. This is an operations surface used for repeated scanning and action. Prefer clear tables, compact descriptions, readable forms, status tags, and explicit dangerous action labels over decorative cards or oversized hero treatment.

## Data Flow

Keep using `apiClient` as the frontend API boundary.

Parent account flow:

1. Load accounts with `listAccounts`.
2. Derive groups from account views.
3. Select account by route param.
4. Refresh parent account, members, pending invites, and settings through existing API calls.
5. Merge returned `AccountView` objects into the local account list.

Subaccount flow:

1. Load subaccounts with `listSubaccounts`.
2. Select subaccount by route param.
3. Import sessions or credentials through existing API calls.
4. Sync Team links through `syncSubaccountTeamLinks`.
5. Manage Codex credentials by workspace using existing workspace-scoped API calls.
6. Preserve the existing auth progress and log display semantics.

Billing risk flow:

1. Calls that may produce a billing-risk error first run without confirmation.
2. On billing-risk response, open the route-backed billing-risk modal.
3. The modal confirms the same operation with `confirmBillingRisk: true`.
4. The returned canonical view updates local state.

## Error Handling

- API errors render as Ant Design `Alert` in the affected surface.
- Session expiry navigates to `/login` after clearing the local token.
- Modal form errors stay inside the modal.
- Non-blocking action success or failure may use Ant Design message.
- Destructive operations use explicit action labels such as `删除母号`, `删除子号`, `移除成员`, or `删除凭证`.

## Accessibility

Ant Design owns keyboard and ARIA behavior for common widgets.

Additional requirements:

- Route-backed modals must have clear titles.
- Buttons must use action-specific labels.
- Tables must keep meaningful column headers.
- Disabled actions should expose a reason through help text, tooltip, or adjacent status.
- Text contrast must be verified in both light and dark themes.

## Migration Plan

Implement in slices:

1. Add dependencies and route-state tests.
2. Add theme provider, app shell, browser routes, and route-state helper functions.
3. Migrate login and top-level navigation.
4. Migrate parent account list and parent detail tabs.
5. Migrate parent member, invite, settings, local profile, Team rename, and billing-risk flows.
6. Migrate subaccount list and detail tabs.
7. Migrate subaccount import, registration, local profile, Team link, Codex credential, auth, quota, log, and billing-risk flows.
8. Remove obsolete handwritten dialog/list/table CSS and components.
9. Run full verification.

## Test Strategy

Add focused tests before implementation for route-state behavior:

- `/parents/:accountId?group=...&tab=members` round-trips selected account, group, and tab.
- `/subaccounts/:subaccountId?tab=credential&modal=delete-codex-credential&target=...` round-trips selected subaccount, tab, modal, and target.
- Invalid modal or tab values are normalized.
- Removing modal state preserves unrelated search params.

Implementation verification:

- `corepack pnpm typecheck`
- `corepack pnpm --filter @team-manager/web build`
- `corepack pnpm build`
- Browser verification for:
  - light theme
  - dark theme
  - refresh restores parent route, group, tab, and modal
  - refresh restores subaccount route, tab, and modal
  - parent member and invite tables render
  - subaccount Team links, Codex credential panel, auth progress, quota, and logs render

## Completion Criteria

- `apps/web` depends on a component framework and React Router.
- Browser routes persist section and selected entity.
- Search params persist tab and modal state.
- Base UI widgets are no longer handwritten in app code.
- Light and dark themes are available through unified tokens.
- Existing business workflows remain available.
- Obsolete handwritten modal, list-item, form, segmented, and table code is removed or replaced.
- Verification commands pass.
