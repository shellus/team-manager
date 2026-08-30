// Team Manager 新版共享合同：所有受管身份统一为 Account。

export * from './unified.js';

export {
  billingCurrencyForCountry,
  CHECKOUT_COUNTRY_CODES,
  CHECKOUT_CURRENCIES
} from './checkoutOptions.js';

export {
  getChatGptSessionUserEmail,
  inspectChatGptSessionImportInput,
  parseChatGptSessionImportInput,
  parseChatGptSessionInput
} from './sessionInput.js';
export type {
  ChatGptSessionImportParseResult,
  ChatGptSessionInput,
  ChatGptSessionInputInspection,
  ChatGptSessionParseResult
} from './sessionInput.js';

export const SEAT_TYPES = ['default', 'usage_based', 'prolite'] as const;
export type SeatType = (typeof SEAT_TYPES)[number];

export function isSeatType(value: unknown): value is SeatType {
  return typeof value === 'string' && (SEAT_TYPES as readonly string[]).includes(value);
}
export type AccountLimitType = 'unknown' | 'weekly' | 'monthly';

export const EDITABLE_MEMBER_ROLES = [
  'analytics-viewer',
  'standard-user',
  'account-admin',
  'account-owner'
] as const;
export type EditableMemberRole = (typeof EDITABLE_MEMBER_ROLES)[number];
export type MemberRole = EditableMemberRole | string;

export function isEditableMemberRole(value: unknown): value is EditableMemberRole {
  return typeof value === 'string' && (EDITABLE_MEMBER_ROLES as readonly string[]).includes(value);
}

export interface Member {
  userId: string;
  email: string;
  remoteName?: string;
  role: MemberRole;
  seat?: SeatType;
  status?: string;
}

export interface PendingInvite {
  inviteId: string;
  email: string;
  role: MemberRole;
  status: number;
  seat?: SeatType;
  createdTime: string;
  isScimManaged: boolean;
}

export interface ChatGptWebSessionCookies {
  oaiDid?: string;
  clientAuthInfo?: string;
  puid?: string;
  oaiIs?: string;
}

export type SeatSlotRelationStatus = 'unclaimed' | 'invited' | 'member' | 'unlinked';
export type SeatSlotExpirationStatus = 'not_set' | 'active' | 'expires_today' | 'expired';
export type SeatSlotSwapStatus = 'running' | 'succeeded' | 'failed';
export type SeatSlotSwapStepKey =
  | 'refreshing_workspace'
  | 'confirming_current_email'
  | 'removing_current_member'
  | 'revoking_current_invite'
  | 'inviting_new_email'
  | 'saving_new_profile'
  | 'refreshing_final_state';

export interface SeatSlotSwapStep {
  key: SeatSlotSwapStepKey;
  label: string;
  status: 'pending' | 'running' | 'done' | 'failed' | 'skipped';
  message?: string;
  at?: number;
}

export interface SeatSlotSwapState {
  id: string;
  status: SeatSlotSwapStatus;
  fromEmail?: string;
  toEmail: string;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  steps: SeatSlotSwapStep[];
}

export interface PublicSeatSlotView {
  seatKey: string;
  email?: string;
  contact?: string;
  remark?: string;
  expiresOn: string;
  price?: string;
  seat?: SeatType;
  relationStatus: SeatSlotRelationStatus;
  expirationStatus: SeatSlotExpirationStatus;
  swap?: SeatSlotSwapState;
  swapHistory?: SeatSlotSwapState[];
}

export type AccountManagerOperationStatus =
  | 'queued'
  | 'running'
  | 'waiting_for_otp'
  | 'waiting_manual'
  | 'succeeded'
  | 'failed'
  | 'interrupted';

export interface AccountManagerOperationView {
  id: string;
  accountId?: string;
  type: string;
  status: AccountManagerOperationStatus;
  phase: string;
  message?: string;
  email?: string;
  progress: number;
  control?: {
    id: string;
    type: 'retry_current_step' | 'rotate_proxy_sid';
    status: 'queued' | 'executing' | 'succeeded' | 'failed';
    requestedAt: number;
    updatedAt: number;
    requestedFromPhase?: string;
    completedAt?: number;
    error?: string;
  };
  requestSummary?: Record<string, unknown>;
  result?: Record<string, unknown>;
  errorCode?: string;
  errorMessage?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export type AccountManagerProfileStatus = 'stopped' | 'queued' | 'running' | 'stopping' | 'failed';
export type AccountProfileStatus = AccountManagerProfileStatus | 'unknown';
export interface AccountManagerProfileView {
  accountId: string;
  status: AccountManagerProfileStatus;
  profileId?: string;
  error?: string;
  updatedAt: number;
}

export interface ResidentialProxyConfig {
  sid: string;
  country: string;
  asn: string | null;
  state: string | null;
  city: string | null;
}

export const RESIDENTIAL_PROXY_SID_LENGTH = 8;
export const RESIDENTIAL_PROXY_SID_PATTERN = /^[a-z0-9]{8}$/i;

export function isResidentialProxySid(value: unknown): value is string {
  return typeof value === 'string' && RESIDENTIAL_PROXY_SID_PATTERN.test(value.trim());
}

export interface PersonalPaymentMethodView {
  id: string;
  type?: string;
  brand?: string;
  last4?: string;
  expMonth?: number;
  expYear?: number;
  isDefault?: boolean;
}

export interface PaymentMethodDefaults {
  holderName: string;
  postalCode: string;
  region: string;
}

export interface QuotaWindow {
  id: string;
  label: string;
  usedPercent: number | null;
  resetAt: string | null;
}

export interface CodexQuotaSnapshot {
  status: 'success' | 'unavailable' | 'error';
  planType: string | null;
  windows: QuotaWindow[];
  error: string | null;
}

export interface CodexCredentialJson {
  access_token: string;
  account_id: string;
  email?: string;
  type?: string;
  [key: string]: unknown;
}
