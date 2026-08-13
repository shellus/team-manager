import type { AccountLimitType, AccountManagerOperationView, AccountManagerProfileView, AccountProfileStatus, CodexQuotaSnapshot, PersonalPaymentMethodView, ResidentialProxyConfig, SeatType } from './index.js';
import type { ChatGptSessionInput } from './sessionInput.js';

export type PersonalPlan = 'free' | 'go' | 'plus' | 'pro_5x' | 'pro_20x' | 'unknown';
export type PrimaryPlan = PersonalPlan | 'business_two_seat' | 'business_usage_based' | 'team_member';
export type PersonalSubscriptionMode = 'start_new' | 'change_existing';
export type BusinessSubscriptionMode = 'create_workspace' | 'upgrade_existing_workspace';
export type NormalizedWorkspaceRole = 'owner' | 'admin' | 'member' | 'analytics_viewer' | 'unknown';
export type AccountLifecycleKind = 'renews' | 'expires' | 'valid_until' | 'expired';
export type AccountAccessHealthStatus = 'valid' | 'invalid' | 'unknown' | 'missing';

export interface AccountPlanLifecycleView {
  kind: AccountLifecycleKind;
  at: string;
}

export interface AccountAccessHealthView {
  status: AccountAccessHealthStatus;
  checkedAt?: string;
  expiresAt?: string;
  invalidContextCount: number;
}

export interface AccountAccessContextHealthView {
  kind: 'personal' | 'workspace';
  workspaceName?: string;
  status: AccountAccessHealthStatus;
  checkedAt?: string;
  expiresAt?: string;
}

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
  profileStatus: AccountProfileStatus;
  hasRunningProfile: boolean;
  hasSession: boolean;
  hasManageableWorkspace: boolean;
  isWorkspaceMember: boolean;
  hasWorkspaceCredential: boolean;
  primaryPlan: PrimaryPlan;
  primaryPlanLifecycle?: AccountPlanLifecycleView;
  accessHealth: AccountAccessHealthView;
  latestOperation?: AccountManagerOperationView;
  lastSyncedAt?: string;
  limitType: AccountLimitType;
  workspaceCount: number;
  credentialCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AccountRegistrationSummaryView {
  kind: 'registration';
  id: string;
  email?: string;
  group: Pick<AccountGroupView, 'id' | 'name'>;
  operation: AccountManagerOperationView;
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

export interface SubscriptionDetailView {
  plan: string;
  rawPlanCode?: string;
  status: string;
  willRenew?: boolean;
  effectiveAt?: string;
  endsAt?: string;
  observedAt: string;
}

export interface SnapshotView<T = Record<string, unknown>> {
  payload: T;
  observedAt: string;
}

export interface BillingInvoiceView {
  id: string;
  number?: string;
  externalId?: string;
  total?: number;
  amountDue?: number;
  amountPaid?: number;
  amountRemaining?: number;
  subtotal?: number;
  tax?: number;
  currency?: string;
  status?: string;
  createdAt?: string;
  nextPaymentAttempt?: string;
  periodStart?: string;
  periodEnd?: string;
  billingReason?: string;
  lineDescription?: string;
  lineQuantity?: number;
  lineUnitAmount?: number;
  hostedInvoiceUrl?: string;
  invoicePdfUrl?: string;
}

export interface BillingIdentityView {
  name?: string;
  email?: string;
  taxId?: string;
  address?: string;
}

export interface BillingSeatTypeCountsView {
  default: number;
  usageBased: number;
}

export interface BillingDetailView {
  observedAt: string;
  upcomingInvoice?: BillingInvoiceView;
  invoices: BillingInvoiceView[];
  paymentMethods: PersonalPaymentMethodView[];
  billingIdentity?: BillingIdentityView;
  seatTypeCounts?: BillingSeatTypeCountsView;
}

export interface AccountActivityView {
  id: string;
  accountId?: string;
  workspaceId?: string;
  kind: string;
  title: string;
  detail?: string;
  occurredAt: string;
}

export type OperationControl = 'retry' | 'rotate-ip' | 'terminate';

export interface ManagedPersonalSubscription {
  id?: string;
  planType?: string;
  activeStart?: string;
  activeUntil?: string;
  billingPeriod?: string;
  scheduledBillingPeriod?: string;
  willRenew?: boolean;
  cancellationOutcome?: string;
  billingCurrency?: string;
  isDelinquent?: boolean;
  updatedAt?: number;
}

export interface ManagedWorkspaceSummary {
  id: string;
  name?: string;
  planType?: string;
  role?: string;
  seatType?: SeatType;
  status?: string;
  nextRenewalAt?: string;
  visible?: boolean;
}

export interface SeatSlotMutationInput {
  seatKey?: string;
  email?: string | null;
  remoteUserId?: string | null;
  contact?: string | null;
  remark?: string | null;
  price?: string | null;
  expiresOn?: string | null;
  expireReminder?: boolean;
  expireRemove?: boolean;
  seatType?: SeatType;
  status?: 'empty' | 'invited' | 'member' | 'disabled' | 'unknown';
}

export interface CredentialPoolGroupView {
  id: string;
  name: string;
  sortOrder: number;
  credentialCount: number;
}

export interface CodexAuthStart {
  sessionId: string;
  authUrl: string;
  expiresAt: number;
  targetChatgptAccountId?: string;
}

export interface ArtifactIndexView {
  id: string;
  kind: 'trace' | 'rrweb' | 'credential' | 'quarantine';
  storageKey: string;
  contentSha256: string;
  byteSize: number;
  status: string;
  recordedAt: string;
  expiresAt?: string;
  metadata: Record<string, unknown>;
}

export interface PersonalSpaceDetailView {
  subscription?: PersonalSubscriptionSnapshotView;
  billing?: BillingDetailView;
  quota?: SnapshotView & {
    windows?: Array<Record<string, unknown>>;
    raw?: unknown;
  };
  settings?: SnapshotView & {
    values?: Record<string, unknown>;
    profile?: Record<string, unknown>;
    raw?: unknown;
  };
}

export interface OperationEventView {
  id: string;
  phase?: string;
  status: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface PaymentAttemptSummaryView {
  id: string;
  targetPlan?: string;
  resultCode: string;
  cardBrand?: string;
  cardLast4?: string;
  amount?: string;
  currency?: string;
  submittedAt?: string;
  createdAt: string;
}

export interface OperationDetailView extends AccountManagerOperationView {
  events: OperationEventView[];
  payment?: PaymentAttemptSummaryView;
  effectiveAt?: string;
}

export interface NotificationDeliveryView {
  id: string;
  kind: string;
  status: string;
  summary: Record<string, unknown>;
  payload?: Record<string, unknown>;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt?: string;
  error?: string;
  deliveredAt?: string;
  createdAt: string;
}

export interface QuarantinedCredentialClaimInput {
  accountId: string;
  workspaceId: string;
  kind: 'oauth' | 'pat';
  poolGroupId?: string;
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
  workspaceName?: string;
  kind: 'oauth' | 'pat';
  poolGroup?: { id: string; name: string };
  status: string;
  contentSha256: string;
  byteSize: number;
  createdAt: string;
  latestQuota?: CodexQuotaSnapshot;
  quotaObservedAt?: string;
}

export interface UnifiedAccountDetailView extends UnifiedAccountSummaryView {
  remoteUserId?: string;
  gamAccountRef?: string;
  proxyConfigured: boolean;
  personalPlan: PersonalPlan;
  session?: ChatGptSessionInput;
  personalSpace: {
    id: string;
    remoteAccountId?: string;
    status: string;
    subscription?: PersonalSubscriptionSnapshotView;
  };
  workspaces: AccountWorkspaceLinkView[];
  credentials: WorkspaceCredentialView[];
  paymentMethods: PersonalPaymentMethodView[];
  operations: AccountManagerOperationView[];
  accessContexts: AccountAccessContextHealthView[];
  accountManager?: {
    profile?: AccountManagerProfileView;
    operations: AccountManagerOperationView[];
    proxy?: ResidentialProxyConfig;
  };
}

export interface AccountManagerStateView {
  account?: {
    id: string;
    email: string;
    personalPlan?: string;
    paymentMethods?: PersonalPaymentMethodView[];
  };
  profile?: AccountManagerProfileView;
  proxy?: ResidentialProxyConfig;
  operations: AccountManagerOperationView[];
}

export interface RegisterAccountRequest {
  groupId: string;
  email?: string;
  country?: string;
  mailGroup?: string;
  resumeExisting?: boolean;
}

export interface AddPersonalPaymentMethodRequest {
  country: string;
  currency: string;
  card: PaymentCardInput;
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
  consistencyRisks: WorkspaceConsistencyRiskView[];
}

export interface WorkspaceConsistencyRiskView {
  key: string;
  severity: 'warning' | 'error';
  title: string;
  detail: string;
  targetTab: 'members' | 'invitations' | 'seats' | 'credentials' | 'billing';
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

export const PERSONAL_PLAN_OPTIONS: ReadonlyArray<{
  plan: Exclude<PersonalPlan, 'free' | 'unknown'>;
  label: string;
  planName: string;
}> = [
  { plan: 'go', label: 'Go', planName: 'chatgptgoplan' },
  { plan: 'plus', label: 'Plus', planName: 'chatgptplusplan' },
  { plan: 'pro_5x', label: 'Pro 5x', planName: 'chatgptprolite' },
  { plan: 'pro_20x', label: 'Pro 20x', planName: 'chatgptpro' },
];
