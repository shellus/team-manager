import type { Kysely } from 'kysely';
import type { EditableMemberRole, SeatType } from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import { ChatGptApi } from '../chatgptApi.js';
import { fetchWorkspaceWebAccessTokenFromSessionToken } from '../chatgptWebSession.js';
import { AccountOperationalRepository } from '../repositories/accountOperationalRepository.js';
import { BillingRepository } from '../repositories/billingRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { normalizeEmail } from '../domain/identity.js';
import { ServiceError, asServiceError } from '../serviceError.js';
import type { Transport } from '../transport.js';
import { WorkspaceService } from './workspaceService.js';

export class WorkspaceOperationService {
  readonly #workspaces: WorkspaceRepository;
  readonly #billing: BillingRepository;
  constructor(
    private readonly db: Kysely<Database>,
    private readonly views: WorkspaceService,
    private readonly sessions: SessionRepository,
    private readonly operational: AccountOperationalRepository,
    private readonly transport: Transport
  ) {
    this.#workspaces = new WorkspaceRepository(db);
    this.#billing = new BillingRepository(db);
  }

  async refreshMembers(workspaceId: string, executorAccountId: string) {
    const { api } = await this.context(workspaceId, executorAccountId);
    const members = await api.listMembers();
    const observedAt = new Date();
    const existing = await this.db.selectFrom('workspace_memberships').selectAll().where('workspace_id', '=', workspaceId).execute();
    const seen = new Set<string>();
    for (const member of members) {
      const email = normalizeEmail(member.email ?? '');
      const account = email ? await this.db.selectFrom('accounts').select('id').where('normalized_email', '=', email).executeTakeFirst() : undefined;
      const row = await this.#workspaces.upsertMembership({
        workspaceId, accountId: account?.id ?? null, remoteUserId: member.userId,
        email: member.email, displayName: member.remoteName, rawRole: member.role,
        normalizedRole: normalizeRole(member.role), seatType: member.seat,
        status: 'active', observedAt, source: 'upstream_refresh'
      });
      seen.add(row.id);
    }
    for (const row of existing.filter((item) => item.status === 'active' && !seen.has(item.id))) {
      await this.db.updateTable('workspace_memberships').set({ status: 'removed', observed_at: observedAt })
        .where('id', '=', row.id).execute();
    }
    return this.views.detail(workspaceId);
  }

  async refreshInvitations(workspaceId: string, executorAccountId: string) {
    const { api } = await this.context(workspaceId, executorAccountId);
    const invitations = await api.listPendingInvites();
    const observedAt = new Date();
    const seenEmails = new Set<string>();
    for (const invitation of invitations) {
      const email = normalizeEmail(invitation.email);
      seenEmails.add(email);
      const account = await this.db.selectFrom('accounts').select('id').where('normalized_email', '=', email).executeTakeFirst();
      await this.db.insertInto('workspace_invitations').values({
        workspace_id: workspaceId, account_id: account?.id ?? null,
        remote_invitation_id: invitation.inviteId, email: invitation.email, normalized_email: email,
        raw_role: invitation.role, normalized_role: normalizeRole(invitation.role), seat_type: invitation.seat,
        status: 'pending', invited_at: invitation.createdTime || null, observed_at: observedAt
      }).onConflict((oc) => oc.columns(['workspace_id', 'normalized_email']).where('status', '=', 'pending').doUpdateSet({
        account_id: account?.id ?? null, remote_invitation_id: invitation.inviteId,
        raw_role: invitation.role, normalized_role: normalizeRole(invitation.role), seat_type: invitation.seat,
        observed_at: observedAt
      })).execute();
    }
    const pending = await this.db.selectFrom('workspace_invitations').selectAll()
      .where('workspace_id', '=', workspaceId).where('status', '=', 'pending').execute();
    for (const row of pending.filter((item) => !seenEmails.has(item.normalized_email))) {
      await this.db.updateTable('workspace_invitations').set({ status: 'revoked', observed_at: observedAt }).where('id', '=', row.id).execute();
    }
    return this.views.detail(workspaceId);
  }

  async refreshSettings(workspaceId: string, executorAccountId: string) {
    const { api } = await this.context(workspaceId, executorAccountId);
    const payload = await api.getSettings();
    await this.db.insertInto('workspace_setting_snapshots').values({ workspace_id: workspaceId, payload, observed_at: new Date() }).execute();
    return this.views.detail(workspaceId);
  }

  async refreshBilling(workspaceId: string, executorAccountId: string) {
    const { api } = await this.context(workspaceId, executorAccountId);
    const payload = await api.getBillingSnapshotRaw();
    await this.#billing.saveSnapshot({ kind: 'workspace', workspaceId }, payload, new Date());
    return this.views.detail(workspaceId);
  }

  async invite(workspaceId: string, executorAccountId: string, input: { email: string; seat: SeatType; role?: string }) {
    const { api } = await this.context(workspaceId, executorAccountId);
    await api.invite(input.email, input.seat, input.role || 'standard-user');
    return this.refreshInvitations(workspaceId, executorAccountId);
  }

  async revokeInvitation(workspaceId: string, executorAccountId: string, email: string) {
    const { api } = await this.context(workspaceId, executorAccountId);
    await api.revokePendingInvite(email);
    return this.refreshInvitations(workspaceId, executorAccountId);
  }

  async removeMember(workspaceId: string, executorAccountId: string, remoteUserId: string) {
    const { api } = await this.context(workspaceId, executorAccountId);
    await api.removeMember(remoteUserId);
    return this.refreshMembers(workspaceId, executorAccountId);
  }

  async setMemberSeat(workspaceId: string, executorAccountId: string, remoteUserId: string, seat: SeatType) {
    const { api } = await this.context(workspaceId, executorAccountId);
    await api.setMemberSeat(remoteUserId, seat);
    return this.refreshMembers(workspaceId, executorAccountId);
  }

  async setMemberRole(workspaceId: string, executorAccountId: string, remoteUserId: string, role: EditableMemberRole) {
    const { api } = await this.context(workspaceId, executorAccountId);
    await api.setMemberRole(remoteUserId, role);
    return this.refreshMembers(workspaceId, executorAccountId);
  }

  async rename(workspaceId: string, executorAccountId: string, name: string) {
    const { api, workspace } = await this.context(workspaceId, executorAccountId);
    await api.renameWorkspace(name);
    await this.#workspaces.upsert({
      externalId: workspace.external_id, name, status: workspace.status as 'active' | 'inactive' | 'unknown',
      rawPlanCode: workspace.raw_plan_code, normalizedPlan: workspace.normalized_plan as any,
      nextRenewalAt: workspace.next_renewal_at
    });
    return this.views.detail(workspaceId);
  }

  async patchSettings(workspaceId: string, executorAccountId: string, input: Record<string, unknown>) {
    const { api } = await this.context(workspaceId, executorAccountId);
    if (input.defaultSeat === 'default' || input.defaultSeat === 'usage_based') await api.setDefaultSeat(input.defaultSeat);
    else if (typeof input.workspaceReferralsEnabled === 'boolean') await api.setWorkspaceReferralsEnabled(input.workspaceReferralsEnabled);
    else if (typeof input.autoAcceptRequests === 'boolean') await api.setAutoAcceptRequests(input.autoAcceptRequests);
    else if (typeof input.personalAccessTokensEnabled === 'boolean') await api.setPersonalAccessTokensEnabled(input.personalAccessTokensEnabled);
    else if (typeof input.codexDeviceCodeAuthEnabled === 'boolean') await api.setCodexDeviceCodeAuthEnabled(input.codexDeviceCodeAuthEnabled);
    else if (typeof input.codexRemoteControlEnabled === 'boolean') await api.setCodexRemoteControlEnabled(input.codexRemoteControlEnabled);
    else if (typeof input.automaticReloadEnabled === 'boolean') await api.setAutomaticReloadEnabled(input.automaticReloadEnabled);
    else throw new ServiceError(400, '没有可更新的 Workspace 设置');
    return this.refreshSettings(workspaceId, executorAccountId);
  }

  private async context(workspaceId: string, executorAccountId: string) {
    try {
      await this.#workspaces.requireManageableBy(workspaceId, executorAccountId);
      const workspace = await this.#workspaces.findById(workspaceId);
      if (!workspace) throw new ServiceError(404, 'Workspace 不存在');
      let accessToken = await this.sessions.accessToken(executorAccountId, { kind: 'workspace', workspaceId });
      const proxy = await this.operational.proxy(executorAccountId);
      const refresh = async () => {
        const session = await this.sessions.currentSession(executorAccountId) as { sessionToken?: string } | undefined;
        if (!session?.sessionToken) throw new ServiceError(409, '执行账号缺少可换取 Workspace Token 的 sessionToken');
        const token = await fetchWorkspaceWebAccessTokenFromSessionToken(this.transport, session.sessionToken, workspace.external_id, proxy);
        await this.sessions.saveAccessToken(executorAccountId, { kind: 'workspace', workspaceId }, token, { status: 'valid', checkedAt: new Date() });
        return token;
      };
      if (!accessToken) accessToken = await refresh();
      return {
        workspace,
        api: new ChatGptApi({ accountId: workspace.external_id, accessToken, proxy, refreshWebAccessToken: refresh }, this.transport)
      };
    } catch (error) { throw asServiceError(error); }
  }
}

function normalizeRole(value: string): 'owner' | 'admin' | 'member' | 'analytics_viewer' | 'unknown' {
  if (['account-owner', 'owner'].includes(value)) return 'owner';
  if (['account-admin', 'admin'].includes(value)) return 'admin';
  if (value === 'analytics-viewer') return 'analytics_viewer';
  if (['standard-user', 'member'].includes(value)) return 'member';
  return 'unknown';
}
