import { randomBytes } from 'node:crypto';
import type { Kysely } from 'kysely';
import type { SeatSlotMutationInput, SeatType } from '@team-manager/shared';
import type { Database } from '../database/schema.js';
import { normalizeEmail } from '../domain/identity.js';
import { SeatSlotRepository } from '../repositories/seatSlotRepository.js';
import { ServiceError } from '../serviceError.js';
import { PublicSeatService } from './publicSeatService.js';
import { WorkspaceOperationService } from './workspaceOperationService.js';
import type { NotificationService } from './notificationService.js';

export class SeatSlotService {
  readonly #repository: SeatSlotRepository;
  constructor(
    private readonly db: Kysely<Database>, private readonly workspaceOperations: WorkspaceOperationService,
    private readonly publicSeats: PublicSeatService, private readonly notifications?: NotificationService
  ) { this.#repository = new SeatSlotRepository(db); }

  list(workspaceId: string) { return this.db.selectFrom('seat_slots').selectAll().where('workspace_id', '=', workspaceId).orderBy('created_at').execute(); }

  async create(workspaceId: string, input: SeatSlotMutationInput) {
    const seatKey = input.seatKey?.trim() || randomBytes(24).toString('base64url');
    if (!['default', 'usage_based'].includes(input.seatType ?? '')) throw new ServiceError(400, '缺少有效席位类型');
    await this.assertWorkspace(workspaceId);
    const row = await this.#repository.save({ workspaceId, seatKey, email: input.email, remoteUserId: input.remoteUserId,
      contact: input.contact, remark: input.remark, price: input.price, expiresOn: input.expiresOn,
      expireReminder: input.expireReminder, expireRemove: input.expireRemove,
      seatType: input.seatType!, status: input.status ?? (input.email ? 'unknown' : 'empty') });
    await this.log(row.id, null, row.current_email, 'created'); return row;
  }

  async update(workspaceId: string, id: string, input: SeatSlotMutationInput) {
    const row = await this.require(workspaceId, id); const email = input.email === undefined ? row.current_email : input.email;
    const updated = await this.#repository.save({ workspaceId, seatKey: row.seat_key, email,
      remoteUserId: input.remoteUserId === undefined ? row.remote_user_id : input.remoteUserId,
      contact: input.contact === undefined ? row.contact : input.contact, remark: input.remark === undefined ? row.remark : input.remark,
      price: input.price === undefined ? row.price : input.price, expiresOn: input.expiresOn === undefined ? row.expires_on : input.expiresOn,
      expireReminder: input.expireReminder ?? row.expire_reminder, expireRemove: input.expireRemove ?? row.expire_remove,
      seatType: input.seatType ?? row.seat_type as SeatType,
      status: input.status ?? row.status as any });
    if (row.normalized_current_email !== updated.normalized_current_email) await this.log(id, row.current_email, updated.current_email, 'admin_edit');
    return updated;
  }

  async disable(workspaceId: string, id: string) { await this.require(workspaceId, id); return this.db.updateTable('seat_slots').set({ status: 'disabled' }).where('id', '=', id).returningAll().executeTakeFirstOrThrow(); }
  async remove(workspaceId: string, id: string) { const row = await this.require(workspaceId, id); if (['member', 'invited'].includes(row.status)) throw new ServiceError(409, '占用中的席位不能删除，请先释放'); await this.db.deleteFrom('seat_slots').where('id', '=', id).execute(); return true; }
  async release(workspaceId: string, id: string, executorAccountId: string, force = false) {
    const row = await this.require(workspaceId, id);
    if (row.status === 'member' && row.remote_user_id && !force) await this.workspaceOperations.removeMember(workspaceId, executorAccountId, row.remote_user_id);
    else if (row.status === 'invited' && row.current_email && !force) await this.workspaceOperations.revokeInvitation(workspaceId, executorAccountId, row.current_email);
    await this.log(id, row.current_email, null, force ? 'force_release' : 'release');
    return this.db.updateTable('seat_slots').set({ current_email: null, normalized_current_email: null, remote_user_id: null, status: 'empty' }).where('id', '=', id).returningAll().executeTakeFirstOrThrow();
  }
  async swap(workspaceId: string, id: string, email: string) { const row = await this.require(workspaceId, id); return this.publicSeats.swap(row.seat_key, normalizeEmail(email)); }

  async runExpirations(now = new Date()) {
    const today = now.toISOString().slice(0, 10); const reminderEnd = new Date(now.getTime()+7*86400_000).toISOString().slice(0,10);
    const reminders=await this.db.selectFrom('seat_slots').selectAll().where('expire_reminder','=',true).where('expires_on','>=',today).where('expires_on','<=',reminderEnd).execute();
    const reminderKey=`seat-expiry-reminder:${today}`;const already=await this.db.selectFrom('system_settings').select('key').where('key','=',reminderKey).executeTakeFirst();
    if(reminders.length&&!already){await this.notifications?.notifySeatExpiry(reminders.map(row=>({seatSlotId:row.id,email:row.current_email,expiresOn:row.expires_on,workspaceId:row.workspace_id})));await this.db.insertInto('system_settings').values({key:reminderKey,value:{count:reminders.length,runAt:now.toISOString()},is_secret:false,ciphertext:null,nonce:null,auth_tag:null,key_version:null}).onConflict(oc=>oc.column('key').doNothing()).execute();}
    const rows = await this.db.selectFrom('seat_slots').selectAll().where('expires_on', '<', today).execute();
    let disabled = 0; let removed = 0;
    for (const row of rows) {
      if (row.status === 'unknown' || row.status === 'empty' || row.status === 'disabled') continue;
      if (row.expire_remove) {
        const executor = await this.executor(row.workspace_id);
        if (executor) { try { await this.release(row.workspace_id, row.id, executor, false); removed += 1; continue; } catch { /* keep record and disable */ } }
      }
      await this.db.updateTable('seat_slots').set({ status: 'disabled' }).where('id', '=', row.id).execute(); disabled += 1;
    }
    return { checked: rows.length, reminders:reminders.length, disabled, removed };
  }
  private async require(workspaceId: string, id: string) { const row = await this.db.selectFrom('seat_slots').selectAll().where('id', '=', id).where('workspace_id', '=', workspaceId).executeTakeFirst(); if (!row) throw new ServiceError(404, '客户席位不存在'); return row; }
  private async assertWorkspace(id: string) { if (!await this.db.selectFrom('workspaces').select('id').where('id', '=', id).executeTakeFirst()) throw new ServiceError(404, 'Workspace 不存在'); }
  private log(id: string, previous: string | null, next: string | null, reason: string) { return this.db.insertInto('seat_slot_identity_history').values({ seat_slot_id: id, previous_email: previous, next_email: next, changed_at: new Date(), reason }).execute(); }
  private async executor(workspaceId: string) { return (await this.db.selectFrom('workspace_memberships').select('account_id').where('workspace_id', '=', workspaceId).where('status', '=', 'active').where('normalized_role', 'in', ['owner', 'admin']).where('account_id', 'is not', null).executeTakeFirst())?.account_id ?? undefined; }
}

export function startSeatExpirationScheduler(service: SeatSlotService, intervalMs = 60_000): () => void {
  const tick = () => void service.runExpirations().catch((error) => console.warn('[team-manager] 席位到期任务失败:', error));
  tick(); const timer = setInterval(tick, intervalMs); timer.unref(); return () => clearInterval(timer);
}
