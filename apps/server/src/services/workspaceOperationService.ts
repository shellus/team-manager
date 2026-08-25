import type { Kysely } from 'kysely';
import type {
  EditableMemberRole,
  SeatType,
  WorkspaceMemberRemovalResult,
  WorkspacePromotionApplyResultView,
  WorkspacePromotionPreviewView,
  WorkspacePromotionSubscriptionView,
  WorkspaceSettingMutationInput
} from '@team-manager/shared';
import type {
  ChatGptAccountCheckEntry,
  ChatGptMemberRemovalResponse,
  ChatGptPromotionEligibilityResponse,
  ChatGptPromotionMetadataResponse,
  ChatGptSubscriptionResponse
} from '../chatgptApi.js';
import type { Database } from '../database/schema.js';
import { ChatGptApi } from '../chatgptApi.js';
import {
  fetchChatGptWebAccessTokenFromSessionToken,
  fetchWorkspaceExchangeSessionFromSessionToken
} from '../chatgptWebSession.js';
import { AccountOperationalRepository } from '../repositories/accountOperationalRepository.js';
import { BillingRepository } from '../repositories/billingRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { normalizeEmail } from '../domain/identity.js';
import { fixedSeatCapacity, subscriptionSeatsInUse } from '../domain/fixedSeat.js';
import { ServiceError, asServiceError } from '../serviceError.js';
import type { Transport } from '../transport.js';
import { WorkspaceService } from './workspaceService.js';
import { ActivityLogRepository } from '../repositories/activityLogRepository.js';
import { normalizeWorkspacePlan, normalizeWorkspaceRole } from '../domain/workspace.js';
import type { AccountManagerService } from './accountManagerService.js';

export class WorkspaceOperationService {
  readonly #workspaces: WorkspaceRepository;
  readonly #billing: BillingRepository;
  readonly #activity: ActivityLogRepository;
  constructor(
    private readonly db: Kysely<Database>,
    private readonly views: WorkspaceService,
    private readonly sessions: SessionRepository,
    private readonly operational: AccountOperationalRepository,
    private readonly transport: Transport,
    private readonly accountManagement?: AccountManagerService
  ) {
    this.#workspaces = new WorkspaceRepository(db);
    this.#billing = new BillingRepository(db);
    this.#activity = new ActivityLogRepository(db);
  }

  async syncAccountRelationships(accountId: string) {
    try {
      const account = await this.db.selectFrom('accounts').select(['id', 'email', 'normalized_email'])
        .where('id', '=', accountId).executeTakeFirst();
      if (!account) throw new ServiceError(404, '账号不存在');
      const personal = await this.db.selectFrom('personal_spaces').select(['id', 'remote_account_id'])
        .where('account_id', '=', accountId).executeTakeFirstOrThrow();
      const session = await this.sessions.currentSession(accountId) as {
        account?: { id?: string };
        accessToken?: string;
        sessionToken?: string;
      } | undefined;
      const remoteAccountId = personal.remote_account_id ?? session?.account?.id?.trim();
      if (!remoteAccountId) throw new ServiceError(409, '账号缺少可用的本地 ChatGPT Session');

      let accessToken = await this.sessions.accessToken(accountId, {
        kind: 'personal', personalSpaceId: personal.id
      }) ?? session?.accessToken?.trim();
      if (!accessToken) throw new ServiceError(409, '账号缺少可用的本地 ChatGPT Session');
      const proxy = await this.operational.proxy(accountId);
      const refreshAccessToken = async () => {
        if (!session?.sessionToken) {
          throw new ServiceError(409, 'Access Token 已失效，账号缺少可换取新 Token 的 sessionToken');
        }
        const refreshed = await fetchChatGptWebAccessTokenFromSessionToken(
          this.transport, session.sessionToken, remoteAccountId, proxy
        );
        await this.sessions.saveAccessToken(accountId, {
          kind: 'personal', personalSpaceId: personal.id
        }, refreshed, { status: 'valid', checkedAt: new Date() });
        return refreshed;
      };

      const api = new ChatGptApi({
        accountId: remoteAccountId,
        accessToken,
        proxy,
        refreshWebAccessToken: session?.sessionToken ? refreshAccessToken : undefined
      }, this.transport);
      const observedAt = new Date();
      const visibleWorkspaces = (await api.checkAccounts()).filter((item) =>
        item.structure === 'workspace' && item.canAccessWithSession !== false
      );

      return await this.db.transaction().execute(async (trx) => {
        const workspaces = new WorkspaceRepository(trx);
        const existing = await trx.selectFrom('workspace_memberships')
          .selectAll().where('account_id', '=', accountId).where('status', '=', 'active').execute();
        const existingByWorkspace = new Map(existing.map((item) => [item.workspace_id, item]));
        const seen = new Set<string>();

        for (const item of visibleWorkspaces) {
          const knownWorkspace = await workspaces.findByExternalId(item.accountId);
          const workspace = await workspaces.upsert({
            externalId: item.accountId,
            name: item.workspaceName ?? knownWorkspace?.name ?? null,
            status: 'active',
            rawPlanCode: item.planType ?? knownWorkspace?.raw_plan_code ?? null,
            normalizedPlan: item.planType
              ? normalizeWorkspacePlan(item.planType)
              : normalizeWorkspacePlan(knownWorkspace?.normalized_plan),
            nextRenewalAt: item.nextRenewalOn ?? knownWorkspace?.next_renewal_at ?? null
          });
          seen.add(workspace.id);
          const current = existingByWorkspace.get(workspace.id);
          if (current) {
            await trx.updateTable('workspace_memberships').set({
              email: account.email,
              normalized_email: account.normalized_email,
              ...(item.accountUserId ? { remote_user_id: item.accountUserId } : {}),
              raw_role: item.role ?? current.raw_role,
              normalized_role: item.role ? normalizeWorkspaceRole(item.role) : current.normalized_role,
              observed_at: observedAt,
              source: 'chatgpt_accounts_check'
            }).where('id', '=', current.id).execute();
          } else {
            await workspaces.upsertMembership({
              workspaceId: workspace.id,
              accountId,
              remoteUserId: item.accountUserId ?? null,
              email: account.email,
              rawRole: item.role ?? null,
              normalizedRole: normalizeWorkspaceRole(item.role),
              observedAt,
              source: 'chatgpt_accounts_check'
            });
          }
        }

        const removed = existing.filter((item) => !seen.has(item.workspace_id));
        if (removed.length) {
          await trx.updateTable('workspace_memberships').set({ status: 'removed', observed_at: observedAt })
            .where('id', 'in', removed.map((item) => item.id)).execute();
        }

        const disabledCredentialCount = removed.length
          ? Number((await trx.updateTable('workspace_credentials').set({
              status: 'disabled',
              disabled_at: observedAt
            }).where('account_id', '=', accountId).where('status', '=', 'active')
              .where('workspace_id', 'in', removed.map((item) => item.workspace_id))
              .executeTakeFirst()).numUpdatedRows)
          : 0;

        await new ActivityLogRepository(trx).log({
          accountId,
          kind: 'account_workspace_relationships_refreshed',
          payload: {
            activeCount: seen.size,
            removedCount: removed.length,
            disabledCredentialCount
          }
        });
        return {
          observedAt: observedAt.toISOString(),
          activeCount: seen.size,
          removedCount: removed.length,
          disabledCredentialCount
        };
      });
    } catch (error) {
      throw asServiceError(error);
    }
  }

  async refreshManageableBillingForAccount(accountId: string): Promise<number> {
    const rows = await this.db.selectFrom('workspace_memberships as membership')
      .innerJoin('workspaces as workspace', 'workspace.id', 'membership.workspace_id')
      .select('workspace.id')
      .where('membership.account_id', '=', accountId)
      .where('membership.status', '=', 'active')
      .where('membership.normalized_role', 'in', ['owner', 'admin'])
      .where('workspace.status', '=', 'active')
      .execute();
    for (const row of rows) await this.refreshBilling(row.id, accountId);
    return rows.length;
  }

  async removeAccountWorkspaceExitRecord(accountId: string, workspaceId: string) {
    try {
      return await this.db.transaction().execute(async (trx) => {
        const account = await trx.selectFrom('accounts').select(['id', 'email'])
          .where('id', '=', accountId).executeTakeFirst();
        if (!account) throw new ServiceError(404, '账号不存在');
        const workspace = await trx.selectFrom('workspaces').select(['id', 'external_id', 'name'])
          .where('id', '=', workspaceId).forUpdate().executeTakeFirst();
        if (!workspace) throw new ServiceError(404, 'Workspace 不存在');

        const activeRelationship = await trx.selectFrom('workspace_memberships').select('id')
          .where('workspace_id', '=', workspaceId).where('account_id', '=', accountId)
          .where('status', '=', 'active').executeTakeFirst();
        if (activeRelationship) throw new ServiceError(409, '账号仍有活动 Workspace 关系，不能删除退出记录');

        const removedRelationships = await trx.selectFrom('workspace_memberships').select('id')
          .where('workspace_id', '=', workspaceId).where('account_id', '=', accountId)
          .where('status', '=', 'removed').execute();
        if (removedRelationships.length === 0) throw new ServiceError(404, '已退出 Workspace 记录不存在');

        await trx.deleteFrom('workspace_memberships')
          .where('id', 'in', removedRelationships.map((item) => item.id)).execute();
        await new ActivityLogRepository(trx).log({
          accountId,
          workspaceId,
          kind: 'account_workspace_exit_record_removed',
          payload: {
            email: account.email,
            externalId: workspace.external_id,
            name: workspace.name,
            deletedMembershipCount: removedRelationships.length
          }
        });
        return { deleted: true as const, deletedMembershipCount: removedRelationships.length };
      });
    } catch (error) {
      throw asServiceError(error);
    }
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
    await this.reconcileCredentials(workspaceId);
    return this.views.detailForAccount(workspaceId, executorAccountId);
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
    await this.reconcileCredentials(workspaceId);
    return this.views.detailForAccount(workspaceId, executorAccountId);
  }

  async refreshPeople(workspaceId: string, executorAccountId: string) {
    await this.refreshMembers(workspaceId, executorAccountId);
    return this.refreshInvitations(workspaceId, executorAccountId);
  }

  async refreshSettings(workspaceId: string, executorAccountId: string) {
    const { api } = await this.context(workspaceId, executorAccountId);
    const [settings, automaticReload] = await Promise.all([
      api.getSettings(),
      api.getAutomaticReloadSettings().catch(() => undefined)
    ]);
    const payload = { ...settings, ...(automaticReload ? { automatic_reload: automaticReload } : {}) };
    await this.db.insertInto('workspace_setting_snapshots').values({ workspace_id: workspaceId, payload, observed_at: new Date() }).execute();
    return this.views.detailForAccount(workspaceId, executorAccountId);
  }

  async refreshBilling(workspaceId: string, executorAccountId: string) {
    const { api } = await this.context(workspaceId, executorAccountId);
    const payload = await api.getBillingSnapshotRaw();
    await this.#billing.saveSnapshot({ kind: 'workspace', workspaceId }, payload, new Date());
    await this.refreshSubscription(workspaceId, executorAccountId);
    return this.views.detailForAccount(workspaceId, executorAccountId);
  }

  async billing(workspaceId: string) { return this.#billing.detail({ kind: 'workspace', workspaceId }); }
  async invoice(workspaceId: string, invoiceId: string) { const item=await this.#billing.invoice({kind:'workspace',workspaceId},invoiceId); if(!item)throw new ServiceError(404,'发票不存在'); return item; }

  async refreshSubscription(workspaceId: string, executorAccountId: string) {
    const { api, workspace } = await this.context(workspaceId, executorAccountId);
    const [account, subscription] = await Promise.all([api.checkAccount(), api.getSubscription()]);
    await this.saveSubscriptionSnapshot(workspaceId, workspace, account, subscription);
    return this.subscription(workspaceId);
  }

  async cancelRenewal(workspaceId: string, executorAccountId: string) {
    const { api, workspace } = await this.context(workspaceId, executorAccountId);
    const before = await api.getSubscription();
    if (!['team', 'business'].includes(before.plan_type?.trim().toLowerCase() ?? '')) {
      throw new ServiceError(409, '该 Workspace 当前没有可取消续费的 Team/Business 套餐');
    }
    if (typeof before.will_renew !== 'boolean') throw new ServiceError(502, 'ChatGPT Workspace 订阅响应缺少续费状态');
    let after = before;
    if (before.will_renew !== false) {
      await api.cancelSubscriptionRenewal();
      after = await waitForRenewalCancellation(() => api.getSubscription());
      if (after.will_renew !== false) throw new ServiceError(502, 'ChatGPT 已接受取消请求，但尚未确认 Workspace 停止续费');
    }
    const account = await api.checkAccount();
    await this.saveSubscriptionSnapshot(workspaceId, workspace, account, after);
    await this.activity(executorAccountId, workspaceId, 'workspace_subscription_renewal_cancelled', {
      idempotent: before.will_renew === false,
      planType: before.plan_type ?? null,
      activeUntil: before.active_until ?? null
    });
    return this.subscription(workspaceId);
  }

  async previewPromotion(workspaceId: string, executorAccountId: string, input: { promoCode?: string }): Promise<WorkspacePromotionPreviewView> {
    const promoCode = promotionCode(input.promoCode);
    const { api } = await this.context(workspaceId, executorAccountId);
    const eligibility = await api.getPromotionEligibility(promoCode);
    if (eligibility.is_eligible !== true) return workspacePromotionPreview(promoCode, eligibility, undefined, {});
    const [metadata, subscription] = await Promise.all([
      api.getPromotionMetadata(promoCode),
      api.getSubscription()
    ]);
    return workspacePromotionPreview(promoCode, eligibility, metadata, subscription);
  }

  async applyPromotion(workspaceId: string, executorAccountId: string, input: { promoCode?: string; acknowledgeRenewal?: boolean }): Promise<WorkspacePromotionApplyResultView> {
    const promoCode = promotionCode(input.promoCode);
    const { api, workspace } = await this.context(workspaceId, executorAccountId);
    const eligibility = await api.getPromotionEligibility(promoCode);
    if (eligibility.is_eligible !== true) throw promotionIneligible(eligibility);
    const [metadata, before] = await Promise.all([
      api.getPromotionMetadata(promoCode),
      api.getSubscription()
    ]);
    assertPromotionSubscription(before);
    if (promotionRequiresRenewalAcknowledgement(before) && input.acknowledgeRenewal !== true) {
      throw new ServiceError(409, '应用优惠码可能恢复 Workspace 续费，请先确认续费影响');
    }
    assertBusinessPromotion(metadata);
    await api.updateSubscriptionPromoCode(promoCode);
    let result: WorkspacePromotionApplyResultView;
    let activityKind: 'workspace_promotion_applied' | 'workspace_promotion_unverified';
    try {
      const [account, after] = await Promise.all([api.checkAccount(), api.getSubscription()]);
      await this.saveSubscriptionSnapshot(workspaceId, workspace, account, after);
      result = workspacePromotionApplyResult(promoCode, before, after);
      activityKind = 'workspace_promotion_applied';
    } catch (error) {
      const verificationError = error instanceof Error ? error.message : String(error);
      result = {
        promoCode,
        accepted: true,
        verified: false,
        before: promotionSubscription(before),
        verificationError
      };
      activityKind = 'workspace_promotion_unverified';
    }
    await this.activity(executorAccountId, workspaceId, activityKind, result as unknown as Record<string, unknown>).catch(() => undefined);
    return result;
  }

  async subscription(workspaceId: string) {
    const row = await this.db.selectFrom('workspace_subscription_snapshots').selectAll().where('workspace_id', '=', workspaceId).orderBy('observed_at', 'desc').executeTakeFirst();
    return row ? { observedAt: new Date(row.observed_at as any).toISOString(), plan: row.normalized_plan,
      rawPlanCode: row.raw_plan_code, status: row.status, willRenew: row.will_renew,
      effectiveAt: row.effective_at ? new Date(row.effective_at as any).toISOString() : undefined,
      endsAt: row.ends_at ? new Date(row.ends_at as any).toISOString() : undefined,
      ...(row.fixed_seat_capacity === null ? {} : { fixedSeatCapacity: row.fixed_seat_capacity }),
      ...(row.subscription_seats_in_use === null ? {} : { subscriptionSeatsInUse: row.subscription_seats_in_use }) } : undefined;
  }

  async settings(workspaceId: string) {
    const row = await this.db.selectFrom('workspace_setting_snapshots').selectAll().where('workspace_id', '=', workspaceId).orderBy('observed_at', 'desc').executeTakeFirst();
    return row ? { payload: row.payload, observedAt: new Date(row.observed_at as any).toISOString() } : undefined;
  }

  async invite(workspaceId: string, executorAccountId: string, input: { email: string; seat?: SeatType; role?: string }) {
    const { api } = await this.context(workspaceId, executorAccountId);
    await api.invite(input.email, input.seat, input.role || 'standard-user');
    await this.activity(executorAccountId,workspaceId,'workspace_invitation_created',{
      email: normalizeEmail(input.email), ...(input.seat ? { seat: input.seat } : {}), role: input.role || 'standard-user'
    });
    return this.refreshInvitations(workspaceId, executorAccountId);
  }

  async revokeInvitation(workspaceId: string, executorAccountId: string, email: string) {
    const { api } = await this.context(workspaceId, executorAccountId);
    await api.revokePendingInvite(email);
    await this.activity(executorAccountId,workspaceId,'workspace_invitation_revoked',{email:normalizeEmail(email)});
    return this.refreshInvitations(workspaceId, executorAccountId);
  }

  async removeMember(workspaceId: string, executorAccountId: string, remoteUserId: string): Promise<WorkspaceMemberRemovalResult> {
    const { api } = await this.context(workspaceId, executorAccountId);
    const member=await this.db.selectFrom('workspace_memberships').select(['email','seat_type']).where('workspace_id','=',workspaceId).where('remote_user_id','=',remoteUserId).where('status','=','active').executeTakeFirst();
    const result=await api.removeMember(remoteUserId);
    if(result.success===false)throw new ServiceError(502,'上游返回成员移除失败');
    const summary=memberRemovalSummary(remoteUserId,member,result);
    await this.activity(executorAccountId,workspaceId,'workspace_member_removed',{...summary,billingNotice:result.billing_notice??null,policyNotice:result.policy_notice??null});
    return {workspace:await this.refreshMembers(workspaceId, executorAccountId),summary};
  }

  async updateMemberRole(workspaceId: string, executorAccountId: string, remoteUserId: string, role: EditableMemberRole) {
    const { api } = await this.context(workspaceId, executorAccountId);
    const member = await this.db.selectFrom('workspace_memberships').select('id')
      .where('workspace_id', '=', workspaceId).where('remote_user_id', '=', remoteUserId)
      .where('status', '=', 'active').executeTakeFirst();
    if (!member) throw new ServiceError(404, '成员不存在或已失效');
    await api.setMemberRole(remoteUserId, role);
    await this.db.updateTable('workspace_memberships').set({
      raw_role: role, normalized_role: normalizeRole(role), observed_at: new Date(), source: 'upstream_mutation'
    }).where('workspace_id', '=', workspaceId).where('remote_user_id', '=', remoteUserId)
      .where('status', '=', 'active').execute();
    await this.activity(executorAccountId,workspaceId,'workspace_member_role_changed',{remoteUserId,role});
    return this.views.detailForAccount(workspaceId, executorAccountId);
  }

  async updateMemberSeat(workspaceId: string, executorAccountId: string, remoteUserId: string, seat: SeatType) {
    const { api } = await this.context(workspaceId, executorAccountId);
    const member = await this.db.selectFrom('workspace_memberships').select('normalized_email')
      .where('workspace_id', '=', workspaceId).where('remote_user_id', '=', remoteUserId)
      .where('status', '=', 'active').executeTakeFirst();
    if (!member) throw new ServiceError(404, '成员不存在或已失效');
    await api.setMemberSeat(remoteUserId, seat);
    await this.db.transaction().execute(async (trx) => {
      await trx.updateTable('workspace_memberships').set({
        seat_type: seat, observed_at: new Date(), source: 'upstream_mutation'
      }).where('workspace_id', '=', workspaceId).where('remote_user_id', '=', remoteUserId)
        .where('status', '=', 'active').execute();
      if (member.normalized_email) await trx.updateTable('seat_slots').set({ seat_type: seat })
        .where('workspace_id', '=', workspaceId).where('normalized_current_email', '=', member.normalized_email).execute();
    });
    await this.activity(executorAccountId,workspaceId,'workspace_member_seat_changed',{remoteUserId,seat});
    return this.views.detailForAccount(workspaceId, executorAccountId);
  }

  async rename(workspaceId: string, executorAccountId: string, name: string) {
    const { api, workspace } = await this.context(workspaceId, executorAccountId);
    await api.renameWorkspace(name);
    await this.#workspaces.upsert({
      externalId: workspace.external_id, name, status: workspace.status as 'active' | 'inactive' | 'unknown',
      rawPlanCode: workspace.raw_plan_code, normalizedPlan: workspace.normalized_plan as any,
      nextRenewalAt: workspace.next_renewal_at
    });
    await this.activity(executorAccountId,workspaceId,'workspace_renamed',{name});
    return this.views.detailForAccount(workspaceId, executorAccountId);
  }

  async updateSetting(workspaceId: string, executorAccountId: string, input: WorkspaceSettingMutationInput) {
    const { api } = await this.context(workspaceId, executorAccountId);
    switch (input.key) {
      case 'defaultSeat': await api.setDefaultSeat(input.value); break;
      case 'workspaceReferralsEnabled': await api.setWorkspaceReferralsEnabled(input.value); break;
      case 'autoAcceptRequests': await api.setAutoAcceptRequests(input.value); break;
      case 'personalAccessTokensEnabled': await api.setPersonalAccessTokensEnabled(input.value); break;
      case 'codexDeviceCodeAuthEnabled': await api.setCodexDeviceCodeAuthEnabled(input.value); break;
      case 'codexRemoteControlEnabled': await api.setCodexRemoteControlEnabled(input.value); break;
      case 'automaticReloadEnabled': await api.setAutomaticReloadEnabled(input.value); break;
    }
    const latest = await this.db.selectFrom('workspace_setting_snapshots').select('payload')
      .where('workspace_id', '=', workspaceId).orderBy('observed_at', 'desc').executeTakeFirst();
    const payload = workspaceSettingPayload(latest?.payload ?? {}, input);
    await this.db.insertInto('workspace_setting_snapshots').values({ workspace_id: workspaceId, payload, observed_at: new Date() }).execute();
    await this.activity(executorAccountId,workspaceId,'workspace_settings_changed',{key:input.key,value:input.value});
    return this.views.detailForAccount(workspaceId, executorAccountId);
  }

  private async saveSubscriptionSnapshot(
    workspaceId: string,
    workspace: NonNullable<Awaited<ReturnType<WorkspaceRepository['findById']>>>,
    account: Pick<ChatGptAccountCheckEntry, 'planType' | 'workspaceName' | 'nextRenewalOn'>,
    subscription: ChatGptSubscriptionResponse
  ) {
    const rawPlan = subscription.plan_type ?? account.planType;
    const observedAt = new Date();
    await this.db.transaction().execute(async (trx) => {
      await trx.insertInto('workspace_subscription_snapshots').values({
        workspace_id: workspaceId,
        normalized_plan: normalizeWorkspacePlan(rawPlan),
        raw_plan_code: rawPlan ?? null,
        status: subscription.is_delinquent ? 'delinquent' : rawPlan ? 'active' : 'unknown',
        will_renew: typeof subscription.will_renew === 'boolean' ? subscription.will_renew : null,
        effective_at: subscription.active_start ?? null,
        ends_at: subscription.active_until ?? account.nextRenewalOn ?? null,
        fixed_seat_capacity: fixedSeatCapacity(subscription.seats_entitled) ?? null,
        subscription_seats_in_use: subscriptionSeatsInUse(subscription.seats_in_use) ?? null,
        payload: { account, subscription },
        observed_at: observedAt
      }).execute();
      await trx.updateTable('workspaces').set({
        name: account.workspaceName ?? workspace.name,
        raw_plan_code: rawPlan ?? workspace.raw_plan_code,
        normalized_plan: normalizeWorkspacePlan(rawPlan),
        next_renewal_at: subscription.active_until ?? account.nextRenewalOn ?? workspace.next_renewal_at
      }).where('id', '=', workspaceId).execute();
    });
  }

  private async context(workspaceId: string, executorAccountId: string) {
    try {
      await this.#workspaces.requireManageableBy(workspaceId, executorAccountId);
      const workspace = await this.#workspaces.findById(workspaceId);
      if (!workspace) throw new ServiceError(404, 'Workspace 不存在');
      let accessToken = await this.sessions.accessToken(executorAccountId, { kind: 'workspace', workspaceId });
      let proxy = await this.operational.proxy(executorAccountId);
      if (!proxy) proxy = await this.accountManagement?.ensureHttpProxy(executorAccountId).catch(() => undefined);
      const refresh = async () => {
        const session = await this.sessions.currentSession(executorAccountId) as { sessionToken?: string } | undefined;
        if (!session?.sessionToken) throw new ServiceError(409, '执行账号缺少可换取 Workspace Token 的 sessionToken');
        const exchanged = await fetchWorkspaceExchangeSessionFromSessionToken(this.transport, session.sessionToken, workspace.external_id, proxy);
        const token = exchanged.accessToken;
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

  private async reconcileCredentials(workspaceId: string) {
    const rows = await this.db.selectFrom('workspace_credentials as c').innerJoin('accounts as a', 'a.id', 'c.account_id')
      .select(['c.id', 'c.account_id', 'a.normalized_email']).where('c.workspace_id', '=', workspaceId).execute();
    for (const row of rows) {
      const eligible = await this.db.selectFrom('workspace_memberships').select('id').where('workspace_id', '=', workspaceId)
        .where('account_id', '=', row.account_id).where('status', '=', 'active').executeTakeFirst()
        ?? await this.db.selectFrom('workspace_invitations').select('id').where('workspace_id', '=', workspaceId)
          .where('normalized_email', '=', row.normalized_email).where('status', '=', 'pending').executeTakeFirst();
      await this.db.updateTable('workspace_credentials').set({ status: eligible ? 'active' : 'disabled', disabled_at: eligible ? null : new Date() })
        .where('id', '=', row.id).execute();
    }
  }
  private activity(accountId:string,workspaceId:string,kind:string,payload:Record<string,unknown>){return this.#activity.log({accountId,workspaceId,kind,payload});}
}

async function waitForRenewalCancellation(
  read: () => Promise<ChatGptSubscriptionResponse>
): Promise<ChatGptSubscriptionResponse> {
  let value = await read();
  for (let attempt = 1; attempt < 5 && value.will_renew !== false; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    value = await read();
  }
  return value;
}

export function memberRemovalSummary(remoteUserId:string,member:{email:string|null;seat_type:string|null}|undefined,result:ChatGptMemberRemovalResponse):WorkspaceMemberRemovalResult['summary']{
  const policy=record(result.policy_notice);const number=(key:string)=>typeof policy?.[key]==='number'&&Number.isFinite(policy[key])?policy[key] as number:undefined;const string=(key:string)=>typeof policy?.[key]==='string'&&String(policy[key]).trim()?String(policy[key]).trim():undefined;
  const parsedPolicy=policy?{...optional('kind',string('kind')),...optional('billedSeatDelta',number('billed_seat_delta')),...optional('vacancyOrdinal',number('vacancy_ordinal')),...optional('freeVacancyThreshold',number('free_vacancy_threshold')),...optional('expiresAt',string('expires_at')),...optional('billingStartsAt',string('billing_starts_at')),...optional('replacementRequired',typeof policy.replacement_required==='boolean'?policy.replacement_required:undefined)}:undefined;
  const seatType:SeatType|undefined=member?.seat_type==='default'||member?.seat_type==='usage_based'?member.seat_type:undefined;
  return {remoteUserId,...optional('email',member?.email??undefined),...optional('seatType',seatType),...optional('upstreamSuccess',result.success),hasBillingNotice:result.billing_notice!==undefined,...(parsedPolicy&&Object.keys(parsedPolicy).length?{policy:parsedPolicy}:{})};
}
function record(value:unknown):Record<string,unknown>|undefined{return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:undefined;}
function optional<K extends string,V>(key:K,value:V|undefined):Record<K,V>|Record<string,never>{return value===undefined?{}:{[key]:value} as Record<K,V>;}

export function workspaceSettingPayload(payload: Record<string, unknown>, input: WorkspaceSettingMutationInput): Record<string, unknown> {
  switch (input.key) {
    case 'defaultSeat': return { ...payload, default_seat_type: input.value };
    case 'workspaceReferralsEnabled': return { ...payload, workspace_referrals_enabled: input.value };
    case 'autoAcceptRequests': return { ...payload, auto_accept_requests: input.value };
    case 'personalAccessTokensEnabled':
      return { ...payload, personal_access_tokens: input.value, beta_settings: { ...(record(payload.beta_settings) ?? {}), personal_access_tokens: input.value } };
    case 'codexDeviceCodeAuthEnabled':
      return { ...payload, codex_device_code_auth: input.value, beta_settings: { ...(record(payload.beta_settings) ?? {}), codex_device_code_auth: input.value } };
    case 'codexRemoteControlEnabled':
      return { ...payload, codex_remote_control: input.value, beta_settings: { ...(record(payload.beta_settings) ?? {}), codex_remote_control: input.value } };
    case 'automaticReloadEnabled':
      return { ...payload, automatic_reload_enabled: input.value, automatic_reload: { ...(record(payload.automatic_reload) ?? {}), is_enabled: input.value } };
  }
}

function normalizeRole(value: string): 'owner' | 'admin' | 'member' | 'analytics_viewer' | 'unknown' {
  return normalizeWorkspaceRole(value);
}

function promotionCode(value?: string): string {
  const promoCode = value?.trim() ?? '';
  if (!promoCode) throw new ServiceError(400, '请输入优惠码');
  if (promoCode.length > 256) throw new ServiceError(400, '优惠码长度不能超过 256 个字符');
  return promoCode;
}

function promotionIneligible(value: ChatGptPromotionEligibilityResponse): ServiceError {
  const reason = record(value.ineligible_reason);
  const message = typeof reason?.message === 'string' && reason.message.trim()
    ? reason.message.trim()
    : typeof reason?.title === 'string' && reason.title.trim()
      ? reason.title.trim()
      : '优惠码不适用于当前 Workspace';
  return new ServiceError(409, message);
}

function assertBusinessPromotion(value: ChatGptPromotionMetadataResponse): void {
  if (value.is_eligible !== true) throw promotionIneligible(value);
  if (value.metadata?.plan_name !== 'chatgptteamplan') {
    throw new ServiceError(409, '优惠码不适用于 Business Workspace 套餐');
  }
}

export function workspacePromotionPreview(
  promoCode: string,
  eligibility: ChatGptPromotionEligibilityResponse,
  metadata: ChatGptPromotionMetadataResponse | undefined,
  subscription: ChatGptSubscriptionResponse
): WorkspacePromotionPreviewView {
  const rawMetadata = metadata?.metadata;
  const subscriptionEligible = ['team', 'business'].includes(subscription.plan_type?.toLowerCase() ?? '');
  const eligible = eligibility.is_eligible === true
    && metadata?.is_eligible === true
    && rawMetadata?.plan_name === 'chatgptteamplan'
    && subscriptionEligible;
  const upstreamReason = record(eligible ? undefined : metadata?.ineligible_reason ?? eligibility.ineligible_reason);
  const localReason = !subscriptionEligible
    ? { title: '订阅不适用', message: '当前 Workspace 不是可更新优惠码的 Business 订阅', code: 'subscription_plan_mismatch' }
    : !eligible && metadata?.is_eligible === true
      ? { title: '优惠码不适用', message: '优惠码不适用于 Business Workspace 套餐', code: 'plan_mismatch' }
      : !eligible
        ? { title: '优惠码不可用', message: '优惠码不适用于当前 Workspace', code: 'promotion_ineligible' }
        : undefined;
  const rawReason = upstreamReason ?? localReason;
  return {
    promoCode,
    isEligible: eligible,
    ...(rawReason ? { ineligibleReason: {
      ...(text(rawReason.title) ? { title: text(rawReason.title) } : {}),
      ...(text(rawReason.message) ? { message: text(rawReason.message) } : {}),
      ...(text(rawReason.code) ? { code: text(rawReason.code) } : {})
    } } : {}),
    ...(eligible && rawMetadata ? { metadata: {
      planName: rawMetadata.plan_name ?? '',
      ...(text(rawMetadata.title) ? { title: text(rawMetadata.title) } : {}),
      ...(text(rawMetadata.summary) ? { summary: text(rawMetadata.summary) } : {}),
      ...(finite(rawMetadata.discount?.quantity_off) !== undefined ? { quantityOff: finite(rawMetadata.discount?.quantity_off) } : {}),
      ...(finite(rawMetadata.duration?.num_periods) !== undefined ? { durationPeriods: finite(rawMetadata.duration?.num_periods) } : {}),
      ...(text(rawMetadata.duration?.period) ? { durationPeriod: text(rawMetadata.duration?.period) } : {}),
      ...(typeof rawMetadata.no_auto_renewal_at_discount_end === 'boolean' ? { noAutoRenewalAtDiscountEnd: rawMetadata.no_auto_renewal_at_discount_end } : {}),
      ...(text(rawMetadata.promotion_type) ? { promotionType: text(rawMetadata.promotion_type) } : {}),
      ...(text(rawMetadata.processor) ? { processor: text(rawMetadata.processor) } : {})
    } } : {}),
    subscription: promotionSubscription(subscription),
    wouldEnableRenewal: eligible && promotionRequiresRenewalAcknowledgement(subscription)
  };
}

export function workspacePromotionApplyResult(
  promoCode: string,
  before: ChatGptSubscriptionResponse,
  after: ChatGptSubscriptionResponse
): WorkspacePromotionApplyResultView {
  return {
    promoCode,
    accepted: true,
    verified: true,
    before: promotionSubscription(before),
    after: promotionSubscription(after),
    renewalEnabled: before.will_renew === false && after.will_renew === true
  };
}

function promotionSubscription(value: ChatGptSubscriptionResponse): WorkspacePromotionSubscriptionView {
  return {
    ...(text(value.plan_type) ? { planType: text(value.plan_type) } : {}),
    ...(finite(value.seats_in_use) !== undefined ? { seatsInUse: finite(value.seats_in_use) } : {}),
    ...(finite(value.seats_entitled) !== undefined ? { seatsEntitled: finite(value.seats_entitled) } : {}),
    ...(text(value.active_until) ? { activeUntil: text(value.active_until) } : {}),
    ...(text(value.billing_period) ? { billingPeriod: text(value.billing_period) } : {}),
    ...(text(value.billing_currency) ? { billingCurrency: text(value.billing_currency) } : {}),
    ...(typeof value.will_renew === 'boolean' ? { willRenew: value.will_renew } : {}),
    ...(text(value.cancellation_outcome) ? { cancellationOutcome: text(value.cancellation_outcome) } : {})
  };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function assertPromotionSubscription(value: ChatGptSubscriptionResponse): void {
  if (!['team', 'business'].includes(value.plan_type?.toLowerCase() ?? '')) {
    throw new ServiceError(409, '当前 Workspace 不是可更新优惠码的 Business 订阅');
  }
}

export function promotionRequiresRenewalAcknowledgement(value: ChatGptSubscriptionResponse): boolean {
  return value.will_renew !== true;
}
