import type { AccountLimitType, AccountManagerOperationView, AccountManagerProfileView, AccountProfileStatus, CodexQuotaSnapshot, PersonalPaymentMethodView, ResidentialProxyConfig, SeatType } from './index.js';
import type { ChatGptSessionInput } from './sessionInput.js';

export type PersonalPlan = 'free' | 'go' | 'plus' | 'pro_5x' | 'pro_20x' | 'unknown';
export type PrimaryPlan = PersonalPlan | 'business_fixed_seat' | 'business_usage_based' | 'team_member';
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
  primaryPlanSeatUsage?: { occupied: number; capacity?: number };
  primaryPlanLifecycle?: AccountPlanLifecycleView;
  accessHealth: AccountAccessHealthView;
  latestOperation?: AccountManagerOperationView;
  limitType: AccountLimitType;
  workspaceCount: number;
  credentialCount: number;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface BulkUpdateAccountsRequest {
  accountIds: string[];
  groupId?: string;
  isBanned?: boolean;
}

export interface BulkUpdateAccountsResult {
  updatedCount: number;
}

export interface AccountDeletionWorkspacePreview {
  id: string;
  name?: string;
  externalId: string;
  activeMembershipCount: number;
  credentialCount: number;
  seatSlotCount: number;
  orderCount: number;
}

export interface AccountDeletionPreview {
  account: { id: string; email: string };
  ownedWorkspaces: AccountDeletionWorkspacePreview[];
  resources: {
    personalSpaces: number;
    sessionRecords: number;
    accessContexts: number;
    gamBindings: number;
    memberships: number;
    invitations: number;
    credentials: number;
    seatSlots: number;
    operations: number;
    maintenances: number;
    orders: number;
    activityLogs: number;
  };
  remoteWorkspaceDeletion: false;
}

export interface AccountDeletionResult {
  deleted: true;
  deletedWorkspaceCount: number;
  removedCredentialArtifactCount: number;
  credentialArtifactCleanupFailures: number;
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
  fixedSeatCapacity?: number;
  subscriptionSeatsInUse?: number;
  observedAt: string;
}

export interface WorkspacePromotionReasonView {
  title?: string;
  message?: string;
  code?: string;
}

export interface WorkspacePromotionMetadataView {
  planName: string;
  title?: string;
  summary?: string;
  quantityOff?: number;
  durationPeriods?: number;
  durationPeriod?: string;
  noAutoRenewalAtDiscountEnd?: boolean;
  promotionType?: string;
  processor?: string;
}

export interface WorkspacePromotionSubscriptionView {
  planType?: string;
  seatsInUse?: number;
  seatsEntitled?: number;
  activeUntil?: string;
  billingPeriod?: string;
  billingCurrency?: string;
  willRenew?: boolean;
  cancellationOutcome?: string;
}

export interface WorkspacePromotionPreviewView {
  promoCode: string;
  isEligible: boolean;
  ineligibleReason?: WorkspacePromotionReasonView;
  metadata?: WorkspacePromotionMetadataView;
  subscription: WorkspacePromotionSubscriptionView;
  wouldEnableRenewal: boolean;
}

export interface WorkspacePromotionApplyResultView {
  promoCode: string;
  accepted: true;
  verified: boolean;
  before: WorkspacePromotionSubscriptionView;
  after?: WorkspacePromotionSubscriptionView;
  renewalEnabled?: boolean;
  verificationError?: string;
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

export interface WorkspaceMemberRemovalResult {
  workspace: WorkspaceDetailView;
  summary: {
    remoteUserId: string;
    email?: string;
    seatType?: SeatType;
    upstreamSuccess?: boolean;
    hasBillingNotice: boolean;
    policy?: {
      kind?: string;
      billedSeatDelta?: number;
      vacancyOrdinal?: number;
      freeVacancyThreshold?: number;
      expiresAt?: string;
      billingStartsAt?: string;
      replacementRequired?: boolean;
    };
  };
}

export type OperationControl = 'retry' | 'rotate-ip' | 'terminate';

export interface SeatSlotMutationInput {
  seatKey?: string;
  email?: string | null;
  remoteUserId?: string | null;
  contact?: string | null;
  remark?: string | null;
  price?: string | null;
  expiresOn?: string | null;
  expireRemove?: boolean;
  seatType?: SeatType;
  status?: 'empty' | 'invited' | 'member' | 'disabled' | 'unknown';
}

export interface WorkspaceInvitationMutationInput extends Pick<SeatSlotMutationInput, 'contact' | 'remark' | 'price' | 'expiresOn' | 'expireRemove'> {
  email: string;
  seat: SeatType;
  role?: string;
}

export type WorkspaceSettingMutationInput =
  | { key: 'defaultSeat'; value: SeatType }
  | {
      key:
        | 'workspaceReferralsEnabled'
        | 'autoAcceptRequests'
        | 'personalAccessTokensEnabled'
        | 'codexDeviceCodeAuthEnabled'
        | 'codexRemoteControlEnabled'
        | 'automaticReloadEnabled';
      value: boolean;
    };

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
  kind: 'trace' | 'rrweb' | 'credential' | 'quarantine' | 'orphan';
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
  summaryText: string;
  attemptCount: number;
  maxAttempts: number;
  nextRetryAt?: string;
  error?: string;
  deliveredAt?: string;
  createdAt: string;
}

export interface NotificationPolicyConfiguration {
  advanceDays: number;
  triggerTime: string;
  timeZone: string;
  webhookUrl?: string;
  webhookEnabled: boolean;
  feishuWebhookUrl?: string;
  feishuEnabled: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  telegramEnabled: boolean;
  wecomWebhookUrl?: string;
  wecomEnabled: boolean;
}

export interface NotificationPolicyView {
  id: string;
  kind: string;
  enabled: boolean;
  configuration: NotificationPolicyConfiguration;
  updatedAt: string;
}

export interface SaveNotificationPolicyRequest {
  enabled: boolean;
  configuration: NotificationPolicyConfiguration;
}

export type OperationalRiskLevel = 'critical' | 'warning' | 'normal' | 'unknown';

export interface OperationalAccountReferenceView {
  id: string;
  email: string;
  remark?: string;
  role?: NormalizedWorkspaceRole;
  isBanned: boolean;
  limitType: AccountLimitType;
}

export type RenewalOperationalStatus =
  | 'normal'
  | 'payment_due'
  | 'expiring_soon'
  | 'expired'
  | 'seat_over_capacity'
  | 'renewal_unknown'
  | 'inactive';

interface RenewalOperationalOverviewBaseView {
  id: string;
  status: string;
  plan: string;
  renewalAt?: string;
  willRenew?: boolean;
  defaultPaymentCardLast4?: string;
  expectedAmount?: string;
  expectedCurrency?: string;
  subscriptionSeatsInUse?: number;
  billedSeatQuantity?: number;
  operationalStatus: RenewalOperationalStatus;
  riskLevel: OperationalRiskLevel;
  risks: string[];
}

export interface RenewalOperationalOverviewView extends RenewalOperationalOverviewBaseView {
  subject: 'workspace';
  workspaceId: string;
  workspaceExternalId: string;
  workspaceName?: string;
  fixedSeatCapacity?: number;
  fixedSeatOccupied?: number;
  fixedSeatAvailable?: number;
  managingAccounts: OperationalAccountReferenceView[];
}

export interface SeatOperationalOverviewView {
  id: string;
  subject: 'member' | 'invitation' | 'vacancy' | 'customer';
  workspaceId: string;
  workspaceName?: string;
  workspaceExternalId: string;
  email?: string;
  seatType: SeatType;
  status: string;
  role?: NormalizedWorkspaceRole;
  seatSlotId?: string;
  hasCustomerProfile: boolean;
  contact?: string;
  remark?: string;
  expiresOn?: string;
  price?: string;
  managingAccounts: OperationalAccountReferenceView[];
  riskLevel: OperationalRiskLevel;
  risks: string[];
}

export interface TeamOrderConfigurationView {
  workspaceId?: string;
  workspaceName?: string;
  promoCode?: string;
  country?: string;
  currency?: string;
  seatQuantity?: number;
}

export interface TeamOrderMaintenanceView {
  id: string;
  workspaceId: string;
  workspaceName?: string;
  workspaceExternalId: string;
  executorAccountId: string;
  executorEmail: string;
  enabled: boolean;
  status: 'running' | 'scheduled' | 'paused' | 'attention';
  nextRunAt?: string;
  lastRunAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  pauseReason?: string;
  configuration: TeamOrderConfigurationView;
}

export interface TeamUpgradeOrderView {
  id: string;
  workspaceId: string;
  workspaceName?: string;
  workspaceExternalId: string;
  executorAccountId: string;
  executorEmail: string;
  status: string;
  checkoutUrl?: string;
  expiresAt?: string;
  source: string;
  scheduledFor?: string;
  retryAt?: string;
  attemptCount: number;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
  configuration: TeamOrderConfigurationView;
}

export interface TeamOrderDashboardView {
  configured: boolean;
  statistics: {
    maintenanceCount: number;
    runningCount: number;
    readyCount: number;
    attentionCount: number;
  };
  globalConfiguration: TeamOrderConfigurationView;
  configurations: TeamOrderConfigurationView[];
  maintenances: TeamOrderMaintenanceView[];
  orders: TeamUpgradeOrderView[];
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

export interface RemovedAccountWorkspaceView extends AccountWorkspaceLinkView {
  removedAt: string;
  canDeleteLocally: boolean;
}

export interface AccountWorkspaceRelationshipSyncResult {
  observedAt: string;
  activeCount: number;
  removedCount: number;
  disabledCredentialCount: number;
}

export interface LocalWorkspaceDeleteResult {
  deleted: true;
  removedCredentialArtifactCount: number;
  credentialArtifactCleanupFailures: number;
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
  removedWorkspaces: RemovedAccountWorkspaceView[];
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
  profile?: AccountManagerProfileView;
  proxy?: ResidentialProxyConfig;
  operations: AccountManagerOperationView[];
  errors?: Partial<Record<'service' | 'profile' | 'proxy' | 'operations', string>>;
}

export interface RegisterAccountRequest {
  groupId: string;
  email?: string;
  country?: string;
  mailGroup?: string;
  resumeExisting?: boolean;
}

export interface AddSubscriptionPaymentMethodRequest {
  holderName: string;
  postalCode: string;
  card: PaymentCardInput;
}

export interface SubscriptionPaymentMethodBindingResult {
  targetAccountId: string;
  paymentMethods: PersonalPaymentMethodView[];
}

export interface WorkspaceSummaryView {
  id: string;
  externalId: string;
  name?: string;
  status: string;
  plan: string;
  rawPlanCode?: string;
  nextRenewalAt?: string;
  riskLevel?: OperationalRiskLevel;
  risks?: string[];
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

export interface PersonalSubscriptionChangePreviewView {
  currentPlan: PersonalPlan;
  targetPlan: Exclude<PersonalPlan, 'free' | 'unknown'>;
  amountDueMinor: number;
  positiveLineItemMinor: number;
  adjustmentMinor: number;
  currency: string;
  renewalDate?: string;
  defaultPaymentMethod?: {
    brand: string;
    last4: string;
  };
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
