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
  profile_status: string;
  profile_checked_at: NullableTimestamp;
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
  current_email: string | null;
  normalized_current_email: string | null;
  contact: string | null;
  remark: string | null;
  price: string | null;
  expires_on: ColumnType<string | null, string | null, string | null>;
  expire_reminder: Generated<boolean>;
  expire_remove: Generated<boolean>;
  seat_type: string | null;
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
  from_email: string | null;
  steps: JsonObject;
  completed_at: NullableTimestamp;
}

export interface SeatExpirationRemovalAttemptTable extends AuditedTable {
  seat_slot_id: string;
  status: string;
  attempt_count: Generated<number>;
  next_attempt_at: NullableTimestamp;
  last_attempt_at: NullableTimestamp;
  last_error: string | null;
  failed_at: NullableTimestamp;
  succeeded_at: NullableTimestamp;
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
  progress: Generated<number>;
  safe_request_summary: JsonObject;
  result_summary: JsonObject | null;
  error_code: string | null;
  error_message: string | null;
  completed_at: NullableTimestamp;
  effective_at: NullableTimestamp;
  last_polled_at: NullableTimestamp;
  converged_at: NullableTimestamp;
}

export interface AutomationOperationEventTable {
  id: Generated<string>; operation_id: string; phase: string | null; status: string;
  safe_payload: JsonObject; occurred_at: Timestamp; created_at: Generated<Timestamp>;
}

export interface PaymentAttemptSummaryTable {
  id: Generated<string>; operation_id: string; target_plan: string | null; result_code: string;
  card_brand: string | null; card_last4: string | null;
  amount: ColumnType<string | null, string | number | null, string | number | null>;
  currency: string | null; submitted_at: NullableTimestamp; created_at: Generated<Timestamp>;
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

export interface QuarantinedArtifactTable {
  id: Generated<string>;
  kind: string;
  storage_key: string;
  content_sha256: string;
  byte_size: number;
  reason_code: string;
  status: Generated<string>;
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
  fixed_seat_capacity: Generated<number | null>;
  subscription_seats_in_use: Generated<number | null>;
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
  normalized_workspace_plan: string | null;
  payload: JsonObject;
  observed_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface AccountOperationalSummaryTable {
  account_id: string;
  personal_plan: string;
  primary_plan: string;
  primary_workspace_id: string | null;
  primary_fixed_seat_occupied: number | null;
  primary_fixed_seat_capacity: number | null;
  limit_type: string;
  profile_status: string;
  lifecycle_at: NullableTimestamp;
  lifecycle_will_renew: boolean | null;
}

export interface PaymentMethodSummaryTable {
  id: Generated<string>;
  personal_space_id: string | null;
  workspace_id: string | null;
  brand: string | null;
  last4: string | null;
  expiry_month: number | null;
  expiry_year: number | null;
  is_default: Generated<boolean>;
  observed_at: Timestamp;
  created_at: Generated<Timestamp>;
}

export interface BillingInvoiceTable {
  id: Generated<string>; billing_snapshot_id: string; external_id: string | null;
  amount: ColumnType<string | null, string | number | null, string | number | null>;
  currency: string | null; status: string | null; occurred_at: NullableTimestamp;
  payload: JsonObject; created_at: Generated<Timestamp>;
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

export interface NotificationDeliveryTable {
  id: Generated<string>; policy_id: string; status: string; safe_summary: JsonObject;
  payload: JsonObject; error_message: string | null; delivered_at: NullableTimestamp;
  attempt_count: Generated<number>; max_attempts: Generated<number>;
  next_retry_at: NullableTimestamp; last_attempt_at: NullableTimestamp;
  configuration_snapshot: JsonObject; delivered_channels: JsonObject;
  created_at: Generated<Timestamp>;
}

export interface ArtifactOrphanTable {
  id: Generated<string>;
  storage_key: string;
  content_sha256: string;
  byte_size: number;
  status: string;
  discovered_at: Timestamp;
  delete_after: Timestamp;
  deleted_at: NullableTimestamp;
  metadata: JsonObject;
  created_at: Generated<Timestamp>;
  updated_at: Generated<Timestamp>;
}

export interface AccountActivityLogTable {
  id: Generated<string>; account_id: string | null; workspace_id: string | null;
  kind: string; payload: JsonObject; source_file_sha256: string | null;
  source_line: number | null; source_bytes_sha256: string | null;
  occurred_at: Timestamp; created_at: Generated<Timestamp>;
}

export interface CodexOauthSessionTable {
  id: string; account_id: string; workspace_id: string; state: string;
  verifier_ciphertext: string; verifier_nonce: string; verifier_auth_tag: string;
  verifier_key_version: string; auth_url: string; expires_at: Timestamp;
  consumed_at: NullableTimestamp; created_at: Generated<Timestamp>;
}

export interface TeamOrderConfigurationTable extends AuditedTable {
  workspace_id: string | null;
  promo_code: string | null;
  country: string | null;
  currency: string | null;
  seat_quantity: Generated<number | null>;
  seat_quantities: JsonObject | null;
}

export interface TeamOrderMaintenanceTable extends AuditedTable {
  workspace_id: string;
  executor_account_id: string;
  enabled: Generated<boolean>;
  last_run_at: NullableTimestamp;
  promo_code: string | null;
  country: string | null;
  currency: string | null;
  seat_quantity: Generated<number | null>;
  seat_quantities: JsonObject | null;
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
  account_operational_summaries: AccountOperationalSummaryTable;
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
  seat_expiration_removal_attempts: SeatExpirationRemovalAttemptTable;
  personal_subscription_snapshots: PersonalSubscriptionSnapshotTable;
  personal_setting_snapshots: PersonalSnapshotTable;
  personal_quota_snapshots: PersonalSnapshotTable;
  workspace_subscription_snapshots: WorkspaceSubscriptionSnapshotTable;
  workspace_setting_snapshots: WorkspaceSnapshotTable;
  credential_quota_snapshots: CredentialQuotaSnapshotTable;
  billing_snapshots: BillingSnapshotTable;
  billing_invoices: BillingInvoiceTable;
  payment_method_summaries: PaymentMethodSummaryTable;
  system_settings: SystemSettingTable;
  notification_policies: NotificationPolicyTable;
  notification_deliveries: NotificationDeliveryTable;
  artifact_orphans: ArtifactOrphanTable;
  account_activity_logs: AccountActivityLogTable;
  codex_oauth_sessions: CodexOauthSessionTable;
  team_order_configurations: TeamOrderConfigurationTable;
  team_order_maintenances: TeamOrderMaintenanceTable;
  team_upgrade_orders: TeamUpgradeOrderTable;
  automation_operations: AutomationOperationTable;
  automation_operation_events: AutomationOperationEventTable;
  payment_attempt_summaries: PaymentAttemptSummaryTable;
  upstream_trace_segments: ArtifactIndexTable;
  rrweb_recordings: ArtifactIndexTable;
  quarantined_artifacts: QuarantinedArtifactTable;
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
