import type { AccountManagerOperationView, AccountManagerProfileView, ResidentialProxyConfig, SeatType } from './index.js';
import type { ChatGptSessionInput } from './sessionInput.js';

export type PersonalPlan = 'free' | 'go' | 'plus' | 'pro_5x' | 'pro_20x' | 'unknown';
export type PersonalSubscriptionMode = 'start_new' | 'change_existing';
export type BusinessSubscriptionMode = 'create_workspace' | 'upgrade_existing_workspace';
export type NormalizedWorkspaceRole = 'owner' | 'admin' | 'member' | 'analytics_viewer' | 'unknown';

export interface AccountGroupView {
  id: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
  accountCount: number;
}

export interface UnifiedAccountSummaryView {
  id: string;
  email: string;
  displayName?: string;
  remark?: string;
  group: Pick<AccountGroupView, 'id' | 'name'>;
  isBanned: boolean;
  hasGamBinding: boolean;
  hasSession: boolean;
  hasManageableWorkspace: boolean;
  isWorkspaceMember: boolean;
  hasWorkspaceCredential: boolean;
  personalPlan: PersonalPlan;
  workspaceCount: number;
  credentialCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalSubscriptionSnapshotView {
  plan: PersonalPlan;
  rawPlanCode?: string;
  status: string;
  willRenew?: boolean;
  effectiveAt?: string;
  endsAt?: string;
  observedAt: string;
}

export interface AccountWorkspaceLinkView {
  id: string;
  externalId: string;
  name?: string;
  status: string;
  plan: string;
  rawPlanCode?: string;
  role: NormalizedWorkspaceRole;
  rawRole?: string;
  seatType?: SeatType;
  membershipStatus: string;
  manageable: boolean;
}

export interface WorkspaceCredentialView {
  id: string;
  accountId: string;
  accountEmail: string;
  workspaceId: string;
  kind: 'oauth' | 'pat';
  poolGroup?: { id: string; name: string };
  status: string;
  contentSha256: string;
  byteSize: number;
  createdAt: string;
}

export interface UnifiedAccountDetailView extends UnifiedAccountSummaryView {
  remoteUserId?: string;
  gamAccountRef?: string;
  proxyConfigured: boolean;
  limitType: string;
  session?: ChatGptSessionInput;
  personalSpace: {
    id: string;
    remoteAccountId?: string;
    status: string;
    subscription?: PersonalSubscriptionSnapshotView;
  };
  workspaces: AccountWorkspaceLinkView[];
  credentials: WorkspaceCredentialView[];
  accountManager?: {
    profile?: AccountManagerProfileView;
    operations: AccountManagerOperationView[];
    proxy?: ResidentialProxyConfig;
  };
}

export interface WorkspaceSummaryView {
  id: string;
  externalId: string;
  name?: string;
  status: string;
  plan: string;
  rawPlanCode?: string;
  nextRenewalAt?: string;
  manageableAccountCount: number;
  memberCount: number;
  invitationCount: number;
  seatSlotCount: number;
  credentialCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceMembershipView {
  id: string;
  accountId?: string;
  accountEmail?: string;
  remoteUserId?: string;
  email?: string;
  displayName?: string;
  role: NormalizedWorkspaceRole;
  rawRole?: string;
  seatType?: SeatType;
  status: string;
  source: string;
  observedAt: string;
}

export interface WorkspaceInvitationView {
  id: string;
  accountId?: string;
  email: string;
  role: NormalizedWorkspaceRole;
  rawRole?: string;
  seatType?: SeatType;
  status: string;
  invitedAt?: string;
  observedAt: string;
}

export interface SeatSlotView {
  id: string;
  seatKey: string;
  email?: string;
  remoteUserId?: string;
  contact?: string;
  remark?: string;
  price?: string;
  expiresOn?: string;
  expireReminder: boolean;
  expireRemove: boolean;
  seatType: SeatType;
  status: string;
}

export interface WorkspaceDetailView extends WorkspaceSummaryView {
  members: WorkspaceMembershipView[];
  invitations: WorkspaceInvitationView[];
  credentials: WorkspaceCredentialView[];
  seatSlots: SeatSlotView[];
  latestSettings?: { payload: Record<string, unknown>; observedAt: string };
  latestBilling?: { payload: Record<string, unknown>; observedAt: string };
}

export interface PaymentCardInput {
  number: string;
  expiryMonth: number;
  expiryYear: number;
  cvc: string;
}

export interface ChangePersonalSubscriptionRequest {
  targetPlan: Exclude<PersonalPlan, 'free' | 'unknown'>;
  mode: PersonalSubscriptionMode;
  country: string;
  currency: string;
  promoCode?: string;
  autoPay: boolean;
  card?: PaymentCardInput;
}

export interface OpenBusinessSubscriptionRequest {
  mode: BusinessSubscriptionMode;
  workspaceId?: string;
  country: string;
  currency: string;
  promoCode?: string;
  autoPay: boolean;
  card?: PaymentCardInput;
}

export const PERSONAL_PLAN_OPTIONS: ReadonlyArray<{ plan: Exclude<PersonalPlan, 'free' | 'unknown'>; label: string; planName: string }> = [
  { plan: 'go', label: 'Go', planName: 'chatgptgoplan' },
  { plan: 'plus', label: 'Plus', planName: 'chatgptplusplan' },
  { plan: 'pro_5x', label: 'Pro 5x', planName: 'chatgptprolite' },
  { plan: 'pro_20x', label: 'Pro 20x', planName: 'chatgptpro' }
];
