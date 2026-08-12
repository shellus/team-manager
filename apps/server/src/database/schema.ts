import type { ColumnType, Generated, Insertable, JSONColumnType, Selectable, Updateable } from 'kysely';

export type Timestamp = ColumnType<Date, Date | string, Date | string>;
export type NullableTimestamp = ColumnType<Date | null, Date | string | null, Date | string | null>;
export type JsonObject = JSONColumnType<
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>
>;

interface AuditedTable {
  id: Generated<string>;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface AccountGroupTable extends AuditedTable {
  name: string;
  normalized_name: string;
  sort_order: Generated<number>;
  is_default: Generated<boolean>;
}

export interface AccountTable extends AuditedTable {
  group_id: string;
  email: string;
  normalized_email: string;
  remark: string | null;
  is_banned: Generated<boolean>;
  remote_user_id: string | null;
  display_name: string | null;
  last_error: string | null;
  current_session_revision_id: string | null;
}

export interface AccountOperationalProfileTable extends AuditedTable {
  account_id: string;
  limit_type: string;
  proxy_url_ciphertext: string | null;
  proxy_url_nonce: string | null;
  proxy_url_auth_tag: string | null;
  proxy_url_key_version: string | null;
  account_manager_plan_code: string | null;
  account_manager_synced_at: NullableTimestamp;
}

export interface GamBindingTable extends AuditedTable {
  account_id: string;
  external_account_ref: string;
  normalized_external_account_ref: string;
}

export interface PersonalSpaceTable extends AuditedTable {
  account_id: string;
  remote_account_id: string | null;
  status: Generated<string>;
}

export interface AccountSessionRevisionTable {
  id: Generated<string>;
  account_id: string;
  ciphertext: string;
  nonce: string;
  auth_tag: string;
  key_version: string;
  plaintext_sha256: string;
  source: string;
  source_updated_at: NullableTimestamp;
  observed_email: string | null;
  observed_personal_account_id: string | null;
  created_at: Generated<Timestamp>;
}

export interface AccountAccessContextTable extends AuditedTable {
  account_id: string;
  personal_space_id: string | null;
  workspace_id: string | null;
  ciphertext: string;
  nonce: string;
  auth_tag: string;
  key_version: string;
  expires_at: NullableTimestamp;
  checked_at: NullableTimestamp;
  status: Generated<string>;
}

export interface WorkspaceTable extends AuditedTable {
  external_id: string;
  name: string | null;
  status: Generated<string>;
  raw_plan_code: string | null;
  normalized_plan: Generated<string>;
  next_renewal_at: NullableTimestamp;
}

export interface WorkspaceMembershipTable extends AuditedTable {
  workspace_id: string;
  account_id: string | null;
  remote_user_id: string | null;
  email: string | null;
  normalized_email: string | null;
  display_name: string | null;
  raw_role: string | null;
  normalized_role: string;
  seat_type: string | null;
  status: Generated<string>;
  joined_at: NullableTimestamp;
  observed_at: Timestamp;
  source: string;
}

export interface WorkspaceInvitationTable extends AuditedTable {
  workspace_id: string;
  account_id: string | null;
  remote_invitation_id: string | null;
  email: string;
  normalized_email: string;
  raw_role: string | null;
  normalized_role: string;
  seat_type: string | null;
  status: Generated<string>;
  invited_at: NullableTimestamp;
  observed_at: Timestamp;
}

export interface CredentialPoolGroupTable extends AuditedTable {
  name: string;
  normalized_name: string;
  sort_order: Generated<number>;
}

export interface WorkspaceCredentialTable extends AuditedTable {
  account_id: string;
  workspace_id: string;
  pool_group_id: string | null;
  kind: string;
  external_id: string | null;
  storage_key: string;
  content_sha256: string;
  byte_size: number;
  format_version: number;
  eligibility_source: string;
  status: Generated<string>;
  disabled_at: NullableTimestamp;
}

export interface SeatSlotTable extends AuditedTable {
  workspace_id: string;
  seat_key: string;
  remote_user_id: string | null;
  current_email: string | null;
  normalized_current_email: string | null;
  contact: string | null;
  remark: string | null;
  price: string | null;
  expires_on: ColumnType<string | null, string | null, string | null>;
  expire_reminder: Generated<boolean>;
  expire_remove: Generated<boolean>;
  seat_type: string;
  status: string;
}

export interface SeatSlotIdentityHistoryTable {
  id: Generated<string>;
  seat_slot_id: string;
  previous_email: string | null;
  next_email: string | null;
  changed_at: Timestamp;
  reason: string;
  created_at: Generated<Timestamp>;
}

export interface SeatSlotSwapOperationTable extends AuditedTable {
  seat_slot_id: string;
  idempotency_key: string;
  status: string;
  requested_email: string;
  error_message: string | null;
}

export interface PersonalSnapshotTable {
  id: Generated<string>;
  personal_space_id: string;
  payload: JsonObject;
  observed_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface WorkspaceSnapshotTable {
  id: Generated<string>;
  workspace_id: string;
  payload: JsonObject;
  observed_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface AutomationOperationTable extends AuditedTable {
  account_id: string | null;
  workspace_id: string | null;
  target_group_id: string | null;
  kind: string;
  idempotency_key: string;
  external_operation_id: string | null;
  status: string;
  phase: string | null;
  safe_request_summary: JsonObject;
  result_summary: JsonObject | null;
  error_code: string | null;
  error_message: string | null;
}

export interface ArtifactIndexTable {
  id: Generated<string>;
  storage_key: string;
  content_sha256: string;
  byte_size: number;
  format_version: number;
  status: Generated<string>;
  recorded_at: Timestamp;
  expires_at: NullableTimestamp;
  metadata: JsonObject;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface PersonalSubscriptionSnapshotTable {
  id: Generated<string>;
  personal_space_id: string;
  normalized_plan: string;
  raw_plan_code: string | null;
  status: string;
  will_renew: boolean | null;
  effective_at: NullableTimestamp;
  ends_at: NullableTimestamp;
  payload: JsonObject;
  observed_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface WorkspaceSubscriptionSnapshotTable {
  id: Generated<string>;
  workspace_id: string;
  normalized_plan: string;
  raw_plan_code: string | null;
  status: string;
  will_renew: boolean | null;
  effective_at: NullableTimestamp;
  ends_at: NullableTimestamp;
  payload: JsonObject;
  observed_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface CredentialQuotaSnapshotTable {
  id: Generated<string>;
  credential_id: string;
  payload: JsonObject;
  observed_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface BillingSnapshotTable {
  id: Generated<string>;
  personal_space_id: string | null;
  workspace_id: string | null;
  payload: JsonObject;
  observed_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface SystemSettingTable {
  key: string;
  value: JsonObject;
  is_secret: Generated<boolean>;
  ciphertext: string | null;
  nonce: string | null;
  auth_tag: string | null;
  key_version: string | null;
  updated_at: Generated<Timestamp>;
}

export interface NotificationPolicyTable extends AuditedTable {
  kind: string;
  enabled: Generated<boolean>;
  configuration: JsonObject;
}

export interface TeamOrderConfigurationTable extends AuditedTable {
  workspace_id: string | null;
  promo_code: string | null;
  country: string | null;
  currency: string | null;
}

export interface TeamOrderMaintenanceTable extends AuditedTable {
  workspace_id: string;
  executor_account_id: string;
  enabled: Generated<boolean>;
  last_run_at: NullableTimestamp;
  promo_code: string | null;
  country: string | null;
  currency: string | null;
  next_run_at: NullableTimestamp;
  pause_reason: string | null;
  last_success_at: NullableTimestamp;
  last_error: string | null;
}

export interface TeamUpgradeOrderTable extends AuditedTable {
  workspace_id: string;
  executor_account_id: string;
  external_order_id: string | null;
  checkout_url: string | null;
  expires_at: NullableTimestamp;
  status: string;
  configuration_snapshot: JsonObject;
  source: Generated<string>;
  scheduled_for: NullableTimestamp;
  task_id: string | null;
  stripe_created_at: NullableTimestamp;
  retry_at: NullableTimestamp;
  attempt_count: Generated<number>;
  error_message: string | null;
  completed_at: NullableTimestamp;
}

export interface Database {
  account_groups: AccountGroupTable;
  accounts: AccountTable;
  account_operational_profiles: AccountOperationalProfileTable;
  gam_bindings: GamBindingTable;
  personal_spaces: PersonalSpaceTable;
  account_session_revisions: AccountSessionRevisionTable;
  account_access_contexts: AccountAccessContextTable;
  workspaces: WorkspaceTable;
  workspace_memberships: WorkspaceMembershipTable;
  workspace_invitations: WorkspaceInvitationTable;
  credential_pool_groups: CredentialPoolGroupTable;
  workspace_credentials: WorkspaceCredentialTable;
  seat_slots: SeatSlotTable;
  seat_slot_identity_history: SeatSlotIdentityHistoryTable;
  seat_slot_swap_operations: SeatSlotSwapOperationTable;
  personal_subscription_snapshots: PersonalSubscriptionSnapshotTable;
  personal_setting_snapshots: PersonalSnapshotTable;
  personal_quota_snapshots: PersonalSnapshotTable;
  workspace_subscription_snapshots: WorkspaceSubscriptionSnapshotTable;
  workspace_setting_snapshots: WorkspaceSnapshotTable;
  credential_quota_snapshots: CredentialQuotaSnapshotTable;
  billing_snapshots: BillingSnapshotTable;
  system_settings: SystemSettingTable;
  notification_policies: NotificationPolicyTable;
  team_order_configurations: TeamOrderConfigurationTable;
  team_order_maintenances: TeamOrderMaintenanceTable;
  team_upgrade_orders: TeamUpgradeOrderTable;
  automation_operations: AutomationOperationTable;
  upstream_trace_segments: ArtifactIndexTable;
  rrweb_recordings: ArtifactIndexTable;
}

export type AccountGroupRow = Selectable<AccountGroupTable>;
export type AccountRow = Selectable<AccountTable>;
export type NewAccount = Insertable<AccountTable>;
export type AccountPatch = Updateable<AccountTable>;
export type PersonalSpaceRow = Selectable<PersonalSpaceTable>;
export type WorkspaceRow = Selectable<WorkspaceTable>;
export type WorkspaceMembershipRow = Selectable<WorkspaceMembershipTable>;
export type WorkspaceCredentialRow = Selectable<WorkspaceCredentialTable>;
export type SeatSlotRow = Selectable<SeatSlotTable>;
