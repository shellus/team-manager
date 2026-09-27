import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import { createDatabase } from './connection.js';
import { migrateToLatest } from './migrator.js';
import { AccountRepository } from '../repositories/accountRepository.js';
import { WorkspaceRepository } from '../repositories/workspaceRepository.js';
import { SeatSlotRelationRepository } from '../repositories/seatSlotRelationRepository.js';
import { SeatSlotService } from '../services/seatSlotService.js';
import type { WorkspaceOperationService } from '../services/workspaceOperationService.js';

const adminUrl = process.env.TEAMMGR_TEST_ADMIN_DATABASE_URL;

test('本地席位资料与上游关系独立，失败可恢复且移除保留资料', { skip: !adminUrl, timeout: 60_000 }, async () => {
  const name = `team_manager_test_${randomUUID().replaceAll('-', '')}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  const url = new URL(adminUrl!); url.pathname = `/${name}`;
  try {
    await admin.query(`create database "${name}"`);
    const db = createDatabase({ connectionString: url.toString() });
    try {
      await migrateToLatest(db);
      const accounts = new AccountRepository(db);
      const workspaces = new WorkspaceRepository(db);
      const owner = (await accounts.create({ email: 'owner@example.com' })).account;
      const workspace = await workspaces.upsert({ externalId: 'seat-lifecycle', normalizedPlan: 'business' });
      await workspaces.upsertMembership({ workspaceId: workspace.id, accountId: owner.id, email: owner.email, normalizedRole: 'owner', observedAt: new Date(), source: 'test' });
      const relations = new SeatSlotRelationRepository(db);
      let calls = 0, invites = 0, fail = false;
      const operations = {
        refreshPeople: async () => { calls++; },
        invite: async (_workspace: string, _executor: string, input: { email: string; seat?: string; role?: string }) => {
          calls++; invites++;
          if (fail) throw new Error('上游邀请失败');
          await db.insertInto('workspace_invitations').values({ workspace_id: workspace.id, account_id: null, remote_invitation_id: randomUUID(), email: input.email,
            normalized_email: input.email.toLowerCase(), raw_role: input.role ?? 'standard-user', normalized_role: 'member', seat_type: input.seat ?? null,
            status: 'pending', invited_at: new Date(), observed_at: new Date() }).execute();
        },
        removeMember: async (_workspace: string, _executor: string, remoteUserId: string) => {
          calls++;
          if (fail) throw new Error('上游移除失败');
          await db.updateTable('workspace_memberships').set({ status: 'removed' }).where('workspace_id', '=', workspace.id).where('remote_user_id', '=', remoteUserId).execute();
        },
        revokeInvitation: async (_workspace: string, _executor: string, email: string) => {
          calls++;
          await db.updateTable('workspace_invitations').set({ status: 'revoked' }).where('workspace_id', '=', workspace.id).where('normalized_email', '=', email.toLowerCase()).execute();
        },
      } as unknown as WorkspaceOperationService;
      const service = new SeatSlotService(db, operations);
      const slot = await service.invite(workspace.id, owner.id, { email: 'local@example.com', applyToUpstream: false, remark: '保留', price: '52' });
      assert.equal(calls, 0);
      assert.equal(slot.seat_type, null, '未选择的席位类型保持未知');
      assert.equal((await relations.resolve(workspace.id, slot.current_email)).status, 'unlinked');
      await service.update(workspace.id, slot.id, owner.id, { email: 'edited@example.com', seatType: 'usage_based' });
      const edited = await db.selectFrom('seat_slots').selectAll().where('id', '=', slot.id).executeTakeFirstOrThrow();
      assert.equal(edited.seat_key, slot.seat_key); assert.equal(edited.price, '52'); assert.equal(calls, 0);
      assert.equal((await db.selectFrom('seat_slot_identity_history').select('id').where('seat_slot_id', '=', slot.id).execute()).length, 2);
      const duplicate = await service.create(workspace.id, owner.id, { email: 'duplicate@example.com' });
      await assert.rejects(service.update(workspace.id, slot.id, owner.id, { email: 'DUPLICATE@example.com' }), /已有本地席位资料/);
      await service.remove(workspace.id, duplicate.id, owner.id);
      fail = true;
      await assert.rejects(service.apply(workspace.id, slot.id, owner.id), /本地席位资料已保存/);
      assert.equal((await relations.resolve(workspace.id, edited.current_email)).status, 'unlinked');
      await assert.rejects(service.invite(workspace.id, owner.id, { email: 'failed-add@example.com' }), /本地席位资料已保存/);
      assert.ok(await db.selectFrom('seat_slots').select('id').where('normalized_current_email', '=', 'failed-add@example.com').executeTakeFirst());
      fail = false;
      await service.apply(workspace.id, slot.id, owner.id);
      assert.equal((await relations.resolve(workspace.id, edited.current_email)).status, 'invited');
      const inviteCount = invites;
      await service.apply(workspace.id, slot.id, owner.id);
      assert.equal(invites, inviteCount, '再次应用已存在的邀请不重复发送');
      await assert.rejects(service.update(workspace.id, slot.id, owner.id, { email: 'other@example.com' }), /先移除上游成员或撤销邀请/);
      await assert.rejects(service.remove(workspace.id, slot.id, owner.id), /先移除上游成员或撤销邀请/);
      await service.revokeInvitation(workspace.id, owner.id, edited.current_email!);
      assert.equal((await relations.resolve(workspace.id, edited.current_email)).status, 'unlinked');
      assert.equal((await db.selectFrom('seat_slots').select('seat_key').where('id', '=', slot.id).executeTakeFirstOrThrow()).seat_key, slot.seat_key);
      await service.apply(workspace.id, slot.id, owner.id);
      assert.equal(invites, inviteCount + 1);
      await operations.revokeInvitation(workspace.id, owner.id, edited.current_email!);
      await workspaces.upsertMembership({ workspaceId: workspace.id, remoteUserId: 'accepted-member', email: edited.current_email, normalizedRole: 'member', seatType: 'default', observedAt: new Date(), source: 'test' });
      await service.removeMember(workspace.id, owner.id, 'accepted-member');
      assert.equal((await relations.resolve(workspace.id, edited.current_email)).status, 'unlinked');
      const retained = await db.selectFrom('seat_slots').selectAll().where('id', '=', slot.id).executeTakeFirstOrThrow();
      assert.equal(retained.seat_type, 'default', '移除后保留上游最新的已知席位类型');
      assert.equal(retained.remark, '保留'); assert.equal(retained.price, '52'); assert.equal(retained.seat_key, slot.seat_key);
      await workspaces.upsertMembership({ workspaceId: workspace.id, remoteUserId: 'remote-only', email: 'remote-only@example.com', normalizedRole: 'member', seatType: 'default', observedAt: new Date(), source: 'test' });
      fail = true;
      await assert.rejects(service.removeMember(workspace.id, owner.id, 'remote-only'), /上游移除失败/);
      assert.equal((await relations.resolve(workspace.id, 'remote-only@example.com')).status, 'member');
      fail = false;
      await service.removeMember(workspace.id, owner.id, 'remote-only');
      const remoteProfile = await db.selectFrom('seat_slots').selectAll().where('normalized_current_email', '=', 'remote-only@example.com').executeTakeFirstOrThrow();
      assert.equal(remoteProfile.seat_type, 'default'); assert.equal((await relations.resolve(workspace.id, remoteProfile.current_email)).status, 'unlinked');
      await operations.invite(workspace.id, owner.id, { email: 'remote-invite@example.com' });
      await service.revokeInvitation(workspace.id, owner.id, 'remote-invite@example.com');
      assert.ok(await db.selectFrom('seat_slots').select('id').where('normalized_current_email', '=', 'remote-invite@example.com').executeTakeFirst());
      const expired = await service.create(workspace.id, owner.id, { email: 'expired@example.com', expiresOn: '2000-01-01', expireRemove: true });
      const beforeExpired = calls;
      await assert.rejects(service.apply(workspace.id, expired.id, owner.id), /已到期/);
      assert.equal(calls, beforeExpired);
      const beforeDelete = calls;
      await service.remove(workspace.id, slot.id, owner.id);
      assert.equal(calls, beforeDelete);
      assert.equal(await db.selectFrom('seat_slots').select('id').where('id', '=', slot.id).executeTakeFirst(), undefined);
    } finally { await db.destroy(); }
  } finally {
    await admin.query(`drop database if exists "${name}" with (force)`);
    await admin.end();
  }
});
