import { sql, type Kysely } from 'kysely';
import type {
  AccountProfileStatus,
  AccountGroupView,
  AccountLimitType,
  PersonalPlan,
  UnifiedAccountDetailView,
  UnifiedAccountSummaryView,
  WorkspaceDetailView,
  WorkspaceSummaryView
} from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import { AccountRepository, type AccountListFilters } from './accountRepository.js';
import { SessionRepository } from './sessionRepository.js';
import { AutomationOperationRepository } from './automationOperationRepository.js';

export class UnifiedProjectionRepository {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly sessions: SessionRepository
  ) {}

  async groups(): Promise<AccountGroupView[]> {
    const result = await sql<{
      id: string; name: string; sort_order: number; is_default: boolean; account_count: number;
    }>`select g.id, g.name, g.sort_order, g.is_default, count(a.id)::int account_count
       from account_groups g left join accounts a on a.group_id = g.id
       group by g.id order by g.sort_order, g.name`.execute(this.db);
    return result.rows.map((row) => ({
      id: row.id, name: row.name, sortOrder: row.sort_order,
      isDefault: row.is_default, accountCount: row.account_count
    }));
  }

  async accounts(filters: AccountListFilters = {}): Promise<UnifiedAccountSummaryView[]> {
    const rows = await new AccountRepository(this.db).list(filters);
    const ids = rows.map((row) => row.id);
    const extras = ids.length === 0 ? [] : (await sql<{
      id: string; group_id: string; gam_ref: string | null; has_member: boolean; has_credential: boolean; has_running_profile: boolean;
    }>`select a.id, a.group_id, gb.external_account_ref gam_ref,
          exists(select 1 from workspace_memberships wm where wm.account_id=a.id and wm.status='active' and wm.normalized_role not in ('owner','admin')) has_member,
          exists(select 1 from workspace_credentials wc where wc.account_id=a.id and wc.status='active') has_credential,
          exists(select 1 from account_operational_profiles op where op.account_id=a.id and op.profile_status in ('queued','running','stopping')) has_running_profile
        from accounts a left join gam_bindings gb on gb.account_id=a.id where a.id = any(${ids}::uuid[])`.execute(this.db)).rows;
    const extraById = new Map(extras.map((row) => [row.id, row]));
    return rows.map((row) => {
      const extra = extraById.get(row.id);
      return {
        id: row.id,
        email: row.email,
        ...(row.display_name ? { displayName: row.display_name } : {}),
        ...(row.remark ? { remark: row.remark } : {}),
        group: { id: row.group_id, name: row.group_name },
        isBanned: row.is_banned,
        hasGamBinding: Boolean(extra?.gam_ref),
        profileStatus: normalizeProfileStatus(row.profile_status),
        hasRunningProfile: extra?.has_running_profile ?? false,
        hasSession: Boolean(row.current_session_revision_id),
        hasManageableWorkspace: row.has_manageable_workspace,
        isWorkspaceMember: extra?.has_member ?? false,
        hasWorkspaceCredential: extra?.has_credential ?? false,
        primaryPlan: normalizePrimaryPlan(row.primary_plan),
        limitType: normalizeLimitType(row.limit_type),
        workspaceCount: row.workspace_count,
        credentialCount: row.credential_count,
        ...(row.last_error ? { lastError: row.last_error } : {}),
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at)
      };
    });
  }

  async account(id: string): Promise<UnifiedAccountDetailView | undefined> {
    const summaries = await this.accounts();
    const summary = summaries.find((item) => item.id === id);
    if (!summary) return undefined;
    const base = await sql<{
      remote_user_id: string | null; external_account_ref: string | null; limit_type: string; personal_plan: string;
      proxy_configured: boolean; personal_space_id: string; remote_account_id: string | null; personal_status: string;
    }>`select a.remote_user_id, gb.external_account_ref, op.limit_type, aos.personal_plan,
          (op.proxy_url_ciphertext is not null) proxy_configured,
          ps.id personal_space_id, ps.remote_account_id, ps.status personal_status
        from accounts a
        join account_operational_profiles op on op.account_id=a.id
        join account_operational_summaries aos on aos.account_id=a.id
        join personal_spaces ps on ps.account_id=a.id
        left join gam_bindings gb on gb.account_id=a.id
        where a.id=${id}::uuid`.execute(this.db).then((result) => result.rows[0]);
    if (!base) return undefined;
    const subscription = await this.db.selectFrom('personal_subscription_snapshots').selectAll()
      .where('personal_space_id', '=', base.personal_space_id).orderBy('observed_at', 'desc').executeTakeFirst();
    const workspaces = await sql<{
      id: string; external_id: string; name: string | null; status: string; normalized_plan: string;
      raw_plan_code: string | null; normalized_role: string; raw_role: string | null; seat_type: string | null;
      membership_status: string;
    }>`select w.id,w.external_id,w.name,w.status,w.normalized_plan,w.raw_plan_code,
          wm.normalized_role,wm.raw_role,wm.seat_type,wm.status membership_status
        from workspace_memberships wm join workspaces w on w.id=wm.workspace_id
        where wm.account_id=${id}::uuid order by w.name nulls last,w.external_id`.execute(this.db);
    const credentials = await credentialViews(this.db, sql`wc.account_id=${id}::uuid`);
    const paymentMethods = await this.db.selectFrom('payment_method_summaries').selectAll()
      .where('personal_space_id', '=', base.personal_space_id).orderBy('observed_at', 'desc').execute();
    const operations = await new AutomationOperationRepository(this.db).listForAccount(id);
    return {
      ...summary,
      ...(base.remote_user_id ? { remoteUserId: base.remote_user_id } : {}),
      ...(base.external_account_ref ? { gamAccountRef: base.external_account_ref } : {}),
      proxyConfigured: base.proxy_configured,
      personalPlan: normalizePersonalPlan(base.personal_plan),
      ...(summary.hasSession ? { session: await this.sessions.currentSession(id) as UnifiedAccountDetailView['session'] } : {}),
      personalSpace: {
        id: base.personal_space_id,
        ...(base.remote_account_id ? { remoteAccountId: base.remote_account_id } : {}),
        status: base.personal_status,
        ...(subscription ? { subscription: {
          plan: normalizePersonalPlan(subscription.normalized_plan),
          ...(subscription.raw_plan_code ? { rawPlanCode: subscription.raw_plan_code } : {}),
          status: subscription.status,
          ...(subscription.will_renew === null ? {} : { willRenew: subscription.will_renew }),
          ...(subscription.effective_at ? { effectiveAt: iso(subscription.effective_at) } : {}),
          ...(subscription.ends_at ? { endsAt: iso(subscription.ends_at) } : {}),
          observedAt: iso(subscription.observed_at)
        } } : {})
      },
      workspaces: workspaces.rows.map((row) => ({
        id: row.id, externalId: row.external_id, ...(row.name ? { name: row.name } : {}),
        status: row.status, plan: row.normalized_plan, ...(row.raw_plan_code ? { rawPlanCode: row.raw_plan_code } : {}),
        role: normalizeRole(row.normalized_role), ...(row.raw_role ? { rawRole: row.raw_role } : {}),
        ...(row.seat_type ? { seatType: row.seat_type as 'default' | 'usage_based' } : {}),
        membershipStatus: row.membership_status,
        manageable: row.membership_status === 'active' && ['owner', 'admin'].includes(row.normalized_role)
      })),
      credentials,
      paymentMethods: paymentMethods.map((row) => ({
        id: row.id,
        ...(row.brand ? { brand: row.brand } : {}),
        ...(row.last4 ? { last4: row.last4 } : {}),
        ...(row.expiry_month ? { expMonth: row.expiry_month } : {}),
        ...(row.expiry_year ? { expYear: row.expiry_year } : {}),
        isDefault: row.is_default
      })),
      operations
    };
  }

  async workspaces(query?: string): Promise<WorkspaceSummaryView[]> {
    const pattern = `%${query?.trim() ?? ''}%`;
    const result = await sql<{
      id: string; external_id: string; name: string | null; status: string; normalized_plan: string;
      raw_plan_code: string | null; next_renewal_at: Date | null; created_at: Date; updated_at: Date;
      manageable_count: number; member_count: number; invitation_count: number; seat_count: number; credential_count: number;
    }>`select w.*,
          count(distinct wm.account_id) filter(where wm.status='active' and wm.normalized_role in ('owner','admin'))::int manageable_count,
          count(distinct wm.id) filter(where wm.status='active')::int member_count,
          count(distinct wi.id) filter(where wi.status='pending')::int invitation_count,
          count(distinct ss.id)::int seat_count,count(distinct wc.id) filter(where wc.status='active')::int credential_count
        from workspaces w
        left join workspace_memberships wm on wm.workspace_id=w.id
        left join workspace_invitations wi on wi.workspace_id=w.id
        left join seat_slots ss on ss.workspace_id=w.id
        left join workspace_credentials wc on wc.workspace_id=w.id
        where (${query?.trim() ? true : false}=false or coalesce(w.name,'') ilike ${pattern} or w.external_id ilike ${pattern})
        group by w.id order by w.updated_at desc`.execute(this.db);
    return result.rows.map(workspaceSummary);
  }

  async workspace(id: string): Promise<WorkspaceDetailView | undefined> {
    const summary = (await this.workspaces()).find((item) => item.id === id);
    if (!summary) return undefined;
    const members = await sql<any>`select wm.*,a.email account_email from workspace_memberships wm left join accounts a on a.id=wm.account_id where wm.workspace_id=${id}::uuid order by wm.normalized_role,wm.email`.execute(this.db);
    const invitations = await this.db.selectFrom('workspace_invitations').selectAll().where('workspace_id', '=', id).orderBy('observed_at', 'desc').execute();
    const seats = await this.db.selectFrom('seat_slots').selectAll().where('workspace_id', '=', id).orderBy('created_at').execute();
    const credentials = await credentialViews(this.db, sql`wc.workspace_id=${id}::uuid`);
    const settings = await this.db.selectFrom('workspace_setting_snapshots').selectAll().where('workspace_id', '=', id).orderBy('observed_at', 'desc').executeTakeFirst();
    const billing = await this.db.selectFrom('billing_snapshots').selectAll().where('workspace_id', '=', id).orderBy('observed_at', 'desc').executeTakeFirst();
    return {
      ...summary,
      members: members.rows.map((row: any) => ({
        id: row.id, ...(row.account_id ? { accountId: row.account_id } : {}), ...(row.account_email ? { accountEmail: row.account_email } : {}),
        ...(row.remote_user_id ? { remoteUserId: row.remote_user_id } : {}), ...(row.email ? { email: row.email } : {}),
        ...(row.display_name ? { displayName: row.display_name } : {}), role: normalizeRole(row.normalized_role),
        ...(row.raw_role ? { rawRole: row.raw_role } : {}), ...(row.seat_type ? { seatType: row.seat_type } : {}),
        status: row.status, source: row.source, observedAt: iso(row.observed_at)
      })),
      invitations: invitations.map((row) => ({
        id: row.id, ...(row.account_id ? { accountId: row.account_id } : {}), email: row.email,
        role: normalizeRole(row.normalized_role), ...(row.raw_role ? { rawRole: row.raw_role } : {}),
        ...(row.seat_type ? { seatType: row.seat_type as 'default' | 'usage_based' } : {}), status: row.status,
        ...(row.invited_at ? { invitedAt: iso(row.invited_at) } : {}), observedAt: iso(row.observed_at)
      })),
      credentials,
      seatSlots: seats.map((row) => ({
        id: row.id, seatKey: row.seat_key, ...(row.current_email ? { email: row.current_email } : {}),
        ...(row.remote_user_id ? { remoteUserId: row.remote_user_id } : {}), ...(row.contact ? { contact: row.contact } : {}),
        ...(row.remark ? { remark: row.remark } : {}), ...(row.price ? { price: row.price } : {}),
        ...(row.expires_on ? { expiresOn: row.expires_on } : {}), expireReminder: row.expire_reminder,
        expireRemove: row.expire_remove, seatType: row.seat_type as 'default' | 'usage_based', status: row.status
      })),
      ...(settings ? { latestSettings: { payload: settings.payload, observedAt: iso(settings.observed_at) } } : {}),
      ...(billing ? { latestBilling: { payload: billing.payload, observedAt: iso(billing.observed_at) } } : {})
    };
  }
}

async function credentialViews(db: Kysely<Database>, predicate: ReturnType<typeof sql>) {
  const result = await sql<any>`select wc.*,a.email account_email,cpg.id pool_id,cpg.name pool_name,
    cqs.payload latest_quota,cqs.observed_at quota_observed_at
    from workspace_credentials wc join accounts a on a.id=wc.account_id
    left join credential_pool_groups cpg on cpg.id=wc.pool_group_id
    left join lateral (select payload,observed_at from credential_quota_snapshots where credential_id=wc.id order by observed_at desc limit 1) cqs on true
    where ${predicate} order by wc.created_at desc`.execute(db);
  return result.rows.map((row: any) => ({
    id: row.id, accountId: row.account_id, accountEmail: row.account_email, workspaceId: row.workspace_id,
    kind: row.kind as 'oauth' | 'pat', ...(row.pool_id ? { poolGroup: { id: row.pool_id, name: row.pool_name } } : {}),
    status: row.status, contentSha256: row.content_sha256, byteSize: Number(row.byte_size), createdAt: iso(row.created_at),
    ...(row.latest_quota ? { latestQuota: row.latest_quota, quotaObservedAt: iso(row.quota_observed_at) } : {})
  }));
}

function workspaceSummary(row: any): WorkspaceSummaryView {
  return {
    id: row.id, externalId: row.external_id, ...(row.name ? { name: row.name } : {}), status: row.status,
    plan: row.normalized_plan, ...(row.raw_plan_code ? { rawPlanCode: row.raw_plan_code } : {}),
    ...(row.next_renewal_at ? { nextRenewalAt: iso(row.next_renewal_at) } : {}),
    manageableAccountCount: Number(row.manageable_count), memberCount: Number(row.member_count),
    invitationCount: Number(row.invitation_count), seatSlotCount: Number(row.seat_count), credentialCount: Number(row.credential_count),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at)
  };
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(String(value)).toISOString();
}
function normalizePersonalPlan(value: string): PersonalPlan {
  return ['free', 'go', 'plus', 'pro_5x', 'pro_20x'].includes(value) ? value as any : 'unknown';
}
function normalizePrimaryPlan(value: string): UnifiedAccountSummaryView['primaryPlan'] {
  return ['free', 'go', 'plus', 'pro_5x', 'pro_20x', 'business_two_seat', 'business_usage_based', 'team_member'].includes(value)
    ? value as UnifiedAccountSummaryView['primaryPlan'] : 'unknown';
}
function normalizeProfileStatus(value: string): AccountProfileStatus {
  return ['stopped', 'queued', 'running', 'stopping', 'failed'].includes(value) ? value as AccountProfileStatus : 'unknown';
}
function normalizeLimitType(value: string): AccountLimitType {
  return ['weekly', 'monthly'].includes(value) ? value as AccountLimitType : 'unknown';
}
function normalizeRole(value: string): 'owner' | 'admin' | 'member' | 'analytics_viewer' | 'unknown' {
  return ['owner', 'admin', 'member', 'analytics_viewer'].includes(value) ? value as any : 'unknown';
}
