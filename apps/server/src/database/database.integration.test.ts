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
import { AccountOperationalRepository } from '../repositories/accountOperationalRepository.js';
import { hashPassword } from '../auth/password.js';

const adminUrl = process.env.TEAMMGR_TEST_ADMIN_DATABASE_URL;

test('统一账号 PostgreSQL 模型与 API', { skip: !adminUrl, timeout: 60_000 }, async () => {
  const databaseName = `team_manager_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  const databaseUrl = databaseUrlFor(adminUrl!, databaseName);
  try {
    await admin.query(`create database ${quoteIdentifier(databaseName)}`);
    const db = createDatabase({ connectionString: databaseUrl, applicationName: 'team-manager-unified-test' });
    try {
      assert.deepEqual(await migrateToLatest(db), ['001_initial_unified_model', '002_complete_operational_fields', '003_add_quarantined_artifacts', '004_complete_product_runtime', '005_reliable_background_lifecycle', '006_operation_progress', '007_account_operational_primary_plan', '008_account_operational_visibility', '009_remove_seat_expire_reminder', '010_add_reminder_policy_defaults', '011_remove_account_display_name', '012_primary_plan_seat_usage', '013_retire_gam_business_snapshots', '014_variable_fixed_seat_capacity', '015_keep_only_current_account_session', '016_allow_unknown_seat_type', '017_persist_seat_expiration_removal_attempts', '018_add_explicit_seat_expiration_reminders', '019_notification_channel_delivery_state', '020_disable_legacy_channel_notification_policies', '021_derive_seat_slot_relationships', '022_preserve_seat_expiration_removal_outcomes']);
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
      const rebuildAccount = await accounts.create({ email: 'rebuild@example.com', groupId: group.id });
      await assert.rejects(accounts.create({ email: 'OWNER@example.com', groupId: group.id }), /duplicate key/i);
      const olderSortAccount = await accounts.create({ email: 'sort-order-older@example.com', groupId: group.id });
      const newerSortAccount = await accounts.create({ email: 'sort-order-newer@example.com', groupId: group.id });
      await db.updateTable('accounts').set({ created_at: new Date('2025-01-01T00:00:00Z') }).where('id', '=', olderSortAccount.account.id).execute();
      await db.updateTable('accounts').set({ created_at: new Date('2025-01-02T00:00:00Z') }).where('id', '=', newerSortAccount.account.id).execute();
      await accounts.update(olderSortAccount.account.id, { remark: '最近编辑但创建更早' });
      await db.updateTable('account_operational_profiles').set({ profile_status: 'running' }).where('account_id', '=', olderSortAccount.account.id).execute();
      assert.deepEqual((await accounts.list({ query: 'sort-order' })).map((item) => item.id), [
        olderSortAccount.account.id,
        newerSortAccount.account.id
      ], '账号列表默认按创建时间正序，不受更新时间或 Profile 运行状态影响');
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
      const fixedSeatOwner = await createPlanAccount('primary-fixed-seat');
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
      await addMembership(fixedWorkspace.id, fixedSeatOwner.account.id, 'owner');
      await addMembership(laterFixedWorkspace.id, fixedSeatOwner.account.id, 'owner');
      await addMembership(earlierFixedWorkspace.id, fixedSeatOwner.account.id, 'owner', 'active', 'default');
      await workspaces.upsertMembership({ workspaceId: earlierFixedWorkspace.id, email: 'fixed-seat-member@example.com', normalizedRole: 'member', seatType: 'default', observedAt: new Date(), source: 'primary-plan-seat-test' });
      await db.insertInto('workspace_invitations').values({
        workspace_id: earlierFixedWorkspace.id, account_id: null, remote_invitation_id: 'fixed-seat-invite',
        email: 'fixed-seat-invite@example.com', normalized_email: 'fixed-seat-invite@example.com', raw_role: 'standard-user',
        normalized_role: 'member', seat_type: 'default', status: 'pending', invited_at: new Date(), observed_at: new Date()
      }).execute();
      const fixedMemberSeatSlot = await db.insertInto('seat_slots').values({
        workspace_id: earlierFixedWorkspace.id, seat_key: 'fixed-seat-member-slot',
        current_email: 'fixed-seat-member@example.com', normalized_current_email: 'fixed-seat-member@example.com',
        contact: 'fixed-contact', remark: 'fixed-member-profile', price: '26', expires_on: '2032-09-01',
        expire_remove: false, seat_type: 'default'
      }).returningAll().executeTakeFirstOrThrow();
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
        .where('account_id', 'in', [freeAccount.account.id, paidOwner.account.id, fixedSeatOwner.account.id, usageOwner.account.id,
          bothOwner.account.id, memberOnly.account.id, adminOnly.account.id, ownerAndMember.account.id,
          removedMember.account.id, inactiveMember.account.id, billingOwner.account.id]).execute();
      const plans = new Map(operationalRows.map((row) => [row.account_id, row.primary_plan]));
      assert.equal(plans.get(freeAccount.account.id), 'unknown', '未观测个人订阅时不得默认推断为 free');
      assert.equal(plans.get(paidOwner.account.id), 'plus', '个人付费套餐优先于 owner Workspace');
      assert.equal(plans.get(fixedSeatOwner.account.id), 'business_fixed_seat');
      assert.equal(plans.get(usageOwner.account.id), 'business_usage_based');
      assert.equal(plans.get(bothOwner.account.id), 'business_fixed_seat', '固定席位 Business 优先于 0.52');
      assert.equal(plans.get(memberOnly.account.id), 'team_member');
      assert.equal(plans.get(adminOnly.account.id), 'team_member', 'admin 但非 owner 仍是 Team 子号');
      assert.equal(plans.get(ownerAndMember.account.id), 'business_usage_based', 'owner + member 不算 Team 子号');
      assert.equal(plans.get(removedMember.account.id), 'unknown', 'removed Membership 不参与判定');
      assert.equal(plans.get(inactiveMember.account.id), 'unknown', 'inactive Workspace 不参与判定');
      assert.equal(plans.get(billingOwner.account.id), 'business_fixed_seat', '固定席位账单证据优先于 usage-based Workspace plan');
      const paidLifecycle = await db.selectFrom('account_operational_summaries').select(['primary_plan','lifecycle_at','lifecycle_will_renew']).where('account_id','=',paidOwner.account.id).executeTakeFirstOrThrow();
      assert.equal(paidLifecycle.primary_plan,'plus');assert.equal(new Date(paidLifecycle.lifecycle_at!).toISOString(),'2030-02-03T00:00:00.000Z');assert.equal(paidLifecycle.lifecycle_will_renew,true);
      await db.updateTable('workspaces').set({ next_renewal_at: new Date('2031-06-01T00:00:00Z') }).where('id','=',laterFixedWorkspace.id).execute();
      await db.updateTable('workspaces').set({ next_renewal_at: new Date('2031-03-01T00:00:00Z') }).where('id','=',earlierFixedWorkspace.id).execute();
      await db.insertInto('workspace_subscription_snapshots').values({workspace_id:earlierFixedWorkspace.id,normalized_plan:'business',raw_plan_code:'team',status:'active',will_renew:true,effective_at:null,ends_at:new Date('2031-03-01T00:00:00Z'),fixed_seat_capacity:4,subscription_seats_in_use:4,payload:{subscription:{seats_entitled:4,seats_in_use:4}},observed_at:new Date()}).execute();
      const multipleOwnerLifecycle=await db.selectFrom('account_operational_summaries').select(['primary_plan','primary_workspace_id','primary_fixed_seat_occupied','primary_fixed_seat_capacity','lifecycle_at']).where('account_id','=',fixedSeatOwner.account.id).executeTakeFirstOrThrow();
      assert.equal(multipleOwnerLifecycle.primary_plan,'business_fixed_seat');assert.equal(new Date(multipleOwnerLifecycle.lifecycle_at!).toISOString(),'2031-03-01T00:00:00.000Z','同类 owner Workspace 选择最早的未来续费时间');
      assert.equal(multipleOwnerLifecycle.primary_workspace_id,earlierFixedWorkspace.id,'席位统计使用与生命周期相同的代表 Workspace');assert.equal(multipleOwnerLifecycle.primary_fixed_seat_occupied,3,'统计活动成员与待接受邀请中的 default 席位');assert.equal(multipleOwnerLifecycle.primary_fixed_seat_capacity,4,'容量来自同一代表 Workspace 的订阅权益');
      assert.deepEqual((await accounts.list({ primaryPlan: 'team_member' })).map((item) => item.email).sort(),
        ['member@example.com', 'primary-admin@example.com', 'primary-member@example.com']);

      const billing=new BillingRepository(db);await billing.saveSnapshot({kind:'personal',personalSpaceId:first.personalSpace.id},{invoices:{data:[{id:'invoice-envelope',amount_due:2600,currency:'cad',status:'paid',created:1781591356}]},payment_methods:{default_payment_method_id:'pm_default',payment_methods:[{id:'pm_default',card:{brand:'visa',last4:'4242',exp_month:12,exp_year:2030}}]},billing_info:{name:'Raw Name',address:{country:'CA'}},seat_type_counts:{seat_type_counts:{default:1,usage_based:2}},upcomingInvoice:{upcoming_invoice:{amount_due:3000}}},new Date('2026-08-13T00:00:00Z'));
      const billingDetail=await billing.detail({kind:'personal',personalSpaceId:first.personalSpace.id});assert.equal(billingDetail?.invoices[0].externalId,'invoice-envelope');assert.equal(billingDetail?.invoices[0].amountDue,2600);assert.equal(billingDetail?.paymentMethods[0].isDefault,true);assert.equal(billingDetail?.paymentMethods[0].brand,'visa');assert.deepEqual(billingDetail?.seatTypeCounts,{default:1,usageBased:2});assert.equal(billingDetail?.upcomingInvoice?.amountDue,3000);assert.equal(billingDetail?.billingIdentity?.address,'CA');assert.equal('payload' in (billingDetail??{}),false,'普通 API 不透传原始账单载荷');
      const historical=await db.insertInto('billing_snapshots').values({personal_space_id:first.personalSpace.id,workspace_id:null,payload:{invoices:{data:[{id:'historical-invoice',amount_due:9900,currency:'usd',status:'open',created:1781591356}]},payment_methods:{default_payment_method_id:'historical-pm',payment_methods:[{id:'historical-pm',card:{brand:'mastercard',last4:'4444',exp_month:11,exp_year:2031}}]},seat_type_counts:{seat_type_counts:{default:3,usage_based:4}}},observed_at:new Date('2026-08-14T00:00:00Z')}).returning('id').executeTakeFirstOrThrow();assert.equal((await db.selectFrom('billing_invoices').selectAll().where('billing_snapshot_id','=',historical.id).execute()).length,0);const historicalDetail=await billing.detail({kind:'personal',personalSpaceId:first.personalSpace.id});assert.equal(historicalDetail?.invoices[0].externalId,'historical-invoice');assert.equal(historicalDetail?.paymentMethods[0].last4,'4444');assert.equal(historicalDetail?.paymentMethods[0].isDefault,true);assert.equal((await billing.invoice({kind:'personal',personalSpaceId:first.personalSpace.id},'historical-invoice') as any)?.amount,9900);

      const sessions = new SessionRepository(db, new SecretCipher('0'.repeat(64), 'test-v1'));
      const operational = new AccountOperationalRepository(db, new SecretCipher('0'.repeat(64), 'test-v1'));
      await sessions.saveRevision({ accountId: first.account.id, session: { user: { email: first.account.email }, account: { id: 'personal' }, accessToken: 'secret', sessionToken: 'session-token' }, source: 'test' });
      assert.equal((await sessions.currentSession(first.account.id) as any).accessToken, 'secret');
      await sessions.saveRevision({ accountId: first.account.id, session: { user: { email: first.account.email }, account: { id: 'personal' }, accessToken: 'replacement', sessionToken: 'replacement-session-token' }, source: 'test-replacement' });
      assert.equal((await sessions.currentSession(first.account.id) as any).accessToken, 'replacement');
      assert.equal((await db.selectFrom('account_session_revisions').selectAll().where('account_id', '=', first.account.id).execute()).length, 1, '保存新 Session 后删除旧 Session');
      await sessions.replaceCurrent({ accountId: first.account.id, personalSpaceId: first.personalSpace.id, session: { user: { email: first.account.email }, account: { id: workspace.external_id }, accessToken: 'workspace-session-token' }, source: 'workspace-session-test' });
      assert.equal(await sessions.accessToken(first.account.id, { kind: 'workspace', workspaceId: workspace.id }), 'workspace-session-token', 'Workspace Session 的 AT 写入目标 Workspace 上下文');
      await sessions.saveAccessToken(first.account.id,{kind:'workspace',workspaceId:workspace.id},'stale-workspace-token',{status:'valid'});
      assert.equal(await sessions.accessToken(first.account.id,{kind:'workspace',workspaceId:workspace.id}),'stale-workspace-token');
      assert.equal(await sessions.invalidateWorkspaceAccessTokens(first.account.id),1);
      assert.equal(await sessions.accessToken(first.account.id,{kind:'workspace',workspaceId:workspace.id}),undefined,'新 Session 保存后不能继续使用旧 Workspace Token');
      await accounts.bindGamAccount(first.account.id, first.account.email);
      await sessions.saveRevision({
        accountId: rebuildAccount.account.id,
        session: {
          user: { email: rebuildAccount.account.email },
          account: { id: 'rebuild-personal' },
          accessToken: 'rebuild-access-token',
          sessionToken: 'rebuild-session-token'
        },
        source: 'test-rebuild'
      });
      await accounts.bindGamAccount(rebuildAccount.account.id, rebuildAccount.account.email);
      await operational.setProxy(rebuildAccount.account.id, 'http://stale-proxy.example:8080');
      await db.updateTable('account_operational_profiles').set({ profile_status: 'running' })
        .where('account_id', '=', rebuildAccount.account.id).execute();
      const renewalByAccount = new Map<string, boolean>();
      const personalPlanByAccount = new Map<string, string>();
      const missingPersonalSubscriptionAccounts = new Set<string>();
      const paymentInputs: Array<Record<string, unknown>> = [];
      const paymentMethodsByTarget = new Map<string, Array<{
        id: string; brand: string; last4: string; isDefault: boolean;
      }>>();
      const workspaceMutationRequests: Array<{ method: string; path: string; body?: Record<string, unknown> }> = [];
      const workspaceInvites: Array<Record<string, unknown>> = [];
      const completedOperations = new Set<string>();
      const acknowledgedRegistrationDeliveries: string[] = [];
      const removedGamAccounts: string[] = [];
      const importedGamAccounts: Array<Record<string, unknown>> = [];
      const workspaceOrderLinkInputs: any[] = [];

      const app = await buildUnifiedApp({
        database: db,
        config: { port: 0, dataDir: '/tmp', artifactDir: '/tmp', databaseUrl, dataEncryptionKey: '0'.repeat(64), dataEncryptionKeyVersion: 'test-v1', jwtSecret: 'secret', jwtIssuer: 'team-manager', adminUsername: 'admin', adminPasswordHash: await hashPassword('password'), apiToken: 'test-token', allowedOrigins: [], webDistDir: '/missing' },
        accountManager: {
          operation: async (id) => completedOperations.has(id)
            ? { ...operation(id), status: 'succeeded', phase: 'complete', progress: 100, completedAt: Date.now(), updatedAt: Date.now() }
            : operation(id),
          changePersonalSubscription: async () => operation('personal-operation'),
          openBusinessSubscription: async (_account, input) => operation('business-operation', { workspaceId: input.workspaceId }),
          accountHttpProxy: async()=>({proxy:'http://proxy.example:8080'}),
          deleteAccount: async(id)=>{removedGamAccounts.push(id);return true;},
          startAccountImport:async(input)=>{importedGamAccounts.push(input as unknown as Record<string, unknown>);return operation('rebuild-import-operation');},
          startRegistration:async()=>operation('registration-operation'),
          registrationSessionDelivery:async()=>({
            email:'new@example.com',
            session:{
              user:{email:'new@example.com'},account:{id:'new-personal-account'},
              accessToken:'new-registration-access-token',sessionToken:'new-registration-session-token'
            }
          }),
          acknowledgeRegistrationSessionDelivery:async(id)=>{acknowledgedRegistrationDeliveries.push(id);return true;}
        },
        teamCode: {
          configured: true,
          generateOrder: async (input) => {
            workspaceOrderLinkInputs.push(input);
            const index = workspaceOrderLinkInputs.length;
            return {
              taskId: `workspace-order-task-${index}`,
              payUrl: `https://checkout.stripe.com/c/pay/cs_test_workspace_order_${index}`,
              stripeCreatedAt: new Date('2026-08-25T08:00:00Z').getTime(),
              expiresAt: new Date('2026-08-26T08:00:00Z').getTime(),
              orderInformation: {
                country: input.config.country,
                currency: input.config.currency,
                requestedQuantity: input.config.seatQuantity,
                quantity: input.config.seatQuantity,
                subtotalMinor: 6000,
                discountMinor: input.config.promoCode ? 3000 : 0,
                taxMinor: 0,
                totalMinor: input.config.promoCode ? 3000 : 6000,
                checkoutStatus: 'open',
                paymentStatus: 'unpaid',
                automaticTaxStatus: 'complete',
                ...(input.targetWorkspaceId ? { actualWorkspaceId: input.targetWorkspaceId } : {}),
                workspaceStatus: input.targetWorkspaceId ? 'matched' : 'not_requested'
              }
            };
          }
        },
        paymentMethodBinder: {
          add: async (input) => {
            paymentInputs.push(input as unknown as Record<string, unknown>);
            const paymentMethods = [
              { id: `pm-${input.targetAccountId}`, brand: 'visa', last4: '4242', isDefault: true },
              { id: `pm-alt-${input.targetAccountId}`, brand: 'mastercard', last4: '4444', isDefault: false }
            ];
            paymentMethodsByTarget.set(input.targetAccountId, paymentMethods);
            return { targetAccountId: input.targetAccountId, paymentMethods };
          },
          setDefault: async (input) => {
            if (input.paymentMethodId === 'pm-upstream-401') {
              throw Object.assign(new Error('设置默认支付方式失败: HTTP 401'), { status: 401 });
            }
            const paymentMethods = (paymentMethodsByTarget.get(input.targetAccountId) ?? [])
              .map((item) => ({ ...item, isDefault: item.id === input.paymentMethodId }));
            paymentMethodsByTarget.set(input.targetAccountId, paymentMethods);
            return { targetAccountId: input.targetAccountId, paymentMethods };
          },
          remove: async (input) => {
            const paymentMethods = (paymentMethodsByTarget.get(input.targetAccountId) ?? [])
              .filter((item) => item.id !== input.paymentMethodId);
            paymentMethodsByTarget.set(input.targetAccountId, paymentMethods);
            return { targetAccountId: input.targetAccountId, paymentMethods };
          }
        },
        transport: {
          fetch: async (request) => {
            if (request.method !== 'GET') workspaceMutationRequests.push({
              method: request.method,
              path: request.path,
              ...(request.body ? { body: JSON.parse(request.body) as Record<string, unknown> } : {})
            });
            if (request.path === `/backend-api/accounts/${workspace.external_id}/settings/default_seat_type`) return { status: 200, body: '{}' };
            if (request.path === `/backend-api/accounts/${workspace.external_id}/users/member-remote`) return { status: 200, body: '{}' };
            if (request.path.startsWith(`/backend-api/accounts/${workspace.external_id}/users?`)) return {
              status: 200,
              body: JSON.stringify({ items: [
                { id: 'owner-remote', email: first.account.email, role: 'account-owner', seat_type: 'default', status: 'active' },
                { id: 'member-remote', email: second.account.email, role: 'standard-user', seat_type: 'usage_based', status: 'active' }
              ] })
            };
            if (request.path === `/backend-api/accounts/${workspace.external_id}/invites` && request.method === 'POST') {
              const body = JSON.parse(request.body ?? '{}') as { email_addresses?: string[]; role?: string; seat_type?: string };
              workspaceInvites.push({
                id: `invite-${workspaceInvites.length + 1}`, email_address: body.email_addresses?.[0],
                role: body.role ?? 'standard-user', status: 0, ...(body.seat_type ? { seat_type: body.seat_type } : {}),
                created_time: '2026-08-21T00:00:00Z', is_scim_managed: false
              });
              return { status: 200, body: '{}' };
            }
            if (request.path.startsWith(`/backend-api/accounts/${workspace.external_id}/invites?`)) {
              return { status: 200, body: JSON.stringify({ items: workspaceInvites }) };
            }
            if (request.path === '/backend-api/subscriptions/cancel') {
              renewalByAccount.set(request.headers['chatgpt-account-id'], false);
              return { status: 200, body: '{}' };
            }
            if (request.path.startsWith('/backend-api/subscriptions/update/preview?')) {
              return { status: 200, body: JSON.stringify({
                total_amount: 481902,
                positive_line_item_total: 579464,
                negative_line_item_total: -97562,
                currency: 'php',
                renewal_date: '2026-09-18T09:33:15Z',
                default_payment_method: { card_brand: 'mastercard', card_last4: '1461' }
              }) };
            }
            if (request.path === '/backend-api/subscriptions/update') {
              const body = JSON.parse(request.body ?? '{}') as { updated_plan?: string };
              const plan = body.updated_plan === 'chatgptprolite' ? 'prolite'
                : body.updated_plan === 'chatgptpro' ? 'pro'
                  : body.updated_plan;
              if (plan) personalPlanByAccount.set(request.headers['chatgpt-account-id'], plan);
              return { status: 200, body: '{"success":true}' };
            }
            if (request.path.startsWith('/backend-api/subscriptions?')) {
              const targetAccountId = request.headers['chatgpt-account-id'];
              if (missingPersonalSubscriptionAccounts.has(targetAccountId)) {
                return { status: 404, body: JSON.stringify({ detail: 'No subscription found for account' }) };
              }
              return {
                status: 200,
                body: JSON.stringify({
                  id: `${targetAccountId}-subscription`,
                  plan_type: targetAccountId === workspace.external_id
                    ? 'team'
                    : personalPlanByAccount.get(targetAccountId) ?? 'plus',
                  will_renew: renewalByAccount.get(targetAccountId) ?? true,
                  active_start: null,
                  active_until: null,
                  is_delinquent: false
                })
              };
            }
            if (request.path.startsWith('/backend-api/invoices/upcoming?')) return { status: 404, body: '{}' };
            if (request.path.startsWith('/backend-api/invoices?')) return { status: 200, body: JSON.stringify({ data: [] }) };
            if (request.path.startsWith('/backend-api/payments/payment_methods?')) {
              const target = new URL(request.path, 'https://chatgpt.com').searchParams.get('account_id') ?? '';
              const paymentMethods = paymentMethodsByTarget.get(target) ?? [];
              return { status: 200, body: JSON.stringify({
                default_payment_method_id: paymentMethods.find((item) => item.isDefault)?.id,
                payment_methods: paymentMethods.map((item) => ({
                  id: item.id,
                  card: { brand: item.brand, last4: item.last4, exp_month: 12, exp_year: 2030 }
                }))
              }) };
            }
            if (request.path.startsWith('/backend-api/payments/billing_info?')) return { status: 200, body: '{}' };
            if (request.path.endsWith('/users/seat_type_counts')) return { status: 200, body: '{}' };
            if (!request.path.startsWith('/backend-api/accounts/check/')) throw new Error(`unexpected direct ChatGPT request: ${request.path}`);
            const personalAccountId = request.headers['chatgpt-account-id'];
            const visibleAccounts: Record<string, unknown> = {
              [personalAccountId]: {
                account: {
                  account_id: personalAccountId,
                  account_user_role: 'account-owner',
                  structure: personalAccountId === workspace.external_id ? 'workspace' : 'personal',
                  plan_type: personalPlanByAccount.get(personalAccountId) ?? 'free'
                },
                can_access_with_session: true
              }
            };
            if (personalAccountId === 'workspace-sync-add-personal-account') {
              visibleAccounts['workspace-sync-added-workspace'] = {
                account: {
                  account_id: 'workspace-sync-added-workspace',
                  account_user_id: 'workspace-sync-added-user',
                  account_user_role: 'account-owner',
                  structure: 'workspace',
                  plan_type: 'self_serve_business_usage_based'
                },
                can_access_with_session: true
              };
            }
            return {
              status: 200,
              body: JSON.stringify({ accounts: visibleAccounts })
            };
          }
        }
      });
      const headers = { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' };
      const rebuilt = await app.request(`/api/accounts/${rebuildAccount.account.id}/account-manager/rebuild`, {
        method: 'POST',
        headers
      });
      assert.equal(rebuilt.status, 200, await rebuilt.clone().text());
      const rebuildOperation = (await rebuilt.json() as any).data;
      assert.match(rebuildOperation.id, /^[0-9a-f-]{36}$/);
      assert.equal(rebuildOperation.requestSummary.rebuild, true);
      assert.deepEqual(removedGamAccounts, [rebuildAccount.account.email]);
      assert.equal((importedGamAccounts[0] as any).authMethod, 'existing_session');
      assert.equal((importedGamAccounts[0] as any).session.sessionToken, 'rebuild-session-token');
      assert.equal(await db.selectFrom('gam_bindings').select('account_id')
        .where('account_id', '=', rebuildAccount.account.id).executeTakeFirst(), undefined,
      '发起重建后旧 GAM 绑定必须立即清除');
      assert.equal(await operational.proxy(rebuildAccount.account.id), undefined,
        '发起重建后旧 GAM 代理缓存必须清除');
      assert.equal((await db.selectFrom('account_operational_profiles').select('profile_status')
        .where('account_id', '=', rebuildAccount.account.id).executeTakeFirstOrThrow()).profile_status, 'unknown');
      assert.equal((await app.request('/health')).status, 200);
      const unauthorizedResponse = await app.request('/api/accounts', {
        headers: { Authorization: 'Bearer invalid-token' }
      });
      assert.equal(unauthorizedResponse.status, 401);
      assert.deepEqual(await unauthorizedResponse.json(), { ok: false, error: '未授权' });

      const workspaceSyncAccount = await accounts.create({ email: 'workspace-sync-empty@example.com', groupId: group.id });
      await sessions.saveRevision({
        accountId: workspaceSyncAccount.account.id,
        session: {
          user: { email: workspaceSyncAccount.account.email },
          account: { id: 'workspace-sync-personal-account' },
          accessToken: 'workspace-sync-access-token'
        },
        source: 'workspace-sync-test'
      });
      await sessions.saveAccessToken(
        workspaceSyncAccount.account.id,
        { kind: 'workspace', workspaceId: workspace.id },
        'workspace-sync-preserved-token',
        { status: 'valid' }
      );
      const workspaceSyncCredential = await db.insertInto('workspace_credentials').values({
        account_id: workspaceSyncAccount.account.id,
        workspace_id: workspace.id,
        pool_group_id: null,
        kind: 'pat',
        external_id: 'workspace-sync-credential',
        storage_key: 'credentials/workspace-sync.json',
        content_sha256: 'workspace-sync-credential-sha',
        byte_size: 1,
        format_version: 1,
        eligibility_source: 'membership',
        status: 'active'
      }).returning('id').executeTakeFirstOrThrow();
      await workspaces.upsertMembership({
        workspaceId: workspace.id,
        accountId: workspaceSyncAccount.account.id,
        remoteUserId: 'workspace-sync-removed-user',
        email: workspaceSyncAccount.account.email,
        normalizedRole: 'member',
        observedAt: new Date(),
        source: 'gam_sync'
      });
      const accountWorkspaceSync = await app.request(`/api/accounts/${workspaceSyncAccount.account.id}/workspaces/sync`, { method: 'POST', headers });
      assert.equal(accountWorkspaceSync.status, 200, await accountWorkspaceSync.clone().text());
      assert.equal((await db.selectFrom('workspace_memberships').select('status')
        .where('workspace_id', '=', workspace.id).where('account_id', '=', workspaceSyncAccount.account.id)
        .executeTakeFirstOrThrow()).status, 'removed', '账号关系同步把远端已退出 Workspace 标记为已移除');
      assert.equal((await db.selectFrom('workspace_credentials').select('status')
        .where('id', '=', workspaceSyncCredential.id).executeTakeFirstOrThrow()).status, 'disabled',
        '账号退出 Workspace 后停用对应活动凭证');
      assert.equal(await sessions.accessToken(
        workspaceSyncAccount.account.id,
        { kind: 'workspace', workspaceId: workspace.id }
      ), 'workspace-sync-preserved-token', '关系同步不主动推断或失效 Workspace Token');
      const workspaceSyncDetail = await app.request(`/api/accounts/${workspaceSyncAccount.account.id}`, { headers });
      const workspaceSyncDetailData = (await workspaceSyncDetail.json() as any).data;
      assert.deepEqual(workspaceSyncDetailData.workspaces, [], '关系同步后空间切换器不再显示已退出 Workspace');
      assert.deepEqual(workspaceSyncDetailData.removedWorkspaces.map((item: any) => item.id), [workspace.id],
        '已退出 Workspace 保留在本地清理入口中');
      const deleteActiveWorkspaceRecord = await app.request(
        `/api/accounts/${first.account.id}/workspaces/${workspace.id}/removed-record`,
        { method: 'DELETE', headers }
      );
      assert.equal(deleteActiveWorkspaceRecord.status, 409,
        '活动 Workspace 关系不能通过退出记录接口删除');
      const deleteRemovedWorkspaceRecord = await app.request(
        `/api/accounts/${workspaceSyncAccount.account.id}/workspaces/${workspace.id}/removed-record`,
        { method: 'DELETE', headers }
      );
      assert.equal(deleteRemovedWorkspaceRecord.status, 200, await deleteRemovedWorkspaceRecord.clone().text());
      assert.equal((await deleteRemovedWorkspaceRecord.json() as any).data.deletedMembershipCount, 1);
      assert.equal(await db.selectFrom('workspace_memberships').select('id')
        .where('workspace_id', '=', workspace.id).where('account_id', '=', workspaceSyncAccount.account.id)
        .where('status', '=', 'removed').executeTakeFirst(), undefined,
        '删除已退出记录只移除当前账号的 removed Membership');
      assert.ok(await db.selectFrom('workspaces').select('id').where('id', '=', workspace.id).executeTakeFirst(),
        '删除已退出记录保留仍由其他账号使用的 Workspace');
      assert.equal((await db.selectFrom('workspace_memberships').select('id')
        .where('workspace_id', '=', workspace.id).where('status', '=', 'active').execute()).length, 2,
        '删除已退出记录保留其他账号的活动关系');
      const detailAfterRemovedRecordDelete = await app.request(`/api/accounts/${workspaceSyncAccount.account.id}`, { headers });
      assert.deepEqual((await detailAfterRemovedRecordDelete.json() as any).data.removedWorkspaces, [],
        '删除后已退出 Workspace 不再出现在当前账号详情中');

      const soloRemovedAccount = await accounts.create({ email: 'solo-removed-workspace@example.com', groupId: group.id });
      const soloRemovedWorkspace = await workspaces.upsert({
        externalId: 'solo-removed-workspace',
        name: 'Solo removed Workspace',
        normalizedPlan: 'business'
      });
      await workspaces.upsertMembership({
        workspaceId: soloRemovedWorkspace.id,
        accountId: soloRemovedAccount.account.id,
        email: soloRemovedAccount.account.email,
        normalizedRole: 'member',
        status: 'removed',
        observedAt: new Date(),
        source: 'removed-record-delete-test'
      });
      const deleteSoloRemovedRecord = await app.request(
        `/api/accounts/${soloRemovedAccount.account.id}/workspaces/${soloRemovedWorkspace.id}/removed-record`,
        { method: 'DELETE', headers }
      );
      assert.equal(deleteSoloRemovedRecord.status, 200, await deleteSoloRemovedRecord.clone().text());
      assert.ok(await db.selectFrom('workspaces').select('id').where('id', '=', soloRemovedWorkspace.id).executeTakeFirst(),
        '没有其他活动账号时删除退出记录仍保留 Workspace 本体');
      assert.equal(await db.selectFrom('workspace_memberships').select('id')
        .where('workspace_id', '=', soloRemovedWorkspace.id).executeTakeFirst(), undefined,
        '没有其他活动账号时也只删除当前账号的 removed Membership');

      const workspaceSyncAddAccount = await accounts.create({ email: 'workspace-sync-add@example.com', groupId: group.id });
      const workspaceSyncAddedWorkspace = await workspaces.upsert({
        externalId: 'workspace-sync-added-workspace',
        name: '同步时保留的名称',
        normalizedPlan: 'business',
        rawPlanCode: 'chatgptteamplan',
        nextRenewalAt: new Date('2033-09-10T00:00:00Z'),
        status: 'inactive'
      });
      await sessions.saveRevision({
        accountId: workspaceSyncAddAccount.account.id,
        session: {
          user: { email: workspaceSyncAddAccount.account.email },
          account: { id: 'workspace-sync-add-personal-account' },
          accessToken: 'workspace-sync-add-access-token'
        },
        source: 'workspace-sync-add-test'
      });
      await sessions.saveAccessToken(
        workspaceSyncAddAccount.account.id,
        { kind: 'personal', personalSpaceId: workspaceSyncAddAccount.personalSpace.id },
        'workspace-sync-add-personal-token',
        { status: 'valid' }
      );
      const accountWorkspaceAddSync = await app.request(`/api/accounts/${workspaceSyncAddAccount.account.id}/workspaces/sync`, { method: 'POST', headers });
      assert.equal(accountWorkspaceAddSync.status, 200, await accountWorkspaceAddSync.clone().text());
      const addedMembership = await db.selectFrom('workspace_memberships').select(['normalized_role', 'remote_user_id', 'status'])
        .where('workspace_id', '=', workspaceSyncAddedWorkspace.id).where('account_id', '=', workspaceSyncAddAccount.account.id)
        .executeTakeFirstOrThrow();
      assert.deepEqual(addedMembership, {
        normalized_role: 'owner',
        remote_user_id: 'workspace-sync-added-user',
        status: 'active'
      }, '关系同步直接从 ChatGPT 新增可见 Workspace 关系');
      const preservedWorkspace = await workspaces.findById(workspaceSyncAddedWorkspace.id);
      assert.equal(preservedWorkspace?.name, '同步时保留的名称');
      assert.equal(preservedWorkspace?.normalized_plan, 'business');
      assert.equal(preservedWorkspace?.raw_plan_code, 'chatgptteamplan');
      assert.equal(preservedWorkspace?.next_renewal_at?.toISOString(), '2033-09-10T00:00:00.000Z',
        'accounts/check 省略 Workspace 资料时不清空已有业务事实');
      missingPersonalSubscriptionAccounts.add('workspace-sync-add-personal-account');
      const personalRefresh = await app.request(`/api/accounts/${workspaceSyncAddAccount.account.id}/personal-space/refresh`, {
        method: 'POST', headers, body: JSON.stringify({ resources: ['subscription'] })
      });
      assert.equal(personalRefresh.status, 200, await personalRefresh.clone().text());
      const personalRefreshData = (await personalRefresh.json() as any).data;
      assert.equal(personalRefreshData.subscription.plan, 'free',
        '个人订阅不存在 404 应按 Free 快照处理');
      assert.equal(personalRefreshData.subscription.rawPlanCode, 'free');
      assert.equal((await db.selectFrom('personal_spaces').select('remote_account_id')
        .where('id', '=', workspaceSyncAddAccount.personalSpace.id).executeTakeFirstOrThrow()).remote_account_id,
        'workspace-sync-add-personal-account', '个人刷新保存 accounts/check 确认的个人账号 ID');

      const legacyPersonalCollisionAccount = await accounts.create({ email: 'legacy-personal-collision@example.com', groupId: group.id });
      await workspaces.upsert({ externalId: 'legacy-personal-account', normalizedPlan: 'free' });
      await sessions.saveRevision({
        accountId: legacyPersonalCollisionAccount.account.id,
        session: {
          user: { email: legacyPersonalCollisionAccount.account.email },
          account: { id: 'legacy-personal-account' },
          accessToken: 'legacy-personal-access-token',
          sessionToken: 'legacy-personal-session-token'
        },
        source: 'legacy-personal-collision-test'
      });
      missingPersonalSubscriptionAccounts.add('legacy-personal-account');
      const legacyPersonalRefresh = await app.request(`/api/accounts/${legacyPersonalCollisionAccount.account.id}/personal-space/refresh`, {
        method: 'POST', headers, body: JSON.stringify({ resources: ['subscription'] })
      });
      assert.equal(legacyPersonalRefresh.status, 200, await legacyPersonalRefresh.clone().text());
      assert.equal((await legacyPersonalRefresh.json() as any).data.subscription.plan, 'free',
        '已存在同名 Workspace 记录时仍应以 accounts/check 的 personal 结构识别个人账号');
      assert.equal((await db.selectFrom('personal_spaces').select('remote_account_id')
        .where('id', '=', legacyPersonalCollisionAccount.personalSpace.id).executeTakeFirstOrThrow()).remote_account_id,
        'legacy-personal-account');

      const deletableAccount = await accounts.create({ email: 'delete-with-history@example.com', groupId: group.id });
      const deletableWorkspace = await workspaces.upsert({ externalId: 'delete-history-workspace', name: 'Retained Workspace', normalizedPlan: 'business' });
      await workspaces.upsertMembership({
        workspaceId: deletableWorkspace.id,
        accountId: deletableAccount.account.id,
        remoteUserId: 'deleted-account-remote-user',
        email: deletableAccount.account.email,
        normalizedRole: 'member',
        status: 'removed',
        observedAt: new Date(),
        source: 'delete-test'
      });
      const completedDeleteOperation = await db.insertInto('automation_operations').values({
        account_id: deletableAccount.account.id,
        workspace_id: null,
        target_group_id: null,
        kind: 'import_account',
        idempotency_key: 'delete-completed-operation',
        external_operation_id: 'delete-completed-operation-remote',
        status: 'succeeded',
        phase: 'completed',
        progress: 100,
        safe_request_summary: {},
        result_summary: {},
        error_code: null,
        error_message: null,
        completed_at: new Date()
      }).returning('id').executeTakeFirstOrThrow();
      await db.insertInto('automation_operation_events').values({
        operation_id: completedDeleteOperation.id,
        phase: 'completed',
        status: 'succeeded',
        safe_payload: {},
        occurred_at: new Date()
      }).execute();
      const deleteWithoutConfirmation = await app.request(`/api/accounts/${deletableAccount.account.id}`, { method: 'DELETE', headers });
      assert.equal(deleteWithoutConfirmation.status, 400);
      assert.match(await deleteWithoutConfirmation.text(), /预览并确认/);
      const deletePreview = await app.request(`/api/accounts/${deletableAccount.account.id}/deletion-preview`, { headers });
      assert.equal(deletePreview.status, 200, await deletePreview.clone().text());
      assert.equal((await deletePreview.json() as any).data.resources.operations, 1);
      const deleteWithHistory = await app.request(`/api/accounts/${deletableAccount.account.id}`, {
        method: 'DELETE', headers, body: JSON.stringify({ confirmLocalCascade: true })
      });
      assert.equal(deleteWithHistory.status, 200, await deleteWithHistory.clone().text());
      assert.equal(await accounts.findById(deletableAccount.account.id), undefined, '彻底删除移除账号本体');
      assert.equal(await db.selectFrom('automation_operations').select('id').where('id', '=', completedDeleteOperation.id).executeTakeFirst(), undefined,
        '彻底删除一并移除账号的已结束操作历史');
      assert.ok(await db.selectFrom('workspaces').select('id').where('id', '=', deletableWorkspace.id).executeTakeFirst(),
        '彻底删除账号不删除独立 Workspace');
      assert.equal(await db.selectFrom('workspace_memberships').select('id')
        .where('workspace_id', '=', deletableWorkspace.id).executeTakeFirst(), undefined,
        '彻底删除账号同时清除该账号在保留 Workspace 中的本地成员关系');

      const activeRelationshipAccount = await accounts.create({ email: 'delete-active-workspace@example.com', groupId: group.id });
      await workspaces.upsertMembership({
        workspaceId: deletableWorkspace.id,
        accountId: activeRelationshipAccount.account.id,
        remoteUserId: 'active-delete-remote-user',
        email: activeRelationshipAccount.account.email,
        normalizedRole: 'member',
        observedAt: new Date(),
        source: 'delete-test'
      });
      const activeRelationshipDelete = await app.request(`/api/accounts/${activeRelationshipAccount.account.id}`, {
        method: 'DELETE', headers, body: JSON.stringify({ confirmLocalCascade: true })
      });
      assert.equal(activeRelationshipDelete.status, 200, await activeRelationshipDelete.clone().text());
      assert.equal(await accounts.findById(activeRelationshipAccount.account.id), undefined,
        '普通成员存在活动 Workspace 关系时仍允许删除账号');
      assert.ok(await db.selectFrom('workspaces').select('id').where('id', '=', deletableWorkspace.id).executeTakeFirst(),
        '普通成员删除账号时保留 Workspace');

      const ownerDeleteAccount = await accounts.create({ email: 'delete-owner-workspace@example.com', groupId: group.id });
      const ownerDeleteWorkspace = await workspaces.upsert({ externalId: 'delete-owner-workspace', name: 'Owned deletion Workspace', normalizedPlan: 'business' });
      await workspaces.upsertMembership({
        workspaceId: ownerDeleteWorkspace.id,
        accountId: ownerDeleteAccount.account.id,
        remoteUserId: 'owner-delete-user',
        email: ownerDeleteAccount.account.email,
        normalizedRole: 'owner',
        observedAt: new Date(),
        source: 'delete-test'
      });
      await workspaces.upsertMembership({
        workspaceId: ownerDeleteWorkspace.id,
        accountId: second.account.id,
        remoteUserId: 'owner-delete-shared-user',
        email: second.account.email,
        normalizedRole: 'member',
        observedAt: new Date(),
        source: 'delete-test'
      });
      await db.insertInto('seat_slots').values({
        workspace_id: ownerDeleteWorkspace.id,
        seat_key: 'delete-owner-workspace-seat',
        current_email: null,
        normalized_current_email: null,
        contact: null,
        remark: null,
        price: null,
        expires_on: null,
        expire_remove: false,
        seat_type: 'default'
      }).execute();
      const ownerOperation = await db.insertInto('automation_operations').values({
        account_id: ownerDeleteAccount.account.id,
        workspace_id: ownerDeleteWorkspace.id,
        target_group_id: null,
        kind: 'workspace_cleanup_history',
        idempotency_key: 'delete-owner-workspace-operation',
        external_operation_id: null,
        status: 'running',
        phase: 'running',
        progress: 50,
        safe_request_summary: {},
        result_summary: {},
        error_code: null,
        error_message: null,
        completed_at: null
      }).returning('id').executeTakeFirstOrThrow();
      const ownerPreview = await app.request(`/api/accounts/${ownerDeleteAccount.account.id}/deletion-preview`, { headers });
      assert.equal(ownerPreview.status, 200, await ownerPreview.clone().text());
      const ownerPreviewData = (await ownerPreview.json() as any).data;
      assert.equal(ownerPreviewData.ownedWorkspaces.length, 1);
      assert.equal(ownerPreviewData.ownedWorkspaces[0].activeMembershipCount, 2);
      assert.equal(ownerPreviewData.resources.seatSlots, 1);
      assert.equal(ownerPreviewData.resources.operations, 1);
      const ownerDelete = await app.request(`/api/accounts/${ownerDeleteAccount.account.id}`, {
        method: 'DELETE', headers, body: JSON.stringify({ confirmLocalCascade: true })
      });
      assert.equal(ownerDelete.status, 200, await ownerDelete.clone().text());
      assert.equal((await ownerDelete.json() as any).data.deletedWorkspaceCount, 1);
      assert.equal(await accounts.findById(ownerDeleteAccount.account.id), undefined);
      assert.equal(await db.selectFrom('workspaces').select('id').where('id', '=', ownerDeleteWorkspace.id).executeTakeFirst(), undefined,
        '活动 owner 删除账号时级联删除其本地 Workspace 及共享成员关系');
      assert.equal(await db.selectFrom('automation_operations').select('id').where('id', '=', ownerOperation.id).executeTakeFirst(), undefined,
        '级联删除不因未结束操作而阻止用户确认的删除');

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
      assert.equal(Object.hasOwn(primaryPlanAccounts[0], 'accessContextHealth'), false,
        '账号摘要不把 Access Token 健康作为账号状态');
      const fixedSeatResponse = await app.request('/api/accounts?primaryPlan=business_fixed_seat', { headers });
      const fixedSeatAccounts = (await fixedSeatResponse.json() as any).data;
      assert.deepEqual(fixedSeatAccounts.find((item: any) => item.id === fixedSeatOwner.account.id)?.primaryPlanSeatUsage, { occupied: 3, capacity: 4 });
      const legacyFixedSeatResponse = await app.request('/api/accounts?primaryPlan=business_two_seat', { headers });
      assert.equal((await legacyFixedSeatResponse.json() as any).data.some((item: any) => item.id === fixedSeatOwner.account.id), true, '旧双席位筛选值兼容到固定席位 Business');
      assert.equal((await app.request('/api/accounts?personalPlan=pro_5x', { headers })).status, 400,
        '旧列表筛选不做静默兼容');
      assert.equal((await app.request('/api/parents', { headers })).status, 404);
      assert.equal((await app.request('/api/subaccounts', { headers })).status, 404);
      assert.equal((await app.request('/api/not-a-real-endpoint', { headers })).status, 404);

      await sessions.saveAccessToken(first.account.id, { kind: 'workspace', workspaceId: workspace.id }, 'stale-workspace-token', { status: 'valid' });
      const sessionResponse = await app.request(`/api/accounts/${first.account.id}/session`, { headers });
      assert.equal(sessionResponse.status, 200);
      assert.equal((await sessionResponse.json() as any).data.accessToken, 'workspace-session-token');
      const workspaceSessionOrderLink = await app.request(`/api/accounts/${first.account.id}/workspace-order-link`, {
        method: 'POST', headers,
        body: JSON.stringify({ mode: 'create_workspace', workspaceName: 'Must Use Personal Session', country: 'US', currency: 'USD', seatQuantity: 2 })
      });
      assert.equal(workspaceSessionOrderLink.status, 409, '只有 Workspace Session 且未知个人账号 ID 时不能生成订单链接');
      const editAccount = await app.request(`/api/accounts/${first.account.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ remark: 'Edited with session', session: { user: { email: first.account.email }, account: { id: 'personal-remote' }, accessToken: 'replacement-secret', sessionToken: 'replacement-session-token' } })
      });
      assert.equal(editAccount.status, 200, await editAccount.clone().text());
      const replacedSession = await app.request(`/api/accounts/${first.account.id}/session`, { headers });
      assert.equal((await replacedSession.json() as any).data.accessToken, 'replacement-secret');
      assert.equal(await sessions.accessToken(first.account.id, { kind: 'workspace', workspaceId: workspace.id }), undefined,
        '替换 Session 后不能继续使用旧 Workspace Token');
      assert.equal(await sessions.accessToken(first.account.id, { kind: 'personal', personalSpaceId: first.personalSpace.id }), 'replacement-secret',
        '替换 Session 后个人 Access Token 必须更新');
      assert.equal((await db.selectFrom('personal_spaces').select('remote_account_id').where('id', '=', first.personalSpace.id).executeTakeFirstOrThrow()).remote_account_id,
        'personal-remote', '替换 Session 后个人远端 account id 必须更新');
      const createWorkspaceOrderLink = await app.request(`/api/accounts/${first.account.id}/workspace-order-link`, {
        method: 'POST', headers,
        body: JSON.stringify({ mode: 'create_workspace', workspaceName: 'New Workspace', country: 'US', currency: 'USD', seatQuantity: 2, promoCode: 'HALF' })
      });
      assert.equal(createWorkspaceOrderLink.status, 200, await createWorkspaceOrderLink.clone().text());
      const createWorkspaceOrderLinkData = (await createWorkspaceOrderLink.json() as any).data;
      assert.equal(createWorkspaceOrderLinkData.workspaceBindingStatus, 'new_workspace');
      assert.equal(createWorkspaceOrderLinkData.totalMinor, 3000);
      assert.equal(workspaceOrderLinkInputs[0].account.accountId, 'personal-remote');
      assert.equal(workspaceOrderLinkInputs[0].account.accessToken, 'replacement-secret');
      assert.equal(workspaceOrderLinkInputs[0].account.sessionToken, 'replacement-session-token');
      assert.equal(workspaceOrderLinkInputs[0].targetWorkspaceId, undefined);
      const upgradeWorkspaceOrderLink = await app.request(`/api/accounts/${first.account.id}/workspace-order-link`, {
        method: 'POST', headers,
        body: JSON.stringify({ mode: 'upgrade_existing_workspace', workspaceId: workspace.id, workspaceName: 'Ignored client value', country: 'SG', currency: 'SGD', seatQuantity: 4 })
      });
      assert.equal(upgradeWorkspaceOrderLink.status, 200, await upgradeWorkspaceOrderLink.clone().text());
      const upgradeWorkspaceOrderLinkData = (await upgradeWorkspaceOrderLink.json() as any).data;
      assert.equal(upgradeWorkspaceOrderLinkData.workspaceBindingStatus, 'matched');
      assert.equal(upgradeWorkspaceOrderLinkData.workspaceName, 'Business');
      assert.equal(upgradeWorkspaceOrderLinkData.actualWorkspaceId, workspace.external_id);
      assert.equal(workspaceOrderLinkInputs[1].targetWorkspaceId, workspace.external_id);
      assert.equal(workspaceOrderLinkInputs[1].workspaceName, 'Business');
      const unauthorizedWorkspaceOrderLink = await app.request(`/api/accounts/${second.account.id}/workspace-order-link`, {
        method: 'POST', headers,
        body: JSON.stringify({ mode: 'upgrade_existing_workspace', workspaceId: workspace.id, country: 'US', currency: 'USD', seatQuantity: 2 })
      });
      assert.equal(unauthorizedWorkspaceOrderLink.status, 409, '普通成员不能生成已有 Workspace 的升级链接');
      assert.equal(Number((await db.selectFrom('team_upgrade_orders').select(({fn}) => fn.countAll().as('count')).executeTakeFirstOrThrow()).count), 0,
        '一次性 Workspace 订单链接不能写入现有订单历史');
      const workspaceOrderActivities = await db.selectFrom('account_activity_logs').select(['kind', 'payload'])
        .where('account_id', '=', first.account.id).where('kind', '=', 'workspace_order_link_generated').execute();
      assert.equal(workspaceOrderActivities.length, 2);
      assert.equal(JSON.stringify(workspaceOrderActivities).includes('checkout.stripe.com'), false, '活动日志不能记录完整付款链接');
      assert.equal(JSON.stringify(workspaceOrderActivities).includes('HALF'), false, '活动日志只记录是否填写优惠码');
      assert.equal((await app.request(`/api/accounts/${first.account.id}/session`, { method: 'PUT', headers, body: '{}' })).status, 404,
        'Session 更新只保留账号 PATCH 入口');
      const mismatchedEdit = await app.request(`/api/accounts/${first.account.id}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ remark: 'must-not-apply', session: { user: { email: 'mismatch@example.com' }, account: { id: 'personal-remote' }, accessToken: 'invalid' } })
      });
      assert.equal(mismatchedEdit.status, 409);
      assert.equal((await accounts.findById(first.account.id))?.remark, 'Edited with session', 'Session 校验失败时不提前写入账号字段');
      const syncResponse = await app.request(`/api/accounts/${first.account.id}/sync`, { method: 'POST', headers });
      assert.equal(syncResponse.status, 404, '旧 GAM 全量同步入口已移除');
      assert.equal((await db.selectFrom('personal_subscription_snapshots').selectAll().where('personal_space_id', '=', first.personalSpace.id).execute()).length, 0,
        'GAM 同步资料不能写入个人套餐事实');
      await db.updateTable('account_operational_profiles').set({account_manager_plan_code:'plus',account_manager_synced_at:new Date()}).where('account_id','=',first.account.id).execute();
      const detailResponse = await app.request(`/api/accounts/${first.account.id}`, { headers });
      assert.equal(detailResponse.status, 200);
      assert.equal((await detailResponse.json() as any).data.personalPlan, 'unknown', '详情不再读取 GAM 套餐快照');
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
      await sessions.saveAccessToken(first.account.id,{kind:'workspace',workspaceId:workspace.id},'workspace-mutation-token',{status:'valid'});
      await sessions.saveAccessToken(second.account.id,{kind:'workspace',workspaceId:workspace.id},'member-workspace-token',{status:'valid'});
      let requestOffset=workspaceMutationRequests.length;
      const memberPeopleRefresh=await app.request(`/api/workspaces/${workspace.id}/people/refresh`,{method:'POST',headers,body:JSON.stringify({executorAccountId:second.account.id})});
      assert.equal(memberPeopleRefresh.status,200,await memberPeopleRefresh.clone().text());
      const memberInvite=await app.request(`/api/workspaces/${workspace.id}/invitations`,{method:'POST',headers,body:JSON.stringify({executorAccountId:second.account.id,email:'member-requested-invite@example.com',role:'standard-user',contact:'member-created-contact'})});
      assert.equal(memberInvite.status,200,await memberInvite.clone().text());
      assert.deepEqual(workspaceMutationRequests.slice(requestOffset),[{
        method:'POST',path:`/backend-api/accounts/${workspace.external_id}/invites`,body:{email_addresses:['member-requested-invite@example.com'],role:'standard-user',resend_emails:true}
      }],'普通成员的邀请请求直接提交上游，不做本地管理员拦截');
      assert.equal((await db.selectFrom('seat_slots').select('contact').where('workspace_id','=',workspace.id).where('normalized_current_email','=','member-requested-invite@example.com').executeTakeFirstOrThrow()).contact,'member-created-contact','上游接受普通成员邀请后仍保存随邀请填写的租客资料');
      requestOffset=workspaceMutationRequests.length;
      const unspecifiedSeatInvite=await app.request(`/api/workspaces/${workspace.id}/invitations`,{method:'POST',headers,body:JSON.stringify({executorAccountId:first.account.id,email:'upstream-decides-seat@example.com',role:'standard-user',contact:'unknown-seat-contact'})});
      assert.equal(unspecifiedSeatInvite.status,200,await unspecifiedSeatInvite.clone().text());
      assert.deepEqual(workspaceMutationRequests.slice(requestOffset),[{
        method:'POST',path:`/backend-api/accounts/${workspace.external_id}/invites`,body:{email_addresses:['upstream-decides-seat@example.com'],role:'standard-user',resend_emails:true}
      }],'未选择邀请席位时不向上游提交 seat_type');
      assert.equal((await db.selectFrom('workspace_invitations').select('seat_type').where('workspace_id','=',workspace.id).where('normalized_email','=','upstream-decides-seat@example.com').executeTakeFirstOrThrow()).seat_type,null,'上游未返回席位时邀请保持未知');
      assert.equal((await db.selectFrom('seat_slots').select('seat_type').where('workspace_id','=',workspace.id).where('normalized_current_email','=','upstream-decides-seat@example.com').executeTakeFirstOrThrow()).seat_type,null,'带租客资料的未知席位不补本地默认值');
      requestOffset=workspaceMutationRequests.length;
      const settingMutation=await app.request(`/api/workspaces/${workspace.id}/settings`,{method:'PATCH',headers,body:JSON.stringify({executorAccountId:first.account.id,key:'defaultSeat',value:'default'})});
      assert.equal(settingMutation.status,200,await settingMutation.clone().text());
      assert.equal((await settingMutation.json() as any).data.latestSettings.payload.default_seat_type,'default');
      assert.deepEqual(workspaceMutationRequests.slice(requestOffset),[{
        method:'POST',path:`/backend-api/accounts/${workspace.external_id}/settings/default_seat_type`,body:{value:'default'}
      }],'Workspace 单项设置只写对应上游接口，不自动回读设置');
      requestOffset=workspaceMutationRequests.length;
      const roleMutation=await app.request(`/api/workspaces/${workspace.id}/members/member-remote`,{method:'PATCH',headers,body:JSON.stringify({executorAccountId:first.account.id,role:'analytics-viewer'})});
      assert.equal(roleMutation.status,200,await roleMutation.clone().text());
      assert.equal((await roleMutation.json() as any).data.members.find((item:any)=>item.remoteUserId==='member-remote')?.role,'analytics_viewer');
      assert.deepEqual(workspaceMutationRequests.slice(requestOffset),[{
        method:'PATCH',path:`/backend-api/accounts/${workspace.external_id}/users/member-remote`,body:{role:'analytics-viewer'}
      }],'角色修改只写角色，不自动回读成员列表');
      requestOffset=workspaceMutationRequests.length;
      const seatMutation=await app.request(`/api/workspaces/${workspace.id}/members/member-remote`,{method:'PATCH',headers,body:JSON.stringify({executorAccountId:first.account.id,seat:'default'})});
      assert.equal(seatMutation.status,200,await seatMutation.clone().text());
      assert.equal((await seatMutation.json() as any).data.members.find((item:any)=>item.remoteUserId==='member-remote')?.seatType,'default');
      assert.deepEqual(workspaceMutationRequests.slice(requestOffset),[{
        method:'PATCH',path:`/backend-api/accounts/${workspace.external_id}/users/member-remote`,body:{seat_type:'default'}
      }],'席位修改只写席位，不自动回读成员列表');
      const aggregatedMemberMutation=await app.request(`/api/workspaces/${workspace.id}/members/member-remote`,{method:'PATCH',headers,body:JSON.stringify({executorAccountId:first.account.id,role:'standard-user',seat:'usage_based'})});
      assert.equal(aggregatedMemberMutation.status,400,'成员接口拒绝把角色和席位聚合为一次提交');
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
      const serializedStoredOperation = JSON.stringify(stored);
      assert.equal(serializedStoredOperation.includes('4242424242424242'), false);
      assert.equal(serializedStoredOperation.includes('"cvc":"123"'), false);

      const paidPersonalRemoteId = (await db.selectFrom('personal_spaces').select('remote_account_id')
        .where('id', '=', first.personalSpace.id).executeTakeFirstOrThrow()).remote_account_id ?? 'personal-remote';
      personalPlanByAccount.set(paidPersonalRemoteId, 'plus');
      const preview = await app.request(`/api/accounts/${first.account.id}/personal-subscription/preview?targetPlan=pro_20x`, { headers });
      assert.equal(preview.status, 200, await preview.clone().text());
      assert.deepEqual((await preview.json() as any).data, {
        currentPlan: 'plus', targetPlan: 'pro_20x', amountDueMinor: 481902,
        positiveLineItemMinor: 579464, adjustmentMinor: -97562, currency: 'PHP',
        renewalDate: '2026-09-18T09:33:15Z',
        defaultPaymentMethod: { brand: 'mastercard', last4: '1461' }
      });
      const blockedWithoutPaymentConfirmation = await app.request(`/api/accounts/${first.account.id}/personal-subscription`, { method: 'POST', headers, body: JSON.stringify({ targetPlan: 'pro_20x', mode: 'change_existing', country: 'US', currency: 'USD', autoPay: false }) });
      assert.equal(blockedWithoutPaymentConfirmation.status, 400);
      const upgraded = await app.request(`/api/accounts/${first.account.id}/personal-subscription`, { method: 'POST', headers, body: JSON.stringify({ targetPlan: 'pro_20x', mode: 'change_existing', country: 'US', currency: 'USD', autoPay: true }) });
      assert.equal(upgraded.status, 200, await upgraded.clone().text());
      const upgradedOperation = (await upgraded.json() as any).data;
      assert.equal(upgradedOperation.status, 'succeeded');
      const upgradedDetailResponse = await app.request(`/api/operations/${upgradedOperation.id}`, { headers });
      assert.equal(upgradedDetailResponse.status, 200, await upgradedDetailResponse.clone().text());
      const upgradedPayment = (await upgradedDetailResponse.json() as any).data.payment;
      assert.equal(upgradedPayment.resultCode, 'succeeded');assert.equal(upgradedPayment.cardBrand, 'mastercard');assert.equal(upgradedPayment.cardLast4, '1461');assert.equal(upgradedPayment.amount, '4819.02');assert.equal(upgradedPayment.currency, 'PHP');
      assert.equal(personalPlanByAccount.get(paidPersonalRemoteId), 'pro');
      const business = await app.request(`/api/accounts/${first.account.id}/business-subscription`, { method: 'POST', headers, body: JSON.stringify({ mode: 'upgrade_existing_workspace', workspaceId: workspace.id, country: 'US', currency: 'USD', autoPay: false }) });
      assert.equal(business.status, 200);
      const businessOperationId=(await business.clone().json() as any).data.id;assert.match(businessOperationId,/^[0-9a-f-]{36}$/);assert.equal((await app.request(`/api/operations/${businessOperationId}`,{headers})).status,200);

      const personalCancel=await app.request(`/api/accounts/${first.account.id}/personal-subscription/cancel-renewal`,{method:'POST',headers});assert.equal(personalCancel.status,200,await personalCancel.clone().text());assert.equal((await personalCancel.json() as any).data.subscription.willRenew,false);
      await sessions.saveAccessToken(first.account.id,{kind:'workspace',workspaceId:workspace.id},'workspace-cancel-token',{status:'valid'});
      const workspaceCancel=await app.request(`/api/workspaces/${workspace.id}/subscription/cancel-renewal`,{method:'POST',headers,body:JSON.stringify({executorAccountId:first.account.id})});assert.equal(workspaceCancel.status,200,await workspaceCancel.clone().text());assert.equal((await workspaceCancel.json() as any).data.willRenew,false);
      const paymentRequest={holderName:'Taylor Anderson',postalCode:'97210',card:{number:'4242424242424242',expiryMonth:12,expiryYear:2030,cvc:'123'}};
      const paymentOperationCountBefore=Number((await db.selectFrom('automation_operations').select(({fn})=>fn.countAll().as('count')).executeTakeFirstOrThrow()).count);
      const paymentDefaults=await app.request(`/api/accounts/${first.account.id}/payment-method-defaults`,{headers});assert.equal(paymentDefaults.status,200);assert.equal((await paymentDefaults.json() as any).data.region,'US-OR');
      const paymentMethod=await app.request(`/api/accounts/${first.account.id}/personal-space/payment-methods`,{method:'POST',headers,body:JSON.stringify(paymentRequest)});assert.equal(paymentMethod.status,200,await paymentMethod.clone().text());assert.equal((await paymentMethod.json() as any).data.targetAccountId,'personal-remote');
      const workspacePayment=await app.request(`/api/workspaces/${workspace.id}/payment-methods`,{method:'POST',headers,body:JSON.stringify({executorAccountId:first.account.id,...paymentRequest})});assert.equal(workspacePayment.status,200,await workspacePayment.clone().text());assert.equal((await workspacePayment.json() as any).data.targetAccountId,workspace.external_id);
      const paymentOperationCountAfter=Number((await db.selectFrom('automation_operations').select(({fn})=>fn.countAll().as('count')).executeTakeFirstOrThrow()).count);assert.equal(paymentOperationCountAfter,paymentOperationCountBefore,'绑卡不创建自动化操作记录');
      assert.equal((paymentInputs[0] as any)?.targetAccountId,'personal-remote','个人绑卡显式使用 Personal Account ID');assert.equal((paymentInputs[1] as any)?.targetAccountId,workspace.external_id,'Workspace 绑卡显式使用远端 Account ID');
      assert.equal((await billing.detail({kind:'personal',personalSpaceId:first.personalSpace.id}))?.paymentMethods[0]?.last4,'4242','个人绑卡返回前刷新账单快照');
      assert.equal((await billing.detail({kind:'workspace',workspaceId:workspace.id}))?.paymentMethods[0]?.last4,'4242','Workspace 绑卡返回前刷新账单快照');
      const paymentActivities=await db.selectFrom('account_activity_logs').select(['kind','payload']).where('account_id','=',first.account.id).where('kind','=','subscription_payment_method_added').execute();assert.equal(paymentActivities.length,2);assert.equal(JSON.stringify(paymentActivities).includes('4242424242424242'),false);assert.equal(JSON.stringify(paymentActivities).includes('"cvc"'),false);
      const personalDefaultId='pm-alt-personal-remote';
      const personalDefault=await app.request(`/api/accounts/${first.account.id}/personal-space/payment-methods/${personalDefaultId}/default`,{method:'POST',headers});assert.equal(personalDefault.status,200,await personalDefault.clone().text());assert.equal((await personalDefault.json() as any).data.paymentMethods.find((item:any)=>item.id===personalDefaultId)?.isDefault,true);
      const upstreamUnauthorized=await app.request(`/api/accounts/${first.account.id}/personal-space/payment-methods/pm-upstream-401/default`,{method:'POST',headers});
      assert.equal(upstreamUnauthorized.status,502);assert.deepEqual(await upstreamUnauthorized.json(),{ok:false,error:'设置默认支付方式失败: HTTP 401',upstreamStatus:401});
      const personalRemove=await app.request(`/api/accounts/${first.account.id}/personal-space/payment-methods/pm-personal-remote`,{method:'DELETE',headers});assert.equal(personalRemove.status,200,await personalRemove.clone().text());assert.equal((await personalRemove.json() as any).data.paymentMethods.some((item:any)=>item.id==='pm-personal-remote'),false);
      const workspaceDefaultId=`pm-alt-${workspace.external_id}`;
      const workspaceDefault=await app.request(`/api/workspaces/${workspace.id}/payment-methods/${workspaceDefaultId}/default`,{method:'POST',headers,body:JSON.stringify({executorAccountId:first.account.id})});assert.equal(workspaceDefault.status,200,await workspaceDefault.clone().text());assert.equal((await workspaceDefault.json() as any).data.paymentMethods.find((item:any)=>item.id===workspaceDefaultId)?.isDefault,true);
      const workspacePrimaryId=`pm-${workspace.external_id}`;
      const workspaceRemove=await app.request(`/api/workspaces/${workspace.id}/payment-methods/${workspacePrimaryId}`,{method:'DELETE',headers,body:JSON.stringify({executorAccountId:first.account.id})});assert.equal(workspaceRemove.status,200,await workspaceRemove.clone().text());assert.equal((await workspaceRemove.json() as any).data.paymentMethods.some((item:any)=>item.id===workspacePrimaryId),false);
      assert.equal((await billing.detail({kind:'personal',personalSpaceId:first.personalSpace.id}))?.paymentMethods[0]?.id,personalDefaultId,'设置个人默认卡后返回前刷新账单快照');
      assert.equal((await billing.detail({kind:'workspace',workspaceId:workspace.id}))?.paymentMethods[0]?.id,workspaceDefaultId,'移除 Workspace 卡片后返回前刷新账单快照');
      const paymentMutationActivities=await db.selectFrom('account_activity_logs').select('kind').where('account_id','=',first.account.id).where('kind','in',['subscription_payment_method_defaulted','subscription_payment_method_removed']).execute();assert.equal(paymentMutationActivities.length,4);
      const paymentOperationCountAfterMutations=Number((await db.selectFrom('automation_operations').select(({fn})=>fn.countAll().as('count')).executeTakeFirstOrThrow()).count);assert.equal(paymentOperationCountAfterMutations,paymentOperationCountBefore,'支付方式写操作不创建自动化操作记录');
      const registration=await app.request('/api/operations/registrations',{method:'POST',headers,body:JSON.stringify({email:'new@example.com',groupId:group.id,country:'US'})});assert.equal(registration.status,200,await registration.clone().text());const registrationOperationId=(await registration.json() as any).data.id;assert.match(registrationOperationId,/^[0-9a-f-]{36}$/);assert.equal((await app.request(`/api/operations/${registrationOperationId}`,{headers})).status,200);
      completedOperations.add('registration-operation');
      const completedRegistration=await app.request(`/api/operations/${registrationOperationId}`,{headers});
      assert.equal(completedRegistration.status,200,await completedRegistration.clone().text());
      const registeredAccount=await accounts.findByEmail('new@example.com');
      assert.ok(registeredAccount);
      assert.equal((await sessions.currentSession(registeredAccount.id) as any).accessToken,'new-registration-access-token');
      assert.deepEqual(acknowledgedRegistrationDeliveries,['registration-operation']);
      const registrationRows=await app.request('/api/account-registrations',{headers});assert.equal(registrationRows.status,200);assert.deepEqual((await registrationRows.json() as any).data,[],'已完成注册收敛为正式账号后不再保留临时行');
      await accounts.update(first.account.id,{remark:'Visible Operator',isBanned:false});const remarkSearch=await app.request('/api/accounts?query=Visible%20Operator',{headers});assert.equal((await remarkSearch.json() as any).data[0].id,first.account.id);

      const operationRow = await db.selectFrom('automation_operations').select('id').where('external_operation_id', '=', 'business-operation').executeTakeFirstOrThrow();
      assert.equal((await app.request(`/api/operations/${operationRow.id}`, { headers })).status, 200);
      assert.ok((await db.selectFrom('automation_operation_events').selectAll().where('operation_id', '=', operationRow.id).execute()).length > 0);

      const unauthorizedSlot = await app.request(`/api/workspaces/${workspace.id}/seat-slots`, { method: 'POST', headers, body: JSON.stringify({ executorAccountId:outsider.account.id,email: 'customer@example.com', seatType: 'usage_based' }) });
      assert.equal(unauthorizedSlot.status,409,'普通成员不能维护客户资料');
      const missingEmailSlot = await app.request(`/api/workspaces/${workspace.id}/seat-slots`, { method: 'POST', headers, body: JSON.stringify({ executorAccountId:first.account.id, seatType: 'usage_based', remark: '不能成为空资料' }) });
      assert.equal(missingEmailSlot.status,400,'不能创建没有关联邮箱的客户资料');
      const releasableSlotResponse = await app.request(`/api/workspaces/${workspace.id}/seat-slots`, { method: 'POST', headers, body: JSON.stringify({ executorAccountId:first.account.id,email: 'release-customer@example.com', seatType: 'usage_based', contact: 'release-contact' }) });
      assert.equal(releasableSlotResponse.status,200);
      const releasableSlotId=(await releasableSlotResponse.json() as any).data.id;
      const releasedSlotResponse=await app.request(`/api/workspaces/${workspace.id}/seat-slots/${releasableSlotId}/release`,{method:'POST',headers,body:JSON.stringify({executorAccountId:first.account.id})});
      assert.equal(releasedSlotResponse.status,200);
      assert.equal((await releasedSlotResponse.json() as any).data,true);
      assert.equal(await db.selectFrom('seat_slots').select('id').where('id','=',releasableSlotId).executeTakeFirst(),undefined,'释放关系后应一并删除客户资料');
      const releaseActivity=await db.selectFrom('account_activity_logs').select(['kind','payload']).where('workspace_id','=',workspace.id).where('kind','=','seat_slot_released').orderBy('occurred_at','desc').executeTakeFirstOrThrow();
      assert.equal(releaseActivity.payload.localProfileDeleted,true);
      const invitedWithTenant=new SeatSlotService(db,{invite:async(_workspaceId:string,_executorId:string,input:any)=>{await db.insertInto('workspace_invitations').values({workspace_id:workspace.id,account_id:null,remote_invitation_id:'tenant-invite',email:input.email,normalized_email:input.email.toLowerCase(),raw_role:input.role??'standard-user',normalized_role:'member',seat_type:input.seat,status:'pending',invited_at:new Date(),observed_at:new Date()}).execute();}} as any);
      await invitedWithTenant.invite(workspace.id,first.account.id,{email:'tenant-invite@example.com',seat:'usage_based',role:'standard-user',contact:'tenant-contact',remark:'tenant-remark',price:'52',expiresOn:'2032-08-14'});
      const invitedTenantSlot=await db.selectFrom('seat_slots').selectAll().where('workspace_id','=',workspace.id).where('normalized_current_email','=','tenant-invite@example.com').executeTakeFirstOrThrow();
      assert.equal(invitedTenantSlot.contact,'tenant-contact');assert.equal(invitedTenantSlot.remark,'tenant-remark');assert.equal(invitedTenantSlot.price,'52');assert.equal(invitedTenantSlot.expires_on,'2032-08-14');
      assert.equal(invitedTenantSlot.expire_reminder,true,'现有和新建席位默认开启到期提醒');
      await db.updateTable('workspace_memberships').set({remote_user_id:'owner-remote',email:first.account.email,normalized_email:first.account.email,seat_type:'default'})
        .where('workspace_id','=',workspace.id).where('account_id','=',first.account.id).where('status','=','active').execute();
      const slot = await app.request(`/api/workspaces/${workspace.id}/seat-slots`, { method: 'POST', headers, body: JSON.stringify({ executorAccountId:first.account.id,email: first.account.email, seatType: 'usage_based', contact: 'contact', expiresOn: '2030-01-01' }) });
      assert.equal(slot.status, 200);
      const slotData=(await slot.json() as any).data;const slotId = slotData.id;
      assert.equal(slotData.seat_type,'default','成员关系中的席位类型优先于资料提交值');
      assert.equal((await app.request(`/api/workspaces/${workspace.id}/seat-slots/${slotId}`, { method: 'PATCH', headers, body: JSON.stringify({ executorAccountId:first.account.id,remark: 'paid',expiresOn:'2030-02-01',expireReminder:false,expireRemove:true }) })).status, 200);
      const seatUpdateActivity=await db.selectFrom('account_activity_logs').select('payload').where('workspace_id','=',workspace.id).where('kind','=','seat_slot_updated').orderBy('occurred_at','desc').executeTakeFirstOrThrow();
      assert.deepEqual(seatUpdateActivity.payload.changedFields,['remark','expiresOn','expireReminder','expireRemove']);assert.equal((seatUpdateActivity.payload.before as any).expiresOn,'2030-01-01');assert.equal((seatUpdateActivity.payload.after as any).expiresOn,'2030-02-01');
      await db.updateTable('seat_slots').set({ expires_on: '2026-01-01', expire_remove: false }).where('id', '=', slotId).execute();
      const expirationService = new SeatSlotService(db, {} as any);
      assert.equal((await expirationService.runExpirations(new Date('2026-01-01T15:59:59.999Z'))).expiredWithoutRemoval, 0,'到期日北京时间全天仍然有效');
      assert.equal((await expirationService.runExpirations(new Date('2026-01-01T16:00:00.000Z'))).expiredWithoutRemoval, 1,'北京时间次日零点后派生为已到期');
      assert.equal((await expirationService.runExpirations(new Date('2026-01-01T16:01:00.000Z'))).expiredWithoutRemoval,1,'未开启自动移除时后续扫描也不修改资料');
      assert.ok(await db.selectFrom('seat_slots').select('id').where('id','=',slotId).executeTakeFirst(),'未开启自动移除时客户资料必须保留');

      await db.insertInto('workspace_invitations').values({workspace_id:workspace.id,account_id:null,remote_invitation_id:'expiration-removal-invite',email:'expiration-removal@example.com',normalized_email:'expiration-removal@example.com',raw_role:'standard-user',normalized_role:'member',seat_type:'usage_based',status:'pending',invited_at:new Date(),observed_at:new Date()}).execute();
      let removalAttempts=0;const removalAlerts:Record<string,unknown>[]=[];
      const failedRemovalService=new SeatSlotService(db,{refreshPeople:async()=>undefined,revokeInvitation:async()=>{removalAttempts+=1;throw new Error('上游拒绝撤销邀请');}} as any,{notifySeatRemovalFailure:async(item:Record<string,unknown>)=>{removalAlerts.push(item);}} as any);
      const failedRemovalSlot=await failedRemovalService.create(workspace.id,first.account.id,{email:'expiration-removal@example.com',seatType:'usage_based',expiresOn:'2020-01-01',expireRemove:true});
      assert.equal((await failedRemovalService.runExpirations(new Date('2026-01-01T00:00:00Z'))).removalRetrying,1);
      await failedRemovalService.runExpirations(new Date('2026-01-01T00:00:30Z'));assert.equal(removalAttempts,1,'退避期内不能重复调用上游');
      assert.equal((await failedRemovalService.runExpirations(new Date('2026-01-01T00:01:00Z'))).removalRetrying,1);
      assert.equal((await failedRemovalService.runExpirations(new Date('2026-01-01T00:06:00Z'))).removalFailed,1);
      assert.equal(removalAttempts,3);assert.equal(removalAlerts.length,1);
      await failedRemovalService.runExpirations(new Date('2026-01-02T00:00:00Z'));assert.equal(removalAttempts,3,'最终失败后普通调度不能重新尝试');
      const preservedRemovalSlot=await db.selectFrom('seat_slots').selectAll().where('id','=',failedRemovalSlot.id).executeTakeFirstOrThrow();
      assert.equal(preservedRemovalSlot.expire_remove,true);
      const failedRemovalAttempt=await db.selectFrom('seat_expiration_removal_attempts').selectAll().where('seat_slot_id','=',failedRemovalSlot.id).executeTakeFirstOrThrow();
      assert.equal(failedRemovalAttempt.status,'failed');assert.equal(failedRemovalAttempt.attempt_count,3);assert.match(failedRemovalAttempt.last_error??'',/上游拒绝撤销邀请/);
      const failedRemovalActivity=await db.selectFrom('account_activity_logs').select(['kind','payload']).where('workspace_id','=',workspace.id).where('kind','=','seat_slot_expiration_removal_failed').executeTakeFirstOrThrow();
      assert.equal(failedRemovalActivity.payload.attemptCount,3);
      await failedRemovalService.update(workspace.id,failedRemovalSlot.id,first.account.id,{remark:'保留失败状态'});
      assert.ok(await db.selectFrom('seat_expiration_removal_attempts').select('seat_slot_id').where('seat_slot_id','=',failedRemovalSlot.id).executeTakeFirst(),'普通资料编辑不能重新启动失败任务');
      await failedRemovalService.update(workspace.id,failedRemovalSlot.id,first.account.id,{expiresOn:'2030-01-01'});
      assert.equal(await db.selectFrom('seat_expiration_removal_attempts').select('seat_slot_id').where('seat_slot_id','=',failedRemovalSlot.id).executeTakeFirst(),undefined,'管理员修改到期策略后才允许清除失败终态');

      await db.insertInto('workspace_invitations').values({workspace_id:workspace.id,account_id:null,remote_invitation_id:'expiration-removal-success',email:'expiration-removal-success@example.com',normalized_email:'expiration-removal-success@example.com',raw_role:'standard-user',normalized_role:'member',seat_type:'usage_based',status:'pending',invited_at:new Date(),observed_at:new Date()}).execute();
      const successfulRemovalService=new SeatSlotService(db,{refreshPeople:async()=>undefined,revokeInvitation:async(_workspaceId:string,_executor:string,email:string)=>{await db.updateTable('workspace_invitations').set({status:'revoked'}).where('workspace_id','=',workspace.id).where('normalized_email','=',email).execute();}} as any);
      const successfulRemovalSlot=await successfulRemovalService.create(workspace.id,first.account.id,{email:'expiration-removal-success@example.com',seatType:'usage_based',expiresOn:'2020-01-01',expireRemove:true});
      assert.equal((await successfulRemovalService.runExpirations(new Date('2026-01-01T00:00:00Z'))).removed,1);
      assert.ok(await db.selectFrom('seat_slots').select('id').where('id','=',successfulRemovalSlot.id).executeTakeFirst(),'自动移除成功后仍保留到期客户资料');
      const successfulRemovalAttempt=await db.selectFrom('seat_expiration_removal_attempts').selectAll().where('seat_slot_id','=',successfulRemovalSlot.id).executeTakeFirstOrThrow();
      assert.equal(successfulRemovalAttempt.status,'succeeded');assert.ok(successfulRemovalAttempt.succeeded_at);
      assert.equal((await successfulRemovalService.runExpirations(new Date('2026-01-02T00:00:00Z'))).removed,0,'自动移除成功后不得再次调度');

      assert.equal((await app.request('/api/credential-pool-groups', { method: 'POST', headers, body: JSON.stringify({ name: 'pool-a' }) })).status, 200);
      const overviewRenewalAt = new Date('2032-08-14T09:10:11Z');
      await db.updateTable('workspaces').set({ next_renewal_at: overviewRenewalAt }).where('id', '=', workspace.id).execute();
      await db.insertInto('workspace_subscription_snapshots').values({workspace_id:workspace.id,normalized_plan:'business',raw_plan_code:'team',status:'active',will_renew:true,effective_at:null,ends_at:overviewRenewalAt,fixed_seat_capacity:2,subscription_seats_in_use:1,payload:{subscription:{seats_entitled:2,seats_in_use:1}},observed_at:new Date('2032-08-13T09:10:11Z')}).execute();
      await primaryBilling.saveSnapshot({ kind: 'workspace', workspaceId: workspace.id }, {
        invoices: { data: [{ id: 'overview-open-invoice', status: 'open', amount_due: 1100, amount_remaining: 1100, currency: 'usd' }] },
        upcomingInvoice: { lines: { data: [{ type: 'subscription', quantity: 2 }] }, amount_due: 2200, currency: 'usd' },
        payment_methods: {
          default_payment_method_id: 'overview-default-card',
          payment_methods: [{ id: 'overview-default-card', card: { brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 } }]
        }
      }, new Date('2032-08-13T09:10:11Z'));
      const bannedOverviewManager = await accounts.create({ email: 'banned-overview@example.com', groupId: group.id, isBanned: true });
      const bannedOverviewWorkspace = await workspaces.upsert({ externalId: 'banned-overview-workspace', normalizedPlan: 'business' });
      await workspaces.upsertMembership({ workspaceId: bannedOverviewWorkspace.id, accountId: bannedOverviewManager.account.id, remoteUserId:'banned-overview-owner',email:bannedOverviewManager.account.email,normalizedRole:'owner',seatType:'default',observedAt:new Date(),source:'test' });
      const unknownCapacityManager = await accounts.create({ email: 'unknown-capacity@example.com', groupId: group.id });
      const unknownCapacityWorkspace = await workspaces.upsert({ externalId: 'unknown-capacity-workspace', normalizedPlan: 'business' });
      await workspaces.upsertMembership({ workspaceId: unknownCapacityWorkspace.id, accountId: unknownCapacityManager.account.id, remoteUserId:'unknown-capacity-owner',email:unknownCapacityManager.account.email,normalizedRole:'owner',seatType:'default',observedAt:new Date(),source:'test' });
      const renewalOverviewResponse = await app.request('/api/overview/renewals', { headers });
      assert.equal(renewalOverviewResponse.status, 200);
      const renewalOverview = (await renewalOverviewResponse.json() as any).data;
      const workspaceRenewalCard = renewalOverview.find((item: any) => item.workspaceId === workspace.id);
      assert.equal(workspaceRenewalCard.subject, 'workspace');
      assert.equal(workspaceRenewalCard.renewalAt, overviewRenewalAt.toISOString(), '续费概览保留精确到秒的时间');
      assert.equal(workspaceRenewalCard.defaultPaymentCardLast4, '4242', '母号概览展示 Workspace 默认支付卡尾号');
      assert.equal(workspaceRenewalCard.managingAccounts[0].email, first.account.email);
      assert.equal(workspaceRenewalCard.managingAccounts[0].isBanned, false);
      assert.equal(workspaceRenewalCard.operationalStatus, 'payment_due', '当期待付发票优先于未来续费时间');
      assert.equal(renewalOverview.every((item: any) => item.plan === 'business'), true, '母号概览只展示固定席位 Business Workspace');
      assert.equal(workspaceRenewalCard.fixedSeatCapacity, 2);
      assert.equal(workspaceRenewalCard.subscriptionSeatsInUse, 1, '订阅报告使用数不覆盖关系占用');
      assert.equal(workspaceRenewalCard.billedSeatQuantity, 2, '下期发票行数量独立表达计费席位');
      assert.equal(renewalOverview.some((item: any) => item.workspaceId === usageWorkspace.id), false, '母号概览不展示 Business 0.52');
      assert.equal(renewalOverview.some((item: any) => item.workspaceId === billingWorkspace.id), true, '固定席位账单证据必须覆盖 usage-based Workspace plan');
      assert.equal(renewalOverview.some((item: any) => item.workspaceId === bannedOverviewWorkspace.id), false, '母号概览不展示管理账号已封号的 Workspace');
      const unknownCapacityRenewal = renewalOverview.find((item: any) => item.workspaceId === unknownCapacityWorkspace.id);
      assert.equal(unknownCapacityRenewal.fixedSeatOccupied, 1);
      assert.equal(Object.hasOwn(unknownCapacityRenewal, 'fixedSeatCapacity'), false, '容量未知时不回退到双席位常量');
      const seatOverviewResponse = await app.request('/api/overview/seats', { headers });
      assert.equal(seatOverviewResponse.status, 200);
      const seatOverview = (await seatOverviewResponse.json() as any).data;
      assert.equal(seatOverview.find((item: any) => item.id === invitedTenantSlot.id), undefined, '概览卡片身份不直接等同 SeatSlot ID');
      assert.equal(seatOverview.some((item: any) => item.email === 'tenant-invite@example.com'), false, 'usage-based 邀请及客户资料不进入席位概览');
      assert.equal(seatOverview.every((item: any) => item.seatType === 'default'), true, '席位概览只返回固定 ChatGPT 席位');
      assert.equal(seatOverview.some((item: any) => item.workspaceId === usageWorkspace.id), false, 'Codex Workspace 不进入席位概览');
      assert.equal(seatOverview.some((item: any) => item.workspaceId === billingWorkspace.id), false, '即使旧账单含固定套餐信号，明确的 Codex Workspace 仍不进入席位概览');
      const fixedMemberCard = seatOverview.find((item: any) => item.email === 'fixed-seat-member@example.com');
      assert.equal(fixedMemberCard.subject, 'member', '固定成员进入席位概览');
      assert.equal(fixedMemberCard.seatType, 'default');
      assert.equal(fixedMemberCard.hasCustomerProfile, true);
      assert.equal(fixedMemberCard.seatSlotId, fixedMemberSeatSlot.id);
      assert.equal(fixedMemberCard.remark, 'fixed-member-profile');
      const expiredFixedMember = seatOverview.find((item: any) => item.workspaceId === workspace.id && item.email === first.account.email);
      assert.equal(expiredFixedMember.subject, 'member', '已到期但未开启自动移除的固定成员仍进入席位概览');
      assert.equal(expiredFixedMember.hasCustomerProfile, true, '到期不删除或隐藏客户资料');
      assert.equal(expiredFixedMember.expirationStatus, 'expired');
      const fixedInvitationCard = seatOverview.find((item: any) => item.email === 'fixed-seat-invite@example.com');
      assert.equal(fixedInvitationCard.subject, 'invitation', '待接受固定邀请作为占位展示');
      assert.equal(fixedInvitationCard.hasCustomerProfile, false);
      const vacancyCard = seatOverview.find((item: any) => item.workspaceId === workspace.id && item.subject === 'vacancy');
      assert.equal(vacancyCard.relationStatus, 'unclaimed', '已知权益容量扣除固定占用后补出待认领空位');
      assert.equal(vacancyCard.hasCustomerProfile, false, '空位只是投影，不伪造客户资料');
      assert.equal(seatOverview.filter((item: any) => item.workspaceId === earlierFixedWorkspace.id && item.subject === 'vacancy').length, 1, '4 席位容量减去 3 个关系占用补出一个空位');
      assert.equal(seatOverview.some((item: any) => item.workspaceId === unknownCapacityWorkspace.id && item.subject === 'vacancy'), false, '容量未知时不虚构空位');
      assert.equal(Object.hasOwn(fixedMemberCard, 'source'), false, '席位概览不暴露底层来源字段');
      assert.equal((await app.request('/api/overview/workspaces', { headers })).status, 404, '旧 Workspace 概览 API 不保留兼容入口');
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
      const finalDeliveries=await db.selectFrom('notification_deliveries').selectAll().where('policy_id','=',policy.id).execute();assert.equal(finalDeliveries.length,1);assert.equal(finalDeliveries[0].attempt_count,3);assert.equal(finalDeliveries[0].status,'exhausted');assert.deepEqual(finalDeliveries[0].payload,rawPayload);assert.equal(finalDeliveries[0].configuration_snapshot.webhookUrl,'https://notify.test');assert.deepEqual(finalDeliveries[0].delivered_channels,{});

      for(const [key,email] of [['member','member-expiry@example.com'],['invited','invited-expiry@example.com'],['unclaimed',null],['unlinked','unlinked-expiry@example.com']] as const)await db.insertInto('seat_slots').values({workspace_id:workspace.id,seat_key:`reminder-${key}`,current_email:email,normalized_current_email:email,contact:null,remark:null,price:null,expires_on:'2032-01-05',expire_remove:false,seat_type:'default'}).execute();
      await db.insertInto('seat_slots').values({workspace_id:workspace.id,seat_key:'reminder-disabled-by-policy',current_email:'reminder-off@example.com',normalized_current_email:'reminder-off@example.com',contact:null,remark:null,price:null,expires_on:'2032-01-05',expire_reminder:false,expire_remove:false,seat_type:'default'}).execute();
      await db.insertInto('notification_policies').values({kind:'seat_expiration',enabled:true,configuration:{advanceDays:7,triggerTime:'08:00',timeZone:'Asia/Shanghai',webhookEnabled:true,webhookUrl:'https://notify.test'}}).onConflict(oc=>oc.column('kind').doUpdateSet({enabled:true,configuration:{advanceDays:7,triggerTime:'08:00',timeZone:'Asia/Shanghai',webhookEnabled:true,webhookUrl:'https://notify.test'}})).execute();
      let reminderItems:Record<string,unknown>[]=[];const reminderService=new SeatSlotService(db,{} as any,{notifySeatExpiry:async(items:Record<string,unknown>[])=>(reminderItems=items)} as any);const reminderResult=await reminderService.runExpirations(new Date('2032-01-01T00:00:00Z'));assert.equal(reminderResult.reminders,4);assert.deepEqual(reminderItems.map(item=>item.email??item.relationStatus).sort(),['invited-expiry@example.com','member-expiry@example.com','unclaimed','unlinked-expiry@example.com']);
    } finally { await db.destroy();await new Promise(resolve=>setTimeout(resolve,100)); }
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
