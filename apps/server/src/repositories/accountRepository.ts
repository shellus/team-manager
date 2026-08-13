import { sql, type Kysely, type Transaction } from 'kysely';
import { DEFAULT_ACCOUNT_GROUP_NAME, normalizeEmail, normalizeGroupName, requireEmail, requireGroupName } from '../domain/identity.js';
import type { AccountGroupRow, AccountRow, Database, PersonalSpaceRow } from '../database/schema.js';

export interface AccountListFilters {
  groupId?: string;
  hasManageableWorkspace?: boolean;
  isWorkspaceMember?: boolean;
  hasWorkspaceCredential?: boolean;
  hasGamBinding?: boolean;
  hasSession?: boolean;
  hasRunningProfile?: boolean;
  primaryPlan?: string;
  isBanned?: boolean;
  query?: string;
}

export interface AccountListItem extends AccountRow {
  group_name: string;
  has_manageable_workspace: boolean;
  personal_plan: string;
  primary_plan: string;
  limit_type: string;
  profile_status: string;
  lifecycle_at: Date | null;
  lifecycle_will_renew: boolean | null;
  workspace_count: number;
  credential_count: number;
}

export interface CreateAccountInput {
  email: string;
  groupId?: string;
  remark?: string | null;
  isBanned?: boolean;
  remoteUserId?: string | null;
  displayName?: string | null;
  remotePersonalAccountId?: string | null;
}

export class AccountRepository {
  constructor(private readonly db: Kysely<Database>) {}

  listGroups(): Promise<AccountGroupRow[]> {
    return this.db.selectFrom('account_groups').selectAll().orderBy('sort_order').orderBy('name').execute();
  }

  async createGroup(nameInput: string, sortOrder = 0): Promise<AccountGroupRow> {
    const name = requireGroupName(nameInput);
    return this.db.insertInto('account_groups').values({
      name,
      normalized_name: normalizeGroupName(name),
      sort_order: sortOrder
    }).returningAll().executeTakeFirstOrThrow();
  }

  async renameGroup(id: string, nameInput: string): Promise<AccountGroupRow> {
    const name = requireGroupName(nameInput);
    const updated = await this.db.updateTable('account_groups').set({
      name,
      normalized_name: normalizeGroupName(name)
    }).where('id', '=', id).returningAll().executeTakeFirst();
    if (!updated) throw new Error('账号分组不存在');
    return updated;
  }

  async deleteGroup(id: string): Promise<void> {
    const group = await this.db.selectFrom('account_groups').select(['is_default']).where('id', '=', id).executeTakeFirst();
    if (!group) throw new Error('账号分组不存在');
    if (group.is_default) throw new Error('默认分组不能删除');
    const count = await this.db.selectFrom('accounts').select(({ fn }) => fn.countAll<number>().as('count')).where('group_id', '=', id).executeTakeFirstOrThrow();
    if (Number(count.count) > 0) throw new Error('非空账号分组不能删除，请先移动账号');
    await this.db.deleteFrom('account_groups').where('id', '=', id).execute();
  }

  async defaultGroup(): Promise<AccountGroupRow> {
    return this.db.selectFrom('account_groups').selectAll().where('is_default', '=', true).executeTakeFirstOrThrow();
  }

  async create(input: CreateAccountInput): Promise<{ account: AccountRow; personalSpace: PersonalSpaceRow }> {
    const email = requireEmail(input.email);
    const execute = async (trx: Kysely<Database>) => {
      const groupId = input.groupId ?? (await trx.selectFrom('account_groups').select('id').where('is_default', '=', true).executeTakeFirstOrThrow()).id;
      const account = await trx.insertInto('accounts').values({
        group_id: groupId,
        email,
        normalized_email: normalizeEmail(email),
        remark: input.remark?.trim() || null,
        is_banned: input.isBanned ?? false,
        remote_user_id: input.remoteUserId ?? null,
        display_name: input.displayName ?? null,
        last_error: null,
        current_session_revision_id: null
      }).returningAll().executeTakeFirstOrThrow();
      const personalSpace = await trx.insertInto('personal_spaces').values({
        account_id: account.id,
        remote_account_id: input.remotePersonalAccountId ?? null
      }).returningAll().executeTakeFirstOrThrow();
      await trx.insertInto('account_operational_profiles').values({
        account_id: account.id,
        limit_type: 'unknown',
        proxy_url_ciphertext: null,
        proxy_url_nonce: null,
        proxy_url_auth_tag: null,
        proxy_url_key_version: null,
        account_manager_plan_code: null,
        account_manager_synced_at: null,
        profile_status: 'unknown',
        profile_checked_at: null
      }).execute();
      return { account, personalSpace };
    };
    return this.db.isTransaction ? execute(this.db) : this.db.transaction().execute(execute);
  }

  findByEmail(email: string): Promise<AccountRow | undefined> {
    return this.db.selectFrom('accounts').selectAll().where('normalized_email', '=', normalizeEmail(email)).executeTakeFirst();
  }

  findById(id: string): Promise<AccountRow | undefined> {
    return this.db.selectFrom('accounts').selectAll().where('id', '=', id).executeTakeFirst();
  }

  async update(id: string, input: {
    groupId?: string;
    remark?: string | null;
    isBanned?: boolean;
    displayName?: string | null;
    lastError?: string | null;
  }): Promise<AccountRow> {
    const patch: Record<string, unknown> = {};
    if (input.groupId !== undefined) patch.group_id = input.groupId;
    if (input.remark !== undefined) patch.remark = input.remark?.trim() || null;
    if (input.isBanned !== undefined) patch.is_banned = input.isBanned;
    if (input.displayName !== undefined) patch.display_name = input.displayName?.trim() || null;
    if (input.lastError !== undefined) patch.last_error = input.lastError?.trim() || null;
    if (Object.keys(patch).length === 0) {
      const existing = await this.findById(id);
      if (!existing) throw new Error('账号不存在');
      return existing;
    }
    const row = await this.db.updateTable('accounts').set(patch).where('id', '=', id).returningAll().executeTakeFirst();
    if (!row) throw new Error('账号不存在');
    return row;
  }

  async bindGamAccount(accountId: string, externalAccountRef: string): Promise<void> {
    const normalized = normalizeEmail(externalAccountRef);
    if (!normalized) throw new Error('GAM 账号引用不能为空');
    await this.db.insertInto('gam_bindings').values({
      account_id: accountId,
      external_account_ref: externalAccountRef.trim(),
      normalized_external_account_ref: normalized
    }).onConflict((oc) => oc.column('account_id').doUpdateSet({
      external_account_ref: externalAccountRef.trim(),
      normalized_external_account_ref: normalized
    })).execute();
  }

  async clearGamAccount(accountId: string): Promise<void> {
    await this.db.deleteFrom('gam_bindings').where('account_id', '=', accountId).execute();
  }

  async remove(id: string): Promise<void> {
    const result = await this.db.deleteFrom('accounts').where('id', '=', id).executeTakeFirst();
    if (Number(result.numDeletedRows) === 0) throw new Error('账号不存在');
  }

  async moveToGroup(accountId: string, groupId: string): Promise<AccountRow> {
    const updated = await this.db.updateTable('accounts').set({ group_id: groupId }).where('id', '=', accountId).returningAll().executeTakeFirst();
    if (!updated) throw new Error('账号不存在');
    return updated;
  }

  async list(filters: AccountListFilters = {}): Promise<AccountListItem[]> {
    let query = this.db.selectFrom('accounts as a')
      .innerJoin('account_groups as g', 'g.id', 'a.group_id')
      .innerJoin('account_operational_summaries as aos', 'aos.account_id', 'a.id')
      .selectAll('a')
      .select([
        'g.name as group_name',
        sql<boolean>`exists (
          select 1 from workspace_memberships wm
          join workspaces w on w.id = wm.workspace_id
          where wm.account_id = a.id and wm.status = 'active'
            and wm.normalized_role in ('owner', 'admin') and w.status = 'active'
        )`.as('has_manageable_workspace'),
        'aos.personal_plan',
        'aos.primary_plan',
        'aos.limit_type',
        'aos.profile_status',
        'aos.lifecycle_at',
        'aos.lifecycle_will_renew',
        sql<number>`(select count(distinct wm.workspace_id)::int from workspace_memberships wm where wm.account_id = a.id and wm.status = 'active')`.as('workspace_count'),
        sql<number>`(select count(*)::int from workspace_credentials wc where wc.account_id = a.id and wc.status = 'active')`.as('credential_count')
      ]);
    if (filters.groupId) query = query.where('a.group_id', '=', filters.groupId);
    if (filters.isBanned !== undefined) query = query.where('a.is_banned', '=', filters.isBanned);
    if (filters.query?.trim()) {
      const pattern = `%${filters.query.trim()}%`;
      query = query.where((eb) => eb.or([eb('a.email', 'ilike', pattern), eb('a.remark', 'ilike', pattern), eb('a.display_name', 'ilike', pattern)]));
    }
    if (filters.hasManageableWorkspace !== undefined) {
      query = query.where(sql<boolean>`exists (
        select 1 from workspace_memberships wm
        join workspaces w on w.id = wm.workspace_id
        where wm.account_id = a.id and wm.status = 'active'
          and wm.normalized_role in ('owner', 'admin') and w.status = 'active'
      )`, '=', filters.hasManageableWorkspace);
    }
    if (filters.isWorkspaceMember !== undefined) {
      query = query.where(sql<boolean>`exists (
        select 1 from workspace_memberships wm
        where wm.account_id = a.id and wm.status = 'active'
          and wm.normalized_role not in ('owner', 'admin')
      )`, '=', filters.isWorkspaceMember);
    }
    if (filters.hasWorkspaceCredential !== undefined) {
      query = query.where(sql<boolean>`exists (
        select 1 from workspace_credentials wc where wc.account_id = a.id and wc.status = 'active'
      )`, '=', filters.hasWorkspaceCredential);
    }
    if (filters.hasGamBinding !== undefined) {
      query = query.where(sql<boolean>`exists (
        select 1 from gam_bindings gb where gb.account_id = a.id
      )`, '=', filters.hasGamBinding);
    }
    if (filters.hasSession !== undefined) {
      query = query.where('a.current_session_revision_id', filters.hasSession ? 'is not' : 'is', null);
    }
    if (filters.hasRunningProfile !== undefined) {
      query = query.where(sql<boolean>`exists (select 1 from account_operational_profiles op where op.account_id=a.id and op.profile_status in ('queued','running','stopping'))`, '=', filters.hasRunningProfile);
    }
    if (filters.primaryPlan) query = query.where('aos.primary_plan', '=', filters.primaryPlan);
    return query
      .orderBy(sql<number>`case when aos.profile_status in ('queued','running','stopping') then 0 else 1 end`)
      .orderBy('a.updated_at', 'desc')
      .execute() as Promise<AccountListItem[]>;
  }

  static async ensureGroup(trx: Transaction<Database>, nameInput?: string | null): Promise<string> {
    const name = nameInput?.trim() || DEFAULT_ACCOUNT_GROUP_NAME;
    const normalized = normalizeGroupName(name);
    const existing = await trx.selectFrom('account_groups').select('id').where('normalized_name', '=', normalized).executeTakeFirst();
    if (existing) return existing.id;
    return trx.insertInto('account_groups').values({ name, normalized_name: normalized }).returning('id').executeTakeFirstOrThrow().then((row) => row.id);
  }
}
