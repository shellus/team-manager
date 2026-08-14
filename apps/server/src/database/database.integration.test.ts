import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { sql } from 'kysely';
import { createDatabase } from './connection.js';
import { migrateToLatest, pendingMigrations } from './migrator.js';
import { AccountRepository } from '../repositories/accountRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { SessionRepository } from '../repositories/sessionRepository.js';
import { SecretCipher } from '../secretCipher.js';
import { buildUnifiedApp } from '../unifiedApp.js';
import { ArtifactStore } from '../artifactStore.js';
import { ArtifactService } from '../services/artifactService.js';
import { ArtifactIndexRepository } from '../repositories/artifactIndexRepository.js';
import { SeatSlotService } from '../services/seatSlotService.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TeamOrderService } from '../services/teamOrderService.js';
import { NotificationService } from '../services/notificationService.js';
import { BillingRepository } from '../repositories/billingRepository.js';

const adminUrl = process.env.TEAMMGR_TEST_ADMIN_DATABASE_URL;

test('统一账号 PostgreSQL 模型与 API', { skip: !adminUrl, timeout: 60_000 }, async () => {
  const databaseName = `team_manager_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  const databaseUrl = databaseUrlFor(adminUrl!, databaseName);
  try {
    await admin.query(`create database ${quoteIdentifier(databaseName)}`);
    const db = createDatabase({ connectionString: databaseUrl, applicationName: 'team-manager-unified-test' });
    try {
      assert.deepEqual(await migrateToLatest(db), ['001_initial_unified_model', '002_complete_operational_fields', '003_add_quarantined_artifacts', '004_complete_product_runtime', '005_reliable_background_lifecycle', '006_operation_progress', '007_account_operational_primary_plan', '008_account_operational_visibility', '009_remove_seat_expire_reminder', '010_add_reminder_policy_defaults', '011_remove_account_display_name', '012_primary_plan_seat_usage']);
      assert.deepEqual(await migrateToLatest(db), []);
      assert.deepEqual(await pendingMigrations(db), []);
      assert.equal((await sql<{ matched: boolean }>`select jsonb_path_exists(
        ${JSON.stringify({ nested: { origin: 'ChatGPTTeamPlan' } })}::jsonb,
        '$.** ? (@ like_regex "chatgptteamplan" flag "i")'
      ) matched`.execute(db)).rows[0]?.matched, true);

      const accounts = new AccountRepository(db);
      const workspaces = new WorkspaceRepository(db);
      const group = await accounts.createGroup('Operators');
      const first = await accounts.create({ email: 'owner@example.com', groupId: group.id });
      const second = await accounts.create({ email: 'member@example.com', groupId: group.id });
      const outsider = await accounts.create({ email: 'outsider@example.com', groupId: group.id });
      await assert.rejects(accounts.create({ email: 'OWNER@example.com', groupId: group.id }), /duplicate key/i);
      const olderSortAccount = await accounts.create({ email: 'sort-order-older@example.com', groupId: group.id });
      const newerSortAccount = await accounts.create({ email: 'sort-order-newer@example.com', groupId: group.id });
      await db.updateTable('accounts').set({ created_at: new Date('2025-01-01T00:00:00Z') }).where('id', '=', olderSortAccount.account.id).execute();
      await db.updateTable('accounts').set({ created_at: new Date('2025-01-02T00:00:00Z') }).where('id', '=', newerSortAccount.account.id).execute();
      await accounts.update(olderSortAccount.account.id, { remark: '最近编辑但创建更早' });
      await db.updateTable('account_operational_profiles').set({ profile_status: 'running' }).where('account_id', '=', olderSortAccount.account.id).execute();
      assert.deepEqual((await accounts.list({ query: 'sort-order' })).map((item) => item.id), [
        newerSortAccount.account.id,
        olderSortAccount.account.id
      ], '账号列表严格按创建时间倒序，不受更新时间或 Profile 运行状态影响');
      const workspace = await workspaces.upsert({ externalId: 'workspace-external', name: 'Business', normalizedPlan: 'business' });
      await workspaces.upsertMembership({ workspaceId: workspace.id, accountId: first.account.id, remoteUserId:'owner-remote',email: first.account.email, normalizedRole: 'owner', seatType: 'default', observedAt: new Date(), source: 'test' });
      await workspaces.upsertMembership({ workspaceId: workspace.id, accountId: second.account.id, remoteUserId:'member-remote',email: second.account.email, normalizedRole: 'member', seatType: 'usage_based', observedAt: new Date(), source: 'test' });
      const scopedCredentials = await db.insertInto('workspace_credentials').values([
        { account_id: first.account.id, workspace_id: workspace.id, pool_group_id: null, kind: 'pat', external_id: 'owner-credential', storage_key: 'credentials/owner.json', content_sha256: 'owner-credential-sha', byte_size: 1, format_version: 1, eligibility_source: 'membership', status: 'active' },
        { account_id: second.account.id, workspace_id: workspace.id, pool_group_id: null, kind: 'pat', external_id: 'member-credential', storage_key: 'credentials/member.json', content_sha256: 'member-credential-sha', byte_size: 1, format_version: 1, eligibility_source: 'membership', status: 'active' }
      ]).returning(['id', 'account_id']).execute();
      assert.deepEqual((await accounts.list({ hasManageableWorkspace: true })).map((item) => item.email), ['owner@example.com']);
      assert.deepEqual((await accounts.list({ isWorkspaceMember: true })).map((item) => item.email), ['member@example.com']);

      const primaryPlanGroup = await accounts.createGroup('Primary plans');
      const createPlanAccount = async (name: string) => accounts.create({ email: `${name}@example.com`, groupId: primaryPlanGroup.id });
      const freeAccount = await createPlanAccount('primary-free');
      const paidOwner = await createPlanAccount('primary-paid-owner');
      const twoSeatOwner = await createPlanAccount('primary-two-seat');
      const usageOwner = await createPlanAccount('primary-usage');
      const bothOwner = await createPlanAccount('primary-both-owner');
      const memberOnly = await createPlanAccount('primary-member');
      const adminOnly = await createPlanAccount('primary-admin');
      const ownerAndMember = await createPlanAccount('primary-owner-member');
      const removedMember = await createPlanAccount('primary-removed');
      const inactiveMember = await createPlanAccount('primary-inactive');
      const billingOwner = await createPlanAccount('primary-billing');
      await db.insertInto('personal_subscription_snapshots').values({
        personal_space_id: paidOwner.personalSpace.id, normalized_plan: 'plus', raw_plan_code: 'chatgptplusplan',
        status: 'active', will_renew: true, effective_at: null, ends_at: new Date('2030-02-03T00:00:00Z'), payload: {}, observed_at: new Date()
      }).execute();
      const fixedWorkspace = await workspaces.upsert({ externalId: 'primary-fixed', normalizedPlan: 'business' });
      const usageWorkspace = await workspaces.upsert({ externalId: 'primary-usage', normalizedPlan: 'business_usage_based' });
      const laterFixedWorkspace = await workspaces.upsert({ externalId: 'primary-fixed-later', normalizedPlan: 'business' });
      const earlierFixedWorkspace = await workspaces.upsert({ externalId: 'primary-fixed-earlier', normalizedPlan: 'business' });
      const inactiveWorkspace = await workspaces.upsert({ externalId: 'primary-inactive', normalizedPlan: 'business', status: 'inactive' });
      const billingWorkspace = await workspaces.upsert({ externalId: 'primary-billing', normalizedPlan: 'business_usage_based' });
      const addMembership = (workspaceId: string, accountId: string, role: 'owner' | 'admin' | 'member', status: 'active' | 'removed' = 'active', seatType?: 'default' | 'usage_based') =>
        workspaces.upsertMembership({ workspaceId, accountId, normalizedRole: role, status, seatType, observedAt: new Date(), source: 'primary-plan-test' });
      await addMembership(fixedWorkspace.id, paidOwner.account.id, 'owner');
      await addMembership(fixedWorkspace.id, twoSeatOwner.account.id, 'owner');
      await addMembership(laterFixedWorkspace.id, twoSeatOwner.account.id, 'owner');
      await addMembership(earlierFixedWorkspace.id, twoSeatOwner.account.id, 'owner', 'active', 'default');
      await workspaces.upsertMembership({ workspaceId: earlierFixedWorkspace.id, email: 'fixed-seat-member@example.com', normalizedRole: 'member', seatType: 'default', observedAt: new Date(), source: 'primary-plan-seat-test' });
      await db.insertInto('workspace_invitations').values({
        workspace_id: earlierFixedWorkspace.id, account_id: null, remote_invitation_id: 'fixed-seat-invite',
        email: 'fixed-seat-invite@example.com', normalized_email: 'fixed-seat-invite@example.com', raw_role: 'standard-user',
        normalized_role: 'member', seat_type: 'default', status: 'pending', invited_at: new Date(), observed_at: new Date()
      }).execute();
      await addMembership(usageWorkspace.id, usageOwner.account.id, 'owner');
      await addMembership(usageWorkspace.id, bothOwner.account.id, 'owner');
      await addMembership(fixedWorkspace.id, bothOwner.account.id, 'owner');
      await addMembership(usageWorkspace.id, memberOnly.account.id, 'member');
      await addMembership(usageWorkspace.id, adminOnly.account.id, 'admin');
      await addMembership(usageWorkspace.id, ownerAndMember.account.id, 'owner');
      await addMembership(fixedWorkspace.id, ownerAndMember.account.id, 'member');
      await addMembership(usageWorkspace.id, removedMember.account.id, 'member', 'removed');
      await addMembership(inactiveWorkspace.id, inactiveMember.account.id, 'member');
      await addMembership(billingWorkspace.id, billingOwner.account.id, 'owner');
      const primaryBilling = new BillingRepository(db);
      await primaryBilling.saveSnapshot({ kind: 'workspace', workspaceId: billingWorkspace.id }, {
        upcomingInvoice: { lines: [{ metadata: { user_origin_tag: 'ChatGPTTeamPlan' } }] }
      }, new Date());
      const operationalRows = await db.selectFrom('account_operational_summaries').select(['account_id', 'primary_plan'])
        .where('account_id', 'in', [freeAccount.account.id, paidOwner.account.id, twoSeatOwner.account.id, usageOwner.account.id,
          bothOwner.account.id, memberOnly.account.id, adminOnly.account.id, ownerAndMember.account.id,
          removedMember.account.id, inactiveMember.account.id, billingOwner.account.id]).execute();
      const plans = new Map(operationalRows.map((row) => [row.account_id, row.primary_plan]));
      assert.equal(plans.get(freeAccount.account.id), 'free');
      assert.equal(plans.get(paidOwner.account.id), 'plus', '个人付费套餐优先于 owner Workspace');
      assert.equal(plans.get(twoSeatOwner.account.id), 'business_two_seat');
      assert.equal(plans.get(usageOwner.account.id), 'business_usage_based');
      assert.equal(plans.get(bothOwner.account.id), 'business_two_seat', '双席位优先于 0.52');
      assert.equal(plans.get(memberOnly.account.id), 'team_member');
      assert.equal(plans.get(adminOnly.account.id), 'team_member', 'admin 但非 owner 仍是 Team 子号');
      assert.equal(plans.get(ownerAndMember.account.id), 'business_usage_based', 'owner + member 不算 Team 子号');
      assert.equal(plans.get(removedMember.account.id), 'free', 'removed Membership 不参与判定');
      assert.equal(plans.get(inactiveMember.account.id), 'free', 'inactive Workspace 不参与判定');
      assert.equal(plans.get(billingOwner.account.id), 'business_two_seat', '固定席位账单证据优先于 usage-based Workspace plan');
      const paidLifecycle = await db.selectFrom('account_operational_summaries').select(['primary_plan','lifecycle_at','lifecycle_will_renew']).where('account_id','=',paidOwner.account.id).executeTakeFirstOrThrow();
      assert.equal(paidLifecycle.primary_plan,'plus');assert.equal(new Date(paidLifecycle.lifecycle_at!).toISOString(),'2030-02-03T00:00:00.000Z');assert.equal(paidLifecycle.lifecycle_will_renew,true);
      await db.updateTable('workspaces').set({ next_renewal_at: new Date('2031-06-01T00:00:00Z') }).where('id','=',laterFixedWorkspace.id).execute();
      await db.updateTable('workspaces').set({ next_renewal_at: new Date('2031-03-01T00:00:00Z') }).where('id','=',earlierFixedWorkspace.id).execute();
      const multipleOwnerLifecycle=await db.selectFrom('account_operational_summaries').select(['primary_plan','primary_workspace_id','primary_chatgpt_seat_count','lifecycle_at']).where('account_id','=',twoSeatOwner.account.id).executeTakeFirstOrThrow();
      assert.equal(multipleOwnerLifecycle.primary_plan,'business_two_seat');assert.equal(new Date(multipleOwnerLifecycle.lifecycle_at!).toISOString(),'2031-03-01T00:00:00.000Z','同类 owner Workspace 选择最早的未来续费时间');
      assert.equal(multipleOwnerLifecycle.primary_workspace_id,earlierFixedWorkspace.id,'席位统计使用与生命周期相同的代表 Workspace');assert.equal(multipleOwnerLifecycle.primary_chatgpt_seat_count,3,'统计活动成员与待接受邀请中的 default 席位');
      assert.deepEqual((await accounts.list({ primaryPlan: 'team_member' })).map((item) => item.email).sort(),
        ['member@example.com', 'primary-admin@example.com', 'primary-member@example.com']);

      const billing=new BillingRepository(db);await billing.saveSnapshot({kind:'personal',personalSpaceId:first.personalSpace.id},{invoices:{data:[{id:'invoice-envelope',amount_due:2600,currency:'cad',status:'paid',created:1781591356}]},payment_methods:{default_payment_method_id:'pm_default',payment_methods:[{id:'pm_default',card:{brand:'visa',last4:'4242',exp_month:12,exp_year:2030}}]},billing_info:{name:'Raw Name',address:{country:'CA'}},seat_type_counts:{seat_type_counts:{default:1,usage_based:2}},upcomingInvoice:{upcoming_invoice:{amount_due:3000}}},new Date('2026-08-13T00:00:00Z'));
      const billingDetail=await billing.detail({kind:'personal',personalSpaceId:first.personalSpace.id});assert.equal(billingDetail?.invoices[0].externalId,'invoice-envelope');assert.equal(billingDetail?.invoices[0].amountDue,2600);assert.equal(billingDetail?.paymentMethods[0].isDefault,true);assert.equal(billingDetail?.paymentMethods[0].brand,'visa');assert.deepEqual(billingDetail?.seatTypeCounts,{default:1,usageBased:2});assert.equal(billingDetail?.upcomingInvoice?.amountDue,3000);assert.equal(billingDetail?.billingIdentity?.address,'CA');assert.equal('payload' in (billingDetail??{}),false,'普通 API 不透传原始账单载荷');
      const historical=await db.insertInto('billing_snapshots').values({personal_space_id:first.personalSpace.id,workspace_id:null,payload:{invoices:{data:[{id:'historical-invoice',amount_due:9900,currency:'usd',status:'open',created:1781591356}]},payment_methods:{default_payment_method_id:'historical-pm',payment_methods:[{id:'historical-pm',card:{brand:'mastercard',last4:'4444',exp_month:11,exp_year:2031}}]},seat_type_counts:{seat_type_counts:{default:3,usage_based:4}}},observed_at:new Date('2026-08-14T00:00:00Z')}).returning('id').executeTakeFirstOrThrow();assert.equal((await db.selectFrom('billing_invoices').selectAll().where('billing_snapshot_id','=',historical.id).execute()).length,0);const historicalDetail=await billing.detail({kind:'personal',personalSpaceId:first.personalSpace.id});assert.equal(historicalDetail?.invoices[0].externalId,'historical-invoice');assert.equal(historicalDetail?.paymentMethods[0].last4,'4444');assert.equal(historicalDetail?.paymentMethods[0].isDefault,true);assert.equal((await billing.invoice({kind:'personal',personalSpaceId:first.personalSpace.id},'historical-invoice') as any)?.amount,9900);

      const sessions = new SessionRepository(db, new SecretCipher('0'.repeat(64), 'test-v1'));
      await sessions.saveRevision({ accountId: first.account.id, session: { user: { email: first.account.email }, account: { id: 'personal' }, accessToken: 'secret' }, source: 'test' });
      assert.equal((await sessions.currentSession(first.account.id) as any).accessToken, 'secret');
      await sessions.saveAccessToken(first.account.id,{kind:'workspace',workspaceId:workspace.id},'stale-workspace-token',{status:'valid'});
      assert.equal(await sessions.accessToken(first.account.id,{kind:'workspace',workspaceId:workspace.id}),'stale-workspace-token');
      assert.equal(await sessions.invalidateWorkspaceAccessTokens(first.account.id),1);
      assert.equal(await sessions.accessToken(first.account.id,{kind:'workspace',workspaceId:workspace.id}),undefined,'新 Session 保存后不能继续使用旧 Workspace Token');
      await accounts.bindGamAccount(first.account.id, first.account.email);

      const app = await buildUnifiedApp({
        database: db,
        config: { port: 0, dataDir: '/tmp', artifactDir: '/tmp', databaseUrl, dataEncryptionKey: '0'.repeat(64), dataEncryptionKeyVersion: 'test-v1', jwtSecret: 'secret', jwtIssuer: 'team-manager', adminUsername: 'admin', adminPassword: 'password', apiToken: 'test-token', allowedOrigins: [], webDistDir: '/missing' },
        accountManager: {
          operation: async (id) => operation(id),
          syncAccount: async () => ({ id: first.account.email, email: first.account.email, personalPlan: 'free',
            personalSubscription: { planType: 'free', willRenew: false },
            paymentMethods: [], workspaces: [{ id: workspace.external_id, name: workspace.name ?? undefined, planType: 'business', role: 'account-owner', seatType: 'default' }] }),
          changePersonalSubscription: async () => operation('personal-operation'),
          cancelPersonalSubscriptionRenewal: async () => operation('cancel-operation'),
          openBusinessSubscription: async (_account, input) => operation('business-operation', { workspaceId: input.workspaceId }),
          addPersonalPaymentMethod: async()=>operation('payment-operation'),
          startRegistration:async()=>operation('registration-operation')
        }
      });
      const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
      assert.equal((await app.request('/health')).status, 200);
      const batchGroup = await accounts.createGroup('Batch target');
      const batchResponse = await app.request('/api/accounts/bulk', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          accountIds: [first.account.id, second.account.id],
          groupId: batchGroup.id,
          isBanned: true
        })
      });
      assert.equal(batchResponse.status, 200, await batchResponse.clone().text());
      assert.deepEqual((await batchResponse.json() as any).data, { updatedCount: 2 });
      const batchRows = await db.selectFrom('accounts').select(['id', 'group_id', 'is_banned'])
        .where('id', 'in', [first.account.id, second.account.id]).execute();
      assert.equal(batchRows.every((row) => row.group_id === batchGroup.id && row.is_banned), true);
      const failedBatchResponse = await app.request('/api/accounts/bulk', {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ accountIds: [first.account.id, randomUUID()], groupId: group.id })
      });
      assert.equal(failedBatchResponse.status, 404);
      assert.equal((await accounts.findById(first.account.id))?.group_id, batchGroup.id,
        '任一账号不存在时批量操作整体回滚');
      assert.equal((await app.request('/api/accounts?hasManageableWorkspace=true', { headers })).status, 200);
      const primaryPlanResponse = await app.request('/api/accounts?primaryPlan=team_member', { headers });
      assert.equal(primaryPlanResponse.status, 200);
      const primaryPlanAccounts = (await primaryPlanResponse.json() as any).data;
      assert.deepEqual(primaryPlanAccounts.map((item: any) => item.email).sort(),
        ['member@example.com', 'primary-admin@example.com', 'primary-member@example.com']);
      assert.equal(primaryPlanAccounts[0].primaryPlan, 'team_member');
      assert.equal(primaryPlanAccounts[0].personalPlan, undefined, '列表摘要不暴露个人套餐事实字段');
      assert.equal(Object.hasOwn(primaryPlanAccounts[0], 'displayName'), false, '账号摘要不保留无业务用途的显示名');
      assert.equal(typeof primaryPlanAccounts[0].profileStatus, 'string');
      assert.equal(typeof primaryPlanAccounts[0].limitType, 'string');
      assert.equal(typeof primaryPlanAccounts[0].accessHealth.status, 'string');
      const twoSeatResponse = await app.request('/api/accounts?primaryPlan=business_two_seat', { headers });
      const twoSeatAccounts = (await twoSeatResponse.json() as any).data;
      assert.deepEqual(twoSeatAccounts.find((item: any) => item.id === twoSeatOwner.account.id)?.primaryPlanSeatUsage, { occupied: 3, capacity: 2 });
      assert.equal((await app.request('/api/accounts?personalPlan=pro_5x', { headers })).status, 400,
        '旧列表筛选不做静默兼容');
      assert.equal((await app.request('/api/parents', { headers })).status, 404);
      assert.equal((await app.request('/api/subaccounts', { headers })).status, 404);
      assert.equal((await app.request('/api/not-a-real-endpoint', { headers })).status, 404);

      const sessionResponse = await app.request(`/api/accounts/${first.account.id}/session`, { headers });
      assert.equal(sessionResponse.status, 200);
      assert.equal((await sessionResponse.json() as any).data.accessToken, 'secret');
      const editAccount = await app.request(`/api/accounts/${first.account.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ remark: 'Edited with session', session: { user: { email: first.account.email }, account: { id: 'personal-remote' }, accessToken: 'replacement-secret' } })
      });
      assert.equal(editAccount.status, 200, await editAccount.clone().text());
      const replacedSession = await app.request(`/api/accounts/${first.account.id}/session`, { headers });
      assert.equal((await replacedSession.json() as any).data.accessToken, 'replacement-secret');
      assert.equal((await app.request(`/api/accounts/${first.account.id}/session`, { method: 'PUT', headers, body: '{}' })).status, 404,
        'Session 更新只保留账号 PATCH 入口');
      const mismatchedEdit = await app.request(`/api/accounts/${first.account.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ remark: 'must-not-apply', session: { user: { email: 'mismatch@example.com' }, account: { id: 'personal-remote' }, accessToken: 'invalid' } })
      });
      assert.equal(mismatchedEdit.status, 409);
      assert.equal((await accounts.findById(first.account.id))?.remark, 'Edited with session', 'Session 校验失败时不提前写入账号字段');
      const syncResponse = await app.request(`/api/accounts/${first.account.id}/sync`, { method: 'POST', headers });
      assert.equal(syncResponse.status, 200);
      assert.equal((await db.selectFrom('personal_subscription_snapshots').selectAll().where('personal_space_id', '=', first.personalSpace.id).execute()).length, 1);
      const detailResponse = await app.request(`/api/accounts/${first.account.id}`, { headers });
      assert.equal(detailResponse.status, 200);
      assert.equal((await detailResponse.json() as any).data.personalPlan, 'free', '详情保留个人套餐事实');
      const accountWorkspaceResponse = await app.request(`/api/accounts/${first.account.id}/workspaces/${workspace.id}`, { headers });
      assert.equal(accountWorkspaceResponse.status, 200);
      assert.deepEqual((await accountWorkspaceResponse.json() as any).data.credentials.map((item: any) => item.id),
        [scopedCredentials.find((item) => item.account_id === first.account.id)!.id], '账号作用域 Workspace 详情不能泄漏其他账号凭证');
      const memberWorkspaceResponse = await app.request(`/api/accounts/${second.account.id}/workspaces/${workspace.id}`, { headers });
      assert.equal(memberWorkspaceResponse.status, 200);
      assert.deepEqual((await memberWorkspaceResponse.json() as any).data.credentials.map((item: any) => item.id),
        [scopedCredentials.find((item) => item.account_id === second.account.id)!.id]);
      assert.equal((await app.request(`/api/accounts/${outsider.account.id}/workspaces/${workspace.id}`, { headers })).status, 404,
        '没有成员关系的账号不能读取 Workspace 详情');
      await db.insertInto('workspace_invitations').values({
        workspace_id: workspace.id, account_id: outsider.account.id, remote_invitation_id: 'outsider-invite',
        email: outsider.account.email, normalized_email: outsider.account.email, raw_role: 'standard-user',
        normalized_role: 'member', seat_type: 'usage_based', status: 'pending', invited_at: new Date(), observed_at: new Date()
      }).execute();
      assert.equal((await app.request(`/api/accounts/${outsider.account.id}/workspaces/${workspace.id}`, { headers })).status, 200,
        '待接受邀请仍是有效的 Account × Workspace 上下文');
      const invitedAccount = await app.request(`/api/accounts/${outsider.account.id}`, { headers });
      assert.equal((await invitedAccount.json() as any).data.workspaces[0].membershipStatus, 'pending');
      await db.updateTable('workspace_memberships').set({ status: 'removed' })
        .where('workspace_id', '=', workspace.id).where('account_id', '=', second.account.id).execute();
      assert.equal((await app.request(`/api/accounts/${second.account.id}/workspaces/${workspace.id}`, { headers })).status, 404,
        '已移除的成员关系不能读取 Workspace 详情');
      const secondAfterRemoval = await app.request(`/api/accounts/${second.account.id}`, { headers });
      assert.equal(secondAfterRemoval.status, 200);
      assert.deepEqual((await secondAfterRemoval.json() as any).data.workspaces, [], '已移除的成员关系不能进入账号 Workspace 切换器');

      const personal = await app.request(`/api/accounts/${first.account.id}/personal-subscription`, { method: 'POST', headers, body: JSON.stringify({ targetPlan: 'plus', mode: 'start_new', country: 'US', currency: 'USD', autoPay: true, card: { number: '4242424242424242', expiryMonth: 12, expiryYear: 2030, cvc: '123' } }) });
      assert.equal(personal.status, 200, await personal.clone().text());
      const personalOperationId=(await personal.clone().json() as any).data.id;assert.match(personalOperationId,/^[0-9a-f-]{36}$/);assert.equal((await app.request(`/api/operations/${personalOperationId}`,{headers})).status,200);
      const stored = await db.selectFrom('automation_operations').selectAll().where('external_operation_id', '=', 'personal-operation').executeTakeFirstOrThrow();
      assert.equal(stored.id,personalOperationId);assert.equal(stored.progress,0);
      assert.equal(JSON.stringify(stored).includes('4242424242424242'), false);
      assert.equal(JSON.stringify(stored).includes('123'), false);

      const blocked = await app.request(`/api/accounts/${first.account.id}/personal-subscription`, { method: 'POST', headers, body: JSON.stringify({ targetPlan: 'pro_20x', mode: 'change_existing', country: 'US', currency: 'USD', autoPay: false }) });
      assert.equal(blocked.status, 409);
      const business = await app.request(`/api/accounts/${first.account.id}/business-subscription`, { method: 'POST', headers, body: JSON.stringify({ mode: 'upgrade_existing_workspace', workspaceId: workspace.id, country: 'US', currency: 'USD', autoPay: false }) });
      assert.equal(business.status, 200);
      const businessOperationId=(await business.clone().json() as any).data.id;assert.match(businessOperationId,/^[0-9a-f-]{36}$/);assert.equal((await app.request(`/api/operations/${businessOperationId}`,{headers})).status,200);

      const paymentMethod=await app.request(`/api/accounts/${first.account.id}/personal-payment-methods`,{method:'POST',headers,body:JSON.stringify({country:'US',currency:'USD',card:{number:'4242424242424242',expiryMonth:12,expiryYear:2030,cvc:'123'}})});assert.equal(paymentMethod.status,200,await paymentMethod.clone().text());const paymentOperationId=(await paymentMethod.json() as any).data.id;assert.match(paymentOperationId,/^[0-9a-f-]{36}$/);assert.equal((await app.request(`/api/operations/${paymentOperationId}`,{headers})).status,200);
      const registration=await app.request('/api/operations/registrations',{method:'POST',headers,body:JSON.stringify({email:'new@example.com',groupId:group.id,country:'US'})});assert.equal(registration.status,200,await registration.clone().text());const registrationOperationId=(await registration.json() as any).data.id;assert.match(registrationOperationId,/^[0-9a-f-]{36}$/);assert.equal((await app.request(`/api/operations/${registrationOperationId}`,{headers})).status,200);
      const registrationRows=await app.request('/api/account-registrations',{headers});assert.equal(registrationRows.status,200);assert.equal((await registrationRows.json() as any).data[0].email,'new@example.com');
      await accounts.update(first.account.id,{remark:'Visible Operator'});const remarkSearch=await app.request('/api/accounts?query=Visible%20Operator',{headers});assert.equal((await remarkSearch.json() as any).data[0].id,first.account.id);

      const operationRow = await db.selectFrom('automation_operations').select('id').where('external_operation_id', '=', 'business-operation').executeTakeFirstOrThrow();
      assert.equal((await app.request(`/api/operations/${operationRow.id}`, { headers })).status, 200);
      assert.ok((await db.selectFrom('automation_operation_events').selectAll().where('operation_id', '=', operationRow.id).execute()).length > 0);

      const unauthorizedSlot = await app.request(`/api/workspaces/${workspace.id}/seat-slots`, { method: 'POST', headers, body: JSON.stringify({ executorAccountId:outsider.account.id,email: 'customer@example.com', seatType: 'usage_based' }) });
      assert.equal(unauthorizedSlot.status,409,'普通成员不能维护客户资料');
      const invitedWithTenant=new SeatSlotService(db,{invite:async(_workspaceId:string,_executorId:string,input:any)=>{await db.insertInto('workspace_invitations').values({workspace_id:workspace.id,account_id:null,remote_invitation_id:'tenant-invite',email:input.email,normalized_email:input.email.toLowerCase(),raw_role:input.role??'standard-user',normalized_role:'member',seat_type:input.seat,status:'pending',invited_at:new Date(),observed_at:new Date()}).execute();}} as any);
      await invitedWithTenant.invite(workspace.id,first.account.id,{email:'tenant-invite@example.com',seat:'usage_based',role:'standard-user',contact:'tenant-contact',remark:'tenant-remark',price:'52',expiresOn:'2032-08-14'});
      const invitedTenantSlot=await db.selectFrom('seat_slots').selectAll().where('workspace_id','=',workspace.id).where('normalized_current_email','=','tenant-invite@example.com').executeTakeFirstOrThrow();
      assert.equal(invitedTenantSlot.status,'invited');assert.equal(invitedTenantSlot.contact,'tenant-contact');assert.equal(invitedTenantSlot.remark,'tenant-remark');assert.equal(invitedTenantSlot.price,'52');assert.equal(invitedTenantSlot.expires_on,'2032-08-14');
      await db.updateTable('workspace_memberships').set({remote_user_id:'owner-remote',email:first.account.email,normalized_email:first.account.email,seat_type:'default'})
        .where('workspace_id','=',workspace.id).where('account_id','=',first.account.id).where('status','=','active').execute();
      const slot = await app.request(`/api/workspaces/${workspace.id}/seat-slots`, { method: 'POST', headers, body: JSON.stringify({ executorAccountId:first.account.id,email: first.account.email, seatType: 'usage_based', contact: 'contact', expiresOn: '2030-01-01' }) });
      assert.equal(slot.status, 200);
      const slotData=(await slot.json() as any).data;const slotId = slotData.id;
      assert.equal(slotData.remote_user_id,'owner-remote');assert.equal(slotData.seat_type,'default','成员关系中的席位类型优先于资料提交值');
      assert.equal((await app.request(`/api/workspaces/${workspace.id}/seat-slots/${slotId}`, { method: 'PATCH', headers, body: JSON.stringify({ executorAccountId:first.account.id,remark: 'paid' }) })).status, 200);
      await db.updateTable('seat_slots').set({ expires_on: '2020-01-01', status: 'invited', expire_remove: false }).where('id', '=', slotId).execute();
      const expirationService = new SeatSlotService(db, {} as any);
      assert.equal((await expirationService.runExpirations(new Date('2026-01-01T00:00:00Z'))).disabled, 1);
      assert.equal((await expirationService.runExpirations(new Date('2026-01-01T00:01:00Z'))).disabled, 0);

      assert.equal((await app.request('/api/credential-pool-groups', { method: 'POST', headers, body: JSON.stringify({ name: 'pool-a' }) })).status, 200);
      assert.equal((await app.request('/api/overview/workspaces', { headers })).status, 200);
      assert.equal((await app.request('/api/settings/system/form-preferences', { method: 'PUT', headers, body: JSON.stringify({ country: 'US' }) })).status, 200);

      await db.insertInto('team_order_maintenances').values({workspace_id:workspace.id,executor_account_id:first.account.id,enabled:true,last_run_at:null,promo_code:null,country:'US',currency:'USD',next_run_at:new Date(),pause_reason:null,last_success_at:null,last_error:null}).execute();
      await db.insertInto('team_upgrade_orders').values({workspace_id:workspace.id,executor_account_id:first.account.id,external_order_id:null,checkout_url:null,expires_at:null,status:'running',configuration_snapshot:{country:'US',currency:'USD'},source:'manual',scheduled_for:new Date(),task_id:null,stripe_created_at:null,retry_at:null,attempt_count:1,error_message:null,completed_at:null}).execute();
      const orderService=new TeamOrderService(db,sessions,{} as any,{configured:false,generateOrder:async()=>{throw new Error('unused');}});await orderService.recover();
      assert.equal((await db.selectFrom('team_upgrade_orders').select('status').where('workspace_id','=',workspace.id).executeTakeFirstOrThrow()).status,'queued');

      const artifactRoot=await mkdtemp(join(tmpdir(),'team-manager-artifacts-'));const artifactStore=new ArtifactStore(artifactRoot);const artifactIndexes=new ArtifactIndexRepository(db,artifactStore);
      const artifactId=await artifactIndexes.save('rrweb',{fileName:'recording.json.gz',content:Buffer.from('raw-rrweb'),recordedAt:new Date('2020-01-01')});
      const artifactService=new ArtifactService(db,artifactStore,artifactRoot);await artifactService.markDelete('rrweb',artifactId,1);
      assert.equal((await artifactService.cleanup(new Date(Date.now()+1000))).removed,1);

      const orphan=await artifactStore.writeImmutable('traces','orphan.json',Buffer.from('{"raw":"orphan"}'));const orphanDiscoveredAt=new Date('2031-01-01T00:00:00Z');
      assert.equal((await artifactService.cleanup(orphanDiscoveredAt)).discovered,1);assert.equal((await artifactService.list('orphan'))[0].status,'pending_delete');assert.deepEqual(await artifactStore.read(orphan.storageKey,orphan.contentSha256),Buffer.from('{"raw":"orphan"}'));
      assert.equal((await artifactService.cleanup(new Date('2031-01-02T01:00:00Z'))).removed,1);assert.equal((await artifactService.list('orphan'))[0].status,'deleted');await assert.rejects(()=>artifactStore.read(orphan.storageKey,orphan.contentSha256));

      const policy=await db.insertInto('notification_policies').values({kind:'reliable-test',enabled:true,configuration:{webhookUrl:'https://notify.test'}}).returning('id').executeTakeFirstOrThrow();const notifications=new NotificationService(db,async()=>new Response('{}',{status:500}));const rawPayload={type:'test',secret:'raw-unredacted'};
      await assert.rejects(()=>notifications.send('reliable-test',rawPayload));const delivery=await db.selectFrom('notification_deliveries').selectAll().where('policy_id','=',policy.id).executeTakeFirstOrThrow();await assert.rejects(()=>notifications.retry(delivery.id));await assert.rejects(()=>notifications.retry(delivery.id));
      const finalDeliveries=await db.selectFrom('notification_deliveries').selectAll().where('policy_id','=',policy.id).execute();assert.equal(finalDeliveries.length,1);assert.equal(finalDeliveries[0].attempt_count,3);assert.equal(finalDeliveries[0].status,'exhausted');assert.deepEqual(finalDeliveries[0].payload,rawPayload);

      for(const [status,email] of [['member','member-expiry@example.com'],['invited','invited-expiry@example.com'],['empty',null],['unknown','unknown-expiry@example.com'],['disabled','disabled-expiry@example.com']] as const)await db.insertInto('seat_slots').values({workspace_id:workspace.id,seat_key:`reminder-${status}`,remote_user_id:null,current_email:email,normalized_current_email:email,contact:null,remark:null,price:null,expires_on:'2032-01-05',expire_remove:false,seat_type:'default',status}).execute();
      await db.insertInto('notification_policies').values({kind:'seat_expiration',enabled:true,configuration:{advanceDays:7,triggerTime:'08:00',timeZone:'Asia/Shanghai',webhookEnabled:true,webhookUrl:'https://notify.test'}}).onConflict(oc=>oc.column('kind').doUpdateSet({enabled:true,configuration:{advanceDays:7,triggerTime:'08:00',timeZone:'Asia/Shanghai',webhookEnabled:true,webhookUrl:'https://notify.test'}})).execute();
      let reminderItems:Record<string,unknown>[]=[];const reminderService=new SeatSlotService(db,{} as any,{notifySeatExpiry:async(items:Record<string,unknown>[])=>(reminderItems=items)} as any);const reminderResult=await reminderService.runExpirations(new Date('2032-01-01T00:00:00Z'));assert.equal(reminderResult.reminders,3);assert.deepEqual(reminderItems.map(item=>item.email).sort(),['invited-expiry@example.com','member-expiry@example.com','unknown-expiry@example.com']);
    } finally { await db.destroy(); }
  } finally {
    await admin.query(`drop database if exists ${quoteIdentifier(databaseName)} with (force)`).catch(() => undefined);
    await admin.end();
  }
});

function operation(id: string, requestSummary: Record<string, unknown> = {}) {
  return { id, type: id, status: 'queued' as const, phase: 'queued', progress: 0, requestSummary, createdAt: 1, updatedAt: 1 };
}
function databaseUrlFor(source: string, databaseName: string): string { const parsed = new URL(source); parsed.pathname = `/${databaseName}`; return parsed.toString(); }
function quoteIdentifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }
